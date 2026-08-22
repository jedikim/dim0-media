"""Unit tests for the immutable image-model capability registry."""

from types import MappingProxyType

import pytest

import topix.image_generation.capabilities as capabilities

from topix.image_generation.capabilities import (
    IMAGE_MODEL_CAPABILITIES,
    get_capability,
    get_resolution_provider_tag,
    validate_generation_parameters,
)
from topix.image_generation.models import (
    CapabilityValidationError,
    ImageGenerationParameters,
)


@pytest.mark.parametrize(
    ("model_id", "max_references", "resolutions", "max_outputs"),
    [
        ("x-ai/grok-imagine-image-2.0", 3, ("1K", "2K"), 1),
        ("microsoft/mai-image-2.5-pro", 1, None, 1),
        ("google/gemini-3-pro-image", 14, ("1K", "2K", "4K"), 1),
    ],
)
def test_default_capabilities_match_verified_provider_metadata(
    model_id: str,
    max_references: int,
    resolutions: tuple[str, ...] | None,
    max_outputs: int,
) -> None:
    """Registry entries preserve the exact verified limits for initial models."""
    capability = get_capability(model_id)

    assert capability.max_reference_images == max_references
    assert capability.supported_resolutions == resolutions
    assert capability.max_output_images == max_outputs
    assert capability.supports_text_to_image is True
    assert capability.supports_image_to_image is True
    assert capability.verified_at.isoformat() == "2026-08-22"
    assert capability.source_urls


def test_gemini_4k_requires_verified_ai_studio_endpoint() -> None:
    """Only Gemini 4K requires the endpoint that advertises that resolution."""
    assert get_resolution_provider_tag("google/gemini-3-pro-image", "4K") == "google-ai-studio/global"
    assert get_resolution_provider_tag("google/gemini-3-pro-image", "2K") is None


def test_registry_is_immutable() -> None:
    """Callers cannot replace static capability entries at runtime."""
    with pytest.raises(TypeError):
        IMAGE_MODEL_CAPABILITIES["new/model"] = get_capability("x-ai/grok-imagine-image-2.0")  # type: ignore[index]


def test_unknown_model_is_rejected() -> None:
    """Unknown model IDs fail explicitly instead of falling through."""
    with pytest.raises(CapabilityValidationError, match="Unsupported image model") as exc_info:
        get_capability("unknown/image-model")
    assert exc_info.value.code == "unsupported_image_model"


@pytest.mark.parametrize(
    ("model_id", "maximum"),
    [
        ("x-ai/grok-imagine-image-2.0", 3),
        ("microsoft/mai-image-2.5-pro", 1),
        ("google/gemini-3-pro-image", 14),
    ],
)
def test_reference_overflow_is_rejected_without_truncation(model_id: str, maximum: int) -> None:
    """Every over-limit request fails with both received and maximum counts."""
    parameters = ImageGenerationParameters()

    with pytest.raises(CapabilityValidationError) as exc_info:
        validate_generation_parameters(model_id, parameters, reference_count=maximum + 1)

    message = str(exc_info.value)
    assert f"received {maximum + 1}" in message
    assert f"maximum {maximum}" in message
    assert exc_info.value.code == "reference_limit_exceeded"


def test_supported_options_are_accepted() -> None:
    """A fully supported Grok request passes unchanged."""
    parameters = ImageGenerationParameters(
        aspect_ratio="16:9",
        resolution="2K",
        quality="medium",
    )

    capability = validate_generation_parameters(
        "x-ai/grok-imagine-image-2.0",
        parameters,
        reference_count=3,
    )

    assert capability.model_id == "x-ai/grok-imagine-image-2.0"
    assert parameters.aspect_ratio == "16:9"


@pytest.mark.parametrize(
    "parameters",
    [
        ImageGenerationParameters(resolution="1K"),
        ImageGenerationParameters(quality="high"),
    ],
)
def test_unadvertised_mai_options_are_rejected(parameters: ImageGenerationParameters) -> None:
    """Missing provider descriptors are not treated as unrestricted options."""
    with pytest.raises(CapabilityValidationError, match="does not advertise"):
        validate_generation_parameters(
            "microsoft/mai-image-2.5-pro",
            parameters,
            reference_count=0,
        )


def test_unsupported_output_count_is_rejected() -> None:
    """The single-output foundation rejects a request for multiple images."""
    with pytest.raises(CapabilityValidationError, match="Too many output images"):
        validate_generation_parameters(
            "google/gemini-3-pro-image",
            ImageGenerationParameters(output_count=2),
            reference_count=0,
        )


@pytest.mark.parametrize(
    ("reference_count", "capability_field", "error", "code"),
    [
        (0, "supports_text_to_image", "does not support text-to-image", "text_to_image_unsupported"),
        (1, "supports_image_to_image", "does not support image-to-image", "image_to_image_unsupported"),
    ],
)
def test_generation_mode_must_be_supported(
    monkeypatch,
    reference_count: int,
    capability_field: str,
    error: str,
    code: str,
) -> None:
    """Prompt-only and referenced requests enforce their respective mode flags."""
    model_id = "test/mode-limited"
    capability = get_capability("x-ai/grok-imagine-image-2.0").model_copy(update={"model_id": model_id, capability_field: False})
    monkeypatch.setattr(
        capabilities,
        "IMAGE_MODEL_CAPABILITIES",
        MappingProxyType({model_id: capability}),
    )

    with pytest.raises(CapabilityValidationError, match=error) as exc_info:
        validate_generation_parameters(
            model_id,
            ImageGenerationParameters(),
            reference_count=reference_count,
        )
    assert exc_info.value.code == code
