"""Authenticated server-side image-generation endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status

from topix.api.datatypes.image_generation import (
    ImageGenerationAcceptedResponse,
    ImageGenerationCreateRequest,
    ImageGenerationStatusResponse,
    ImageModelListResponse,
    ImageModelResponse,
)
from topix.api.utils.rate_limit.dependency import rate_limiter
from topix.api.utils.security import (
    get_current_user_uid,
    verify_board_member_can_edit,
    verify_board_read_access,
)
from topix.image_generation.capabilities import IMAGE_MODEL_CAPABILITIES
from topix.image_generation.models import (
    CapabilityValidationError,
    GenerationIdempotencyConflictError,
    ImageAssetResolutionError,
    ImageContentValidationError,
    ImageStorageError,
)
from topix.image_generation.service import ImageGenerationService

router = APIRouter(tags=["image-generation"])


@router.get("/image-models", response_model=ImageModelListResponse)
async def list_image_models() -> ImageModelListResponse:
    """Return the static image-model allowlist without provider credentials."""
    return ImageModelListResponse(
        models=tuple(
            ImageModelResponse(
                model_id=capability.model_id,
                display_name=capability.display_name,
                supports_text_to_image=capability.supports_text_to_image,
                supports_image_to_image=capability.supports_image_to_image,
                max_reference_images=capability.max_reference_images,
                supported_resolutions=capability.supported_resolutions,
                supported_aspect_ratios=capability.supported_aspect_ratios,
                supported_qualities=capability.supported_qualities,
                max_output_images=capability.max_output_images,
                verified_at=capability.verified_at,
            )
            for capability in IMAGE_MODEL_CAPABILITIES.values()
        )
    )


@router.post(
    "/boards/{graph_id}/image-generations",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ImageGenerationAcceptedResponse,
)
async def create_image_generation(
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    body: ImageGenerationCreateRequest,
    user_uid: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_member_can_edit)],
    __: Annotated[None, Depends(rate_limiter)],
) -> ImageGenerationAcceptedResponse:
    """Validate, durably audit, and schedule one board image generation."""
    if body.generator_node_uid is not None:
        nodes = await request.app.graph_store.get_nodes(node_ids=[body.generator_node_uid])
        if not nodes or nodes[0].graph_uid != graph_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generator node not found")

    service: ImageGenerationService = request.app.image_generation_service
    try:
        outcome = await service.start_generation(
            user_uid=user_uid,
            board_uid=graph_id,
            client_request_uid=str(body.client_request_uid),
            model_id=body.model_id,
            prompt=body.prompt,
            parameters=body.parameters,
            reference_asset_uids=body.reference_asset_uids,
            generator_node_uid=body.generator_node_uid,
        )
    except CapabilityValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from None
    except ImageAssetResolutionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more image assets are unavailable") from None
    except GenerationIdempotencyConflictError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="client_request_uid was already used for different content") from None
    except RuntimeError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Image generation is temporarily unavailable") from None
    return ImageGenerationAcceptedResponse(
        generation_uid=outcome.generation_uid,
        status=outcome.status,
    )


@router.get(
    "/boards/{graph_id}/image-generations/{generation_uid}",
    response_model=ImageGenerationStatusResponse,
)
async def get_image_generation(
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    generation_uid: Annotated[str, Path(description="Image generation UID")],
    user_uid: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_read_access)],
) -> ImageGenerationStatusResponse:
    """Return safe polling state for one authorized board generation."""
    service: ImageGenerationService = request.app.image_generation_service
    generation = await service.get_generation(board_uid=graph_id, generation_uid=generation_uid)
    if generation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image generation not found")
    output_url = None
    if generation.output_asset_uid is not None:
        output_url = f"/boards/{graph_id}/image-assets/{generation.output_asset_uid}/content"
    return ImageGenerationStatusResponse(
        generation_uid=generation.uid,
        status=generation.status,
        model_id=generation.model_id,
        started_at=generation.started_at,
        completed_at=generation.completed_at,
        output_asset_uid=generation.output_asset_uid,
        output_content_url=output_url,
        error_code=generation.error_code,
        error_message=generation.error_message,
    )


@router.get("/boards/{graph_id}/image-assets/{asset_uid}/content")
async def get_image_asset_content(
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    asset_uid: Annotated[str, Path(description="Image asset UID")],
    user_uid: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_read_access)],
) -> Response:
    """Serve verified asset bytes without exposing their storage location."""
    service: ImageGenerationService = request.app.image_generation_service
    try:
        result = await service.get_asset_content(board_uid=graph_id, asset_uid=asset_uid)
    except (ImageStorageError, ImageContentValidationError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image asset content not found") from None
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image asset not found")
    asset, content = result
    return Response(
        content=content,
        media_type=asset.mime_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )
