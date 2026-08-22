"""Typed HTTP contracts for image-generation endpoints."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from topix.image_generation.capabilities import MAX_ANY_MODEL_REFERENCES
from topix.image_generation.models import GenerationStatus, ImageGenerationParameters, ProviderRasterMimeType


class ImageGenerationAPIModel(BaseModel):
    """Base API model that rejects undeclared request and response fields."""

    model_config = ConfigDict(extra="forbid")


class ImageGenerationCreateRequest(ImageGenerationAPIModel):
    """Client-controlled fields accepted for one idempotent generation."""

    client_request_uid: UUID
    model_id: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=32_000)
    parameters: ImageGenerationParameters = Field(default_factory=ImageGenerationParameters)
    reference_asset_uids: tuple[str, ...] = Field(default=(), max_length=MAX_ANY_MODEL_REFERENCES)
    generator_node_uid: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str) -> str:
        """Reject whitespace-only prompts at the HTTP boundary."""
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value

    @field_validator("reference_asset_uids")
    @classmethod
    def validate_reference_asset_uids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        """Reject blank IDs without reordering or silently deduplicating them."""
        if any(not asset_uid or len(asset_uid) > 200 for asset_uid in value):
            raise ValueError("reference asset IDs must be non-empty and at most 200 characters")
        return value


class ImageGenerationAcceptedResponse(ImageGenerationAPIModel):
    """Minimal polling handle returned with HTTP 202."""

    generation_uid: str
    status: GenerationStatus


class ImageAssetUploadResponse(ImageGenerationAPIModel):
    """Safe metadata returned after one immutable board image upload."""

    asset_uid: str
    mime_type: ProviderRasterMimeType
    width: int
    height: int
    byte_size: int
    content_sha256: str


class ImageGenerationStatusResponse(ImageGenerationAPIModel):
    """Safe generation state returned to an authorized board reader."""

    generation_uid: str
    status: GenerationStatus
    model_id: str
    started_at: datetime
    completed_at: datetime | None
    output_node_uid: str | None
    output_asset_uid: str | None
    output_content_url: str | None
    error_code: str | None
    error_message: str | None


class ImageGenerationOutputNodeRequest(ImageGenerationAPIModel):
    """Only client choice accepted by the canonical output-node endpoint."""

    recreate: bool = False


class ImageGenerationOutputNodeResponse(ImageGenerationAPIModel):
    """Safe canonical result-node association returned to an editor."""

    generation_uid: str
    output_node_uid: str
    output_asset_uid: str
    created: bool
    recreated: bool


class ImageModelResponse(ImageGenerationAPIModel):
    """Public allowlisted capability metadata for one image model."""

    model_id: str
    display_name: str
    supports_text_to_image: bool
    supports_image_to_image: bool
    max_reference_images: int
    supported_resolutions: tuple[str, ...] | None
    supported_aspect_ratios: tuple[str, ...] | None
    supported_qualities: tuple[str, ...] | None
    max_output_images: int
    verified_at: date


class ImageModelListResponse(ImageGenerationAPIModel):
    """Static server allowlist returned by the models endpoint."""

    models: tuple[ImageModelResponse, ...]
