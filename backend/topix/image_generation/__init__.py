"""Server-side foundations for auditable image generation."""

from topix.image_generation.capabilities import (
    IMAGE_MODEL_CAPABILITIES,
    get_capability,
    validate_generation_parameters,
)
from topix.image_generation.models import (
    CapabilityValidationError,
    GeneratedImagePayload,
    GenerationReference,
    GenerationStart,
    GenerationStatus,
    ImageAssetCreate,
    ImageAssetResolutionError,
    ImageAssetSnapshot,
    ImageAssetSource,
    ImageGenerationParameters,
    ImageModelCapability,
    ImageProviderError,
    InvalidGenerationTransition,
    ProviderImageReference,
    ProviderImageRequest,
    ProviderImageResult,
    ProviderUsage,
)

__all__ = [
    "IMAGE_MODEL_CAPABILITIES",
    "CapabilityValidationError",
    "GeneratedImagePayload",
    "GenerationReference",
    "GenerationStart",
    "GenerationStatus",
    "ImageAssetCreate",
    "ImageAssetResolutionError",
    "ImageAssetSnapshot",
    "ImageAssetSource",
    "ImageGenerationParameters",
    "ImageModelCapability",
    "ImageProviderError",
    "InvalidGenerationTransition",
    "ProviderImageReference",
    "ProviderImageRequest",
    "ProviderImageResult",
    "ProviderUsage",
    "get_capability",
    "validate_generation_parameters",
]
