"""Immutable default capability registry for supported image models."""

from datetime import date
from types import MappingProxyType
from typing import Mapping

from topix.image_generation.models import (
    CapabilityValidationError,
    ImageGenerationParameters,
    ImageModelCapability,
)

_VERIFIED_AT = date(2026, 8, 22)
_OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/images/models"

IMAGE_MODEL_RESOLUTION_PROVIDER_TAGS: Mapping[tuple[str, str], str] = MappingProxyType(
    {("google/gemini-3-pro-image", "4K"): "google-ai-studio/global"}
)


def get_resolution_provider_tag(model_id: str, resolution: str | None) -> str | None:
    """Return a verified endpoint pin required for one model resolution."""
    if resolution is None:
        return None
    return IMAGE_MODEL_RESOLUTION_PROVIDER_TAGS.get((model_id, resolution))


IMAGE_MODEL_CAPABILITIES: Mapping[str, ImageModelCapability] = MappingProxyType(
    {
        "x-ai/grok-imagine-image-2.0": ImageModelCapability(
            model_id="x-ai/grok-imagine-image-2.0",
            display_name="Grok Imagine Image 2.0",
            provider="openrouter",
            supports_text_to_image=True,
            supports_image_to_image=True,
            max_reference_images=3,
            supported_resolutions=("1K", "2K"),
            supported_aspect_ratios=(
                "1:1",
                "3:4",
                "4:3",
                "9:16",
                "16:9",
                "2:3",
                "3:2",
                "9:19.5",
                "19.5:9",
                "9:20",
                "20:9",
                "1:2",
                "2:1",
                "auto",
            ),
            supported_qualities=("low", "medium"),
            max_output_images=1,
            verified_at=_VERIFIED_AT,
            source_urls=(
                _OPENROUTER_MODELS_URL,
                "https://docs.x.ai/developers/model-capabilities/images/multi-image-editing",
            ),
        ),
        "microsoft/mai-image-2.5-pro": ImageModelCapability(
            model_id="microsoft/mai-image-2.5-pro",
            display_name="MAI-Image-2.5-Pro",
            provider="openrouter",
            supports_text_to_image=True,
            supports_image_to_image=True,
            max_reference_images=1,
            supported_resolutions=None,
            supported_aspect_ratios=("1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "auto"),
            supported_qualities=None,
            max_output_images=1,
            verified_at=_VERIFIED_AT,
            source_urls=(
                _OPENROUTER_MODELS_URL,
                "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure",
            ),
        ),
        "google/gemini-3-pro-image": ImageModelCapability(
            model_id="google/gemini-3-pro-image",
            display_name="Gemini 3 Pro Image",
            provider="openrouter",
            supports_text_to_image=True,
            supports_image_to_image=True,
            max_reference_images=14,
            supported_resolutions=("1K", "2K", "4K"),
            supported_aspect_ratios=("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"),
            supported_qualities=None,
            max_output_images=1,
            verified_at=_VERIFIED_AT,
            source_urls=(
                _OPENROUTER_MODELS_URL,
                "https://openrouter.ai/api/v1/images/models/google/gemini-3-pro-image/endpoints",
                "https://ai.google.dev/gemini-api/docs/image-generation",
            ),
        ),
    }
)

MAX_ANY_MODEL_REFERENCES = max(capability.max_reference_images for capability in IMAGE_MODEL_CAPABILITIES.values())


def get_capability(model_id: str) -> ImageModelCapability:
    """Return one registered model or raise an explicit validation error."""
    try:
        return IMAGE_MODEL_CAPABILITIES[model_id]
    except KeyError as exc:
        raise CapabilityValidationError(f"Unsupported image model: {model_id}") from exc


def _validate_choice(
    *,
    model_id: str,
    name: str,
    value: str | None,
    supported: tuple[str, ...] | None,
) -> None:
    """Reject unadvertised or unsupported provider-neutral options."""
    if value is None:
        return
    if supported is None:
        raise CapabilityValidationError(f"{model_id} does not advertise a selectable {name}")
    if value not in supported:
        allowed = ", ".join(supported)
        raise CapabilityValidationError(f"Unsupported {name} for {model_id}: {value}; allowed: {allowed}")


def validate_generation_parameters(
    model_id: str,
    parameters: ImageGenerationParameters,
    *,
    reference_count: int,
) -> ImageModelCapability:
    """Validate a request without mutating or truncating its references."""
    if reference_count < 0:
        raise CapabilityValidationError("reference_count must not be negative")

    capability = get_capability(model_id)
    if reference_count == 0 and not capability.supports_text_to_image:
        raise CapabilityValidationError(f"{model_id} does not support text-to-image generation")
    if reference_count > 0 and not capability.supports_image_to_image:
        raise CapabilityValidationError(f"{model_id} does not support image-to-image generation")
    if reference_count > capability.max_reference_images:
        raise CapabilityValidationError(
            f"Too many reference images for {model_id}: received {reference_count}, maximum {capability.max_reference_images}"
        )

    _validate_choice(
        model_id=model_id,
        name="resolution",
        value=parameters.resolution,
        supported=capability.supported_resolutions,
    )
    _validate_choice(
        model_id=model_id,
        name="aspect ratio",
        value=parameters.aspect_ratio,
        supported=capability.supported_aspect_ratios,
    )
    _validate_choice(
        model_id=model_id,
        name="quality",
        value=parameters.quality,
        supported=capability.supported_qualities,
    )
    if parameters.output_count > capability.max_output_images:
        raise CapabilityValidationError(
            f"Too many output images for {model_id}: requested {parameters.output_count}, maximum {capability.max_output_images}"
        )
    return capability
