"""Authenticated read-only endpoints for global AI image history."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from fastapi import status as http_status

from topix.api.datatypes.image_history import (
    ImageHistoryAssetResponse,
    ImageHistoryBoardResponse,
    ImageHistoryItemResponse,
    ImageHistoryMetricsResponse,
    ImageHistoryPageResponse,
    ImageHistoryReferenceResponse,
    ImageHistorySummaryMetricsResponse,
    ImageHistorySummaryResponse,
    ImageHistoryUsageResponse,
    ImageHistoryUserResponse,
    ImageHistoryUserSummaryResponse,
)
from topix.api.utils.security import get_current_user_uid
from topix.image_generation.history import (
    ImageHistoryAsset,
    ImageHistoryMetrics,
    ImageHistorySummaryMetrics,
    ImageHistoryUser,
    InvalidImageHistoryCursorError,
    decode_image_history_cursor,
)
from topix.image_generation.models import GenerationStatus, ImageContentValidationError, ImageStorageError
from topix.image_generation.service import ImageGenerationService
from topix.store.image_history import ImageHistoryStore

router = APIRouter(prefix="/image-history", tags=["image-history"])

_NO_STORE_HEADERS = {"Cache-Control": "private, no-store"}


def _user_response(user: ImageHistoryUser) -> ImageHistoryUserResponse:
    """Project only the approved public creator identity fields."""
    return ImageHistoryUserResponse(uid=user.uid, username=user.username, name=user.name)


def _usage_response(metrics: ImageHistoryMetrics) -> ImageHistoryUsageResponse:
    """Preserve nullable provider usage fields in the HTTP response."""
    return ImageHistoryUsageResponse.model_validate(metrics.usage.model_dump())


def _metrics_response(metrics: ImageHistoryMetrics) -> ImageHistoryMetricsResponse:
    """Project provider attempt totals without client-side recomputation."""
    return ImageHistoryMetricsResponse(
        attempt_count=metrics.attempt_count,
        priced_attempt_count=metrics.priced_attempt_count,
        cost_unreported_attempt_count=metrics.cost_unreported_attempt_count,
        known_cost_usd=metrics.known_cost_usd,
        usage=_usage_response(metrics),
    )


def _summary_metrics_response(metrics: ImageHistorySummaryMetrics) -> ImageHistorySummaryMetricsResponse:
    """Project shared status and provider aggregate definitions."""
    return ImageHistorySummaryMetricsResponse(
        generation_count=metrics.generation_count,
        succeeded_count=metrics.succeeded_count,
        failed_count=metrics.failed_count,
        active_count=metrics.active_count,
        **_metrics_response(metrics).model_dump(),
    )


def _asset_response(generation_uid: str, asset: ImageHistoryAsset) -> ImageHistoryAssetResponse:
    """Attach a generation-scoped content URL to safe asset metadata."""
    return ImageHistoryAssetResponse(
        asset_uid=asset.uid,
        mime_type=asset.mime_type,
        width=asset.width,
        height=asset.height,
        content_url=f"/image-history/{generation_uid}/assets/{asset.uid}/content",
    )


@router.get("/summary", response_model=ImageHistorySummaryResponse)
async def get_image_history_summary(
    request: Request,
    response: Response,
    _: Annotated[str, Depends(get_current_user_uid)],
) -> ImageHistorySummaryResponse:
    """Return global and per-creator summaries to any authenticated user."""
    store: ImageHistoryStore = request.app.image_history_store
    summary = await store.summary()
    response.headers.update(_NO_STORE_HEADERS)
    return ImageHistorySummaryResponse(
        overall=_summary_metrics_response(summary.overall),
        users=tuple(
            ImageHistoryUserSummaryResponse(
                user=_user_response(item.user),
                **_summary_metrics_response(item.metrics).model_dump(),
            )
            for item in summary.users
        ),
    )


@router.get("", response_model=ImageHistoryPageResponse)
async def list_image_history(
    request: Request,
    response: Response,
    _: Annotated[str, Depends(get_current_user_uid)],
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    user_uid: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    status: Annotated[GenerationStatus | None, Query()] = None,
) -> ImageHistoryPageResponse:
    """Return one filtered newest-first page without board ACL filtering."""
    try:
        decoded_cursor = decode_image_history_cursor(cursor) if cursor is not None else None
    except InvalidImageHistoryCursorError:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid image history cursor",
        ) from None
    store: ImageHistoryStore = request.app.image_history_store
    page = await store.list(
        limit=limit,
        cursor=decoded_cursor,
        user_uid=user_uid,
        status=status,
    )
    response.headers.update(_NO_STORE_HEADERS)
    return ImageHistoryPageResponse(
        items=tuple(
            ImageHistoryItemResponse(
                generation_uid=item.generation_uid,
                user=_user_response(item.user),
                board=ImageHistoryBoardResponse.model_validate(item.board.model_dump()),
                provider=item.provider,
                model_id=item.model_id,
                prompt=item.prompt,
                parameters=item.parameters,
                status=item.status,
                started_at=item.started_at,
                completed_at=item.completed_at,
                error_code=item.error_code,
                error_message=item.error_message,
                output=_asset_response(item.generation_uid, item.output) if item.output is not None else None,
                references=tuple(
                    ImageHistoryReferenceResponse(
                        **_asset_response(item.generation_uid, reference).model_dump(),
                        ordinal=reference.ordinal,
                    )
                    for reference in item.references
                ),
                **_metrics_response(item.metrics).model_dump(),
            )
            for item in page.items
        ),
        next_cursor=page.next_cursor,
    )


@router.get("/{generation_uid}/assets/{asset_uid}/content", response_class=Response)
async def get_image_history_asset_content(
    request: Request,
    generation_uid: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")],
    asset_uid: Annotated[str, Path(min_length=1, max_length=200)],
    _: Annotated[str, Depends(get_current_user_uid)],
) -> Response:
    """Serve verified bytes only for an output or ordered reference of the run."""
    store: ImageHistoryStore = request.app.image_history_store
    scope = await store.get_asset_scope(generation_uid=generation_uid, asset_uid=asset_uid)
    if scope is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Image history asset not found")
    service: ImageGenerationService = request.app.image_generation_service
    try:
        result = await service.get_asset_content(board_uid=scope.board_uid, asset_uid=asset_uid)
    except (ImageStorageError, ImageContentValidationError):
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Image history asset not found") from None
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Image history asset not found")
    asset, content = result
    return Response(
        content=content,
        media_type=asset.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
