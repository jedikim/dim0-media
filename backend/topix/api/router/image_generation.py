"""Authenticated server-side image-generation endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, UploadFile, status
from fastapi.params import File

from topix.api.datatypes.image_generation import (
    ImageAssetUploadResponse,
    ImageGenerationAcceptedResponse,
    ImageGenerationCreateRequest,
    ImageGenerationDetailsResponse,
    ImageGenerationOutputNodeRequest,
    ImageGenerationOutputNodeResponse,
    ImageGenerationReferenceDetailsResponse,
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
    MAX_PROVIDER_REFERENCE_IMAGE_BYTES,
    CapabilityValidationError,
    GenerationIdempotencyConflictError,
    ImageAssetResolutionError,
    ImageContentValidationError,
    ImageReferenceValidationError,
    ImageStorageError,
)
from topix.image_generation.result_nodes import ImageResultNodeError, ImageResultNodeService
from topix.image_generation.service import ImageGenerationService

router = APIRouter(tags=["image-generation"])


_REFERENCE_ERROR_STATUSES = {
    "unsupported_reference_format": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "reference_too_large": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    "reference_pixel_limit_exceeded": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    "reference_request_too_large": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    "reference_encoded_size_exceeded": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
}


def _reference_error(code: str, message: str) -> HTTPException:
    """Build one safe FastAPI detail-dict error for reference failures."""
    return HTTPException(
        status_code=_REFERENCE_ERROR_STATUSES[code],
        detail={"code": code, "message": message},
    )


@router.post(
    "/boards/{graph_id}/image-assets",
    status_code=status.HTTP_201_CREATED,
    response_model=ImageAssetUploadResponse,
)
async def create_image_asset(
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    user_uid: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_member_can_edit)],
    __: Annotated[None, Depends(rate_limiter)],
    file: UploadFile = File(..., description="PNG, JPEG, or WebP image"),
) -> ImageAssetUploadResponse:
    """Register one bounded multipart raster as an immutable board asset."""
    content = await file.read(MAX_PROVIDER_REFERENCE_IMAGE_BYTES + 1)
    if len(content) > MAX_PROVIDER_REFERENCE_IMAGE_BYTES:
        raise _reference_error(
            "reference_too_large",
            "One or more reference images exceed the size limit.",
        )
    service: ImageGenerationService = request.app.image_generation_service
    try:
        asset = await service.register_uploaded_asset(
            user_uid=user_uid,
            board_uid=graph_id,
            content=content,
            claimed_mime_type=file.content_type,
        )
    except ImageContentValidationError as exc:
        if exc.reason == "byte_limit":
            raise _reference_error(
                "reference_too_large",
                "One or more reference images exceed the size limit.",
            ) from None
        if exc.reason == "pixel_limit":
            raise _reference_error(
                "reference_pixel_limit_exceeded",
                "One or more reference images exceed the pixel limit.",
            ) from None
        raise _reference_error(
            "unsupported_reference_format",
            "One or more reference images use an unsupported format.",
        ) from None
    except (ImageStorageError, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image asset storage is temporarily unavailable",
        ) from None
    return ImageAssetUploadResponse(
        asset_uid=asset.uid,
        mime_type=asset.mime_type,
        width=asset.width,
        height=asset.height,
        byte_size=asset.byte_size,
        content_sha256=asset.content_sha256,
    )


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
                default_parameters=capability.default_parameters,
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
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": str(exc)},
        ) from None
    except ImageAssetResolutionError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "image_reference_unavailable",
                "message": "One or more reference images are unavailable.",
            },
        ) from None
    except ImageReferenceValidationError as exc:
        raise _reference_error(exc.code, str(exc)) from None
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
        output_node_uid=generation.output_node_uid,
        output_asset_uid=generation.output_asset_uid,
        output_content_url=output_url,
        error_code=generation.error_code,
        error_message=generation.error_message,
    )


@router.get(
    "/boards/{graph_id}/image-generations/{generation_uid}/details",
    response_model=ImageGenerationDetailsResponse,
)
async def get_image_generation_details(
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    generation_uid: Annotated[str, Path(description="Image generation UID")],
    user_uid: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_read_access)],
) -> ImageGenerationDetailsResponse:
    """Return board-scoped immutable provenance without storage internals."""
    service: ImageGenerationService = request.app.image_generation_service
    details = await service.get_generation_details(
        board_uid=graph_id,
        generation_uid=generation_uid,
    )
    if details is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image generation not found")
    return ImageGenerationDetailsResponse(
        generation_uid=details.generation_uid,
        model_id=details.model_id,
        prompt=details.prompt,
        parameters=details.parameters,
        references=tuple(
            ImageGenerationReferenceDetailsResponse(
                ordinal=reference.ordinal,
                asset_uid=reference.asset_uid,
                mime_type=reference.mime_type,
                width=reference.width,
                height=reference.height,
                content_url=(f"/boards/{graph_id}/image-assets/{reference.asset_uid}/content"),
            )
            for reference in details.references
        ),
    )


@router.put(
    "/boards/{graph_id}/image-generations/{generation_uid}/output-node",
    response_model=ImageGenerationOutputNodeResponse,
)
async def ensure_image_generation_output_node(
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    generation_uid: Annotated[str, Path(description="Image generation UID")],
    body: ImageGenerationOutputNodeRequest,
    _: Annotated[None, Depends(verify_board_member_can_edit)],
) -> ImageGenerationOutputNodeResponse:
    """Idempotently materialize one succeeded generation on the canvas."""
    service = ImageResultNodeService(
        image_store=request.app.image_generation_store,
        graph_store=request.app.graph_store,
        bridge=request.app.agent_board_bridge,
    )
    try:
        outcome = await service.ensure_output_node(
            board_uid=graph_id,
            generation_uid=generation_uid,
            recreate=body.recreate,
        )
    except ImageResultNodeError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if exc.code == "generation_not_found"
            else status.HTTP_503_SERVICE_UNAVAILABLE
            if exc.code in {"canvas_write_incomplete", "output_binding_conflict"}
            else status.HTTP_409_CONFLICT
        )
        raise HTTPException(
            status_code=status_code,
            detail={"code": exc.code, "message": exc.safe_message},
        ) from None
    except Exception:  # noqa: BLE001 - keep graph/storage internals out of HTTP responses
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Generated image canvas materialization is temporarily unavailable",
        ) from None
    return ImageGenerationOutputNodeResponse(
        generation_uid=outcome.generation_uid,
        output_node_uid=outcome.output_node_uid,
        output_asset_uid=outcome.output_asset_uid,
        created=outcome.created,
        recreated=outcome.recreated,
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
            # This authorized raw-byte route intentionally bypasses the API envelope.
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
