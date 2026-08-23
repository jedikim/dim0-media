"""Safe domain contracts and cursor handling for global image history."""

from __future__ import annotations

import base64
import binascii
import json
import re

from datetime import datetime
from decimal import Decimal

from pydantic import Field

from topix.image_generation.models import (
    FrozenModel,
    GenerationStatus,
    ImageGenerationParameters,
    RasterImageMimeType,
)

_CURSOR_VERSION = 1
_GENERATION_UID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class InvalidImageHistoryCursorError(ValueError):
    """Reject malformed or unsupported opaque pagination cursors."""


class ImageHistoryCursor(FrozenModel):
    """Validated keyset position for descending generation history."""

    started_at: datetime
    generation_uid: str = Field(pattern=r"^[0-9a-f]{32}$")


class ImageHistoryUser(FrozenModel):
    """Public creator identity that deliberately excludes account secrets."""

    uid: str
    username: str
    name: str | None = None


class ImageHistoryBoard(FrozenModel):
    """Public history projection for active or soft-deleted boards."""

    uid: str
    name: str | None = None
    deleted: bool


class ImageHistoryAsset(FrozenModel):
    """Safe image metadata without storage keys or content digests."""

    uid: str
    mime_type: RasterImageMimeType
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ImageHistoryReference(ImageHistoryAsset):
    """One ordered reference projection; duplicate asset IDs remain valid."""

    ordinal: int = Field(ge=0)


class ImageHistoryUsage(FrozenModel):
    """Nullable provider-reported usage totals that preserve missing versus zero."""

    input_units: int | None = Field(default=None, ge=0)
    output_units: int | None = Field(default=None, ge=0)
    total_units: int | None = Field(default=None, ge=0)
    generated_images: int | None = Field(default=None, ge=0)


class ImageHistoryMetrics(FrozenModel):
    """Attempt totals and known provider cost for one or more generations."""

    attempt_count: int = Field(ge=0)
    priced_attempt_count: int = Field(ge=0)
    cost_unreported_attempt_count: int = Field(ge=0)
    known_cost_usd: Decimal | None = Field(default=None, ge=0)
    usage: ImageHistoryUsage = Field(default_factory=ImageHistoryUsage)


class ImageHistoryCounts(FrozenModel):
    """Generation status totals using the shared active-state definition."""

    generation_count: int = Field(ge=0)
    succeeded_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)
    active_count: int = Field(ge=0)


class ImageHistorySummaryMetrics(ImageHistoryCounts, ImageHistoryMetrics):
    """Complete summary metrics shared by overall and per-user projections."""


class ImageHistoryUserSummary(FrozenModel):
    """One creator and their aggregated image-generation activity."""

    user: ImageHistoryUser
    metrics: ImageHistorySummaryMetrics


class ImageHistorySummary(FrozenModel):
    """Global and per-user image history summary."""

    overall: ImageHistorySummaryMetrics
    users: tuple[ImageHistoryUserSummary, ...] = ()


class ImageHistoryRun(FrozenModel):
    """Safe global read model for one audited image generation."""

    generation_uid: str = Field(pattern=r"^[0-9a-f]{32}$")
    user: ImageHistoryUser
    board: ImageHistoryBoard
    provider: str
    model_id: str
    prompt: str
    parameters: ImageGenerationParameters
    status: GenerationStatus
    started_at: datetime
    completed_at: datetime | None = None
    metrics: ImageHistoryMetrics
    error_code: str | None = None
    error_message: str | None = None
    output: ImageHistoryAsset | None = None
    references: tuple[ImageHistoryReference, ...] = ()


class ImageHistoryPage(FrozenModel):
    """One keyset-paginated history page."""

    items: tuple[ImageHistoryRun, ...]
    next_cursor: str | None = None


class ImageHistoryAssetScope(FrozenModel):
    """Generation-scoped asset relationship used before global content reads."""

    board_uid: str


def encode_image_history_cursor(started_at: datetime, generation_uid: str) -> str:
    """Encode an aware timestamp and exact generation UID as opaque base64url."""
    if started_at.tzinfo is None or started_at.utcoffset() is None:
        raise ValueError("history cursor timestamp must be timezone-aware")
    if _GENERATION_UID_PATTERN.fullmatch(generation_uid) is None:
        raise ValueError("history cursor generation UID must be 32 lowercase hex characters")
    payload = json.dumps(
        {
            "v": _CURSOR_VERSION,
            "started_at": started_at.isoformat(),
            "generation_uid": generation_uid,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_image_history_cursor(value: str) -> ImageHistoryCursor:
    """Strictly decode a versioned base64url history cursor."""
    if not value or len(value) > 1024:
        raise InvalidImageHistoryCursorError("Invalid image history cursor")
    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.b64decode(padded, altchars=b"-_", validate=True)
        payload = json.loads(decoded.decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise InvalidImageHistoryCursorError("Invalid image history cursor") from None
    if not isinstance(payload, dict) or set(payload) != {"v", "started_at", "generation_uid"}:
        raise InvalidImageHistoryCursorError("Invalid image history cursor")
    if (
        type(payload["v"]) is not int
        or payload["v"] != _CURSOR_VERSION
        or not isinstance(payload["started_at"], str)
        or not isinstance(payload["generation_uid"], str)
    ):
        raise InvalidImageHistoryCursorError("Invalid image history cursor")
    try:
        started_at = datetime.fromisoformat(payload["started_at"])
    except ValueError:
        raise InvalidImageHistoryCursorError("Invalid image history cursor") from None
    if started_at.tzinfo is None or started_at.utcoffset() is None:
        raise InvalidImageHistoryCursorError("Invalid image history cursor")
    if _GENERATION_UID_PATTERN.fullmatch(payload["generation_uid"]) is None:
        raise InvalidImageHistoryCursorError("Invalid image history cursor")
    return ImageHistoryCursor(
        started_at=started_at,
        generation_uid=payload["generation_uid"],
    )
