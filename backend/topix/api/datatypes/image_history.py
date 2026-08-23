"""Typed public HTTP contracts for global AI image history."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from topix.image_generation.models import GenerationStatus, ImageGenerationParameters, RasterImageMimeType


class ImageHistoryAPIModel(BaseModel):
    """Reject undeclared public history fields at the API boundary."""

    model_config = ConfigDict(extra="forbid")


class ImageHistoryUserResponse(ImageHistoryAPIModel):
    """Public creator identity without email or authentication metadata."""

    uid: str
    username: str
    name: str | None


class ImageHistoryBoardResponse(ImageHistoryAPIModel):
    """Safe board label state for global history display."""

    uid: str
    name: str | None
    deleted: bool


class ImageHistoryUsageResponse(ImageHistoryAPIModel):
    """Nullable provider-reported usage that distinguishes missing from zero."""

    input_units: int | None
    output_units: int | None
    total_units: int | None
    generated_images: int | None


class ImageHistoryMetricsResponse(ImageHistoryAPIModel):
    """Attempt, known-cost, and provider-usage totals."""

    attempt_count: int
    priced_attempt_count: int
    cost_unreported_attempt_count: int
    known_cost_usd: Decimal | None
    usage: ImageHistoryUsageResponse


class ImageHistorySummaryMetricsResponse(ImageHistoryMetricsResponse):
    """Generation state counts plus shared attempt metrics."""

    generation_count: int
    succeeded_count: int
    failed_count: int
    active_count: int


class ImageHistoryUserSummaryResponse(ImageHistorySummaryMetricsResponse):
    """One creator's global history summary."""

    user: ImageHistoryUserResponse


class ImageHistorySummaryResponse(ImageHistoryAPIModel):
    """Overall and per-user global image history summaries."""

    overall: ImageHistorySummaryMetricsResponse
    users: tuple[ImageHistoryUserSummaryResponse, ...]


class ImageHistoryAssetResponse(ImageHistoryAPIModel):
    """Safe generated or reference asset projection with authorized content URL."""

    asset_uid: str
    mime_type: RasterImageMimeType
    width: int
    height: int
    content_url: str


class ImageHistoryReferenceResponse(ImageHistoryAssetResponse):
    """Ordered reference projection that preserves duplicate asset occurrences."""

    ordinal: int


class ImageHistoryItemResponse(ImageHistoryMetricsResponse):
    """Complete safe read-only projection for one image generation."""

    generation_uid: str
    user: ImageHistoryUserResponse
    board: ImageHistoryBoardResponse
    provider: str
    model_id: str
    prompt: str
    parameters: ImageGenerationParameters
    status: GenerationStatus
    started_at: datetime
    completed_at: datetime | None
    error_code: str | None
    error_message: str | None
    output: ImageHistoryAssetResponse | None
    references: tuple[ImageHistoryReferenceResponse, ...]


class ImageHistoryPageResponse(ImageHistoryAPIModel):
    """One newest-first keyset page with an opaque continuation cursor."""

    items: tuple[ImageHistoryItemResponse, ...]
    next_cursor: str | None
