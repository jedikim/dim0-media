"""Typed contracts for image assets, generations, and providers."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import StrEnum
from hashlib import sha256
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator

from topix.utils.common import gen_uid

MAX_PROVIDER_IMAGE_BYTES = 20 * 1024 * 1024
MAX_PROVIDER_REQUEST_BYTES = 100 * 1024 * 1024
RasterImageMimeType = Literal["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]
Sha256Hex = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class FrozenModel(BaseModel):
    """Base immutable model that rejects undeclared fields."""

    model_config = ConfigDict(frozen=True, extra="forbid", revalidate_instances="never")


class ImageAssetSource(StrEnum):
    """Origin categories shared by uploaded and generated image assets."""

    UPLOADED = "uploaded"
    GENERATED = "generated"
    LEGACY_NORMALIZED = "legacy_normalized"


class GenerationStatus(StrEnum):
    """Durable lifecycle states for one logical generation."""

    STARTED = "started"
    RETRYABLE = "retryable"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class GenerationAttemptStatus(StrEnum):
    """Durable lifecycle states for one immutable provider attempt."""

    STARTED = "started"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class ImageGenerationParameters(FrozenModel):
    """Provider-neutral image options validated against model capabilities."""

    aspect_ratio: str | None = None
    resolution: str | None = None
    quality: str | None = None
    output_count: int = Field(default=1, gt=0)


class ImageAssetCreate(FrozenModel):
    """Trusted metadata used to register one immutable internal image asset."""

    uid: str = Field(default_factory=gen_uid, min_length=1)
    board_uid: str = Field(min_length=1)
    created_by_user_uid: str = Field(min_length=1)
    source_kind: ImageAssetSource
    storage_key: str
    mime_type: RasterImageMimeType
    byte_size: int = Field(gt=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    content_sha256: Sha256Hex

    @field_validator("storage_key")
    @classmethod
    def validate_storage_key(cls, value: str) -> str:
        """Reject unsafe raw key syntax before any path normalization."""
        if not value or value.startswith("/") or "://" in value or "\\" in value:
            raise ValueError("storage_key must be an internal relative key")
        if any(part in {"", ".", ".."} for part in value.split("/")):
            raise ValueError("storage_key contains an invalid path segment")
        return value


class ImageAssetSnapshot(FrozenModel):
    """Request-time copy of immutable asset metadata used for audit history."""

    asset_uid: str = Field(min_length=1)
    source_kind: ImageAssetSource
    storage_key: str
    mime_type: RasterImageMimeType
    byte_size: int = Field(gt=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    content_sha256: Sha256Hex

    @field_validator("storage_key")
    @classmethod
    def validate_storage_key(cls, value: str) -> str:
        """Apply the same raw storage-key contract as new asset metadata."""
        return ImageAssetCreate.validate_storage_key(value)


class GenerationReference(FrozenModel):
    """Ordered asset reference with an optional board-authorized node association."""

    ordinal: int = Field(ge=0)
    reference_node_uid: str | None = Field(default=None, min_length=1)
    asset_uid: str = Field(min_length=1)


class GenerationStart(FrozenModel):
    """Input for atomically recording a generation and its initial attempt."""

    uid: str = Field(default_factory=gen_uid, min_length=1)
    attempt_uid: str = Field(default_factory=gen_uid, min_length=1)
    user_uid: str = Field(min_length=1)
    board_uid: str = Field(min_length=1)
    generator_node_uid: str | None = None
    provider: str = Field(default="openrouter", min_length=1)
    model_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    parameters: ImageGenerationParameters = Field(default_factory=ImageGenerationParameters)
    references: tuple[GenerationReference, ...] = ()
    attempt_number: int = Field(default=1, gt=0)

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str) -> str:
        """Reject prompts that contain only whitespace."""
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value

    @model_validator(mode="after")
    def validate_reference_order(self) -> "GenerationStart":
        """Require explicit contiguous ordering without duplicate node IDs."""
        ordinals = [reference.ordinal for reference in self.references]
        if ordinals != list(range(len(self.references))):
            raise ValueError("reference ordinals must be contiguous and start at zero")
        node_uids = [reference.reference_node_uid for reference in self.references if reference.reference_node_uid is not None]
        if len(node_uids) != len(set(node_uids)):
            raise ValueError("reference node IDs must be unique")
        return self


class GenerationAttemptStart(FrozenModel):
    """Input for atomically opening a retry attempt on a retryable run."""

    uid: str = Field(default_factory=gen_uid, min_length=1)
    generation_uid: str = Field(min_length=1)
    attempt_number: int = Field(gt=1)
    provider: str = Field(default="openrouter", min_length=1)
    model_id: str = Field(min_length=1)


class ProviderImageReference(FrozenModel):
    """Validated image bytes passed to a provider without URL or path fields."""

    asset_uid: str = Field(min_length=1)
    ordinal: int = Field(ge=0)
    mime_type: RasterImageMimeType
    content_sha256: Sha256Hex
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    content: bytes = Field(min_length=1, max_length=MAX_PROVIDER_IMAGE_BYTES)
    _verified_content: bytes | None = PrivateAttr(default=None)
    _verified_digest: str | None = PrivateAttr(default=None)

    @model_validator(mode="after")
    def validate_content_hash(self) -> "ProviderImageReference":
        """Verify reference bytes match their trusted content digest."""
        if self._verified_content is self.content and self._verified_digest == self.content_sha256:
            return self
        if sha256(self.content).hexdigest() != self.content_sha256:
            raise ValueError("reference content does not match content_sha256")
        object.__setattr__(self, "_verified_content", self.content)
        object.__setattr__(self, "_verified_digest", self.content_sha256)
        return self


class ProviderImageRequest(FrozenModel):
    """Credential-free request contract consumed by provider adapters."""

    generation_uid: str = Field(min_length=1)
    attempt_uid: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    parameters: ImageGenerationParameters = Field(default_factory=ImageGenerationParameters)
    references: tuple[ProviderImageReference, ...] = ()

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str) -> str:
        """Reject provider prompts that contain only whitespace."""
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value

    @model_validator(mode="after")
    def validate_reference_order(self) -> "ProviderImageRequest":
        """Preserve reference order and enforce a provider-neutral memory cap."""
        ordinals = [reference.ordinal for reference in self.references]
        if ordinals != list(range(len(self.references))):
            raise ValueError("reference ordinals must be contiguous and start at zero")
        if sum(len(reference.content) for reference in self.references) > MAX_PROVIDER_REQUEST_BYTES:
            raise ValueError("reference content exceeds the provider request byte limit")
        return self


class GeneratedImagePayload(FrozenModel):
    """Single generated image returned by the initial provider contract."""

    mime_type: RasterImageMimeType
    content: bytes = Field(min_length=1, max_length=MAX_PROVIDER_IMAGE_BYTES)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    content_sha256: Sha256Hex
    _verified_content: bytes | None = PrivateAttr(default=None)
    _verified_digest: str | None = PrivateAttr(default=None)

    @model_validator(mode="after")
    def validate_content_hash(self) -> "GeneratedImagePayload":
        """Verify generated bytes match the provider-normalized digest."""
        if self._verified_content is self.content and self._verified_digest == self.content_sha256:
            return self
        if sha256(self.content).hexdigest() != self.content_sha256:
            raise ValueError("generated content does not match content_sha256")
        object.__setattr__(self, "_verified_content", self.content)
        object.__setattr__(self, "_verified_digest", self.content_sha256)
        return self


class ProviderUsage(FrozenModel):
    """Sanitized provider usage suitable for durable storage."""

    input_units: int | None = Field(default=None, ge=0)
    output_units: int | None = Field(default=None, ge=0)
    total_units: int | None = Field(default=None, ge=0)
    generated_images: int | None = Field(default=None, ge=0)


class ProviderImageResult(FrozenModel):
    """Normalized successful result from an image provider."""

    image: GeneratedImagePayload
    provider_request_id: str | None = None
    usage: ProviderUsage | None = None
    cost_usd: Decimal | None = Field(default=None, ge=0)


class ImageProviderError(Exception):
    """Safe provider failure metadata without raw responses or credentials."""

    def __init__(
        self,
        code: str,
        safe_message: str,
        *,
        provider_request_id: str | None = None,
        usage: ProviderUsage | None = None,
        cost_usd: Decimal | None = None,
    ) -> None:
        """Initialize a failure using only sanitized provider metadata."""
        if not code.strip() or not safe_message.strip():
            raise ValueError("provider error code and safe message must not be blank")
        if cost_usd is not None and cost_usd < 0:
            raise ValueError("provider error cost must not be negative")
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message
        self.provider_request_id = provider_request_id
        self.usage = usage
        self.cost_usd = cost_usd


class ImageModelCapability(FrozenModel):
    """Static provider-neutral capabilities for one image model."""

    model_id: str
    display_name: str
    provider: str
    supports_text_to_image: bool
    supports_image_to_image: bool
    max_reference_images: int = Field(ge=0)
    supported_resolutions: tuple[str, ...] | None
    supported_aspect_ratios: tuple[str, ...] | None
    supported_qualities: tuple[str, ...] | None
    max_output_images: int = Field(gt=0)
    verified_at: date
    source_urls: tuple[str, ...]


class CapabilityValidationError(ValueError):
    """Raised when a request exceeds or contradicts model capabilities."""


class InvalidGenerationTransition(RuntimeError):  # noqa: N818 - approved domain name
    """Raised when a terminal or mismatched generation is finalized."""


class ImageAssetResolutionError(LookupError):
    """Raised when a reference asset cannot be resolved on the current board."""
