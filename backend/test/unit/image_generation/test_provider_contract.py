"""Contract tests for credential-free image-provider adapters."""

from __future__ import annotations

from hashlib import sha256

import pytest

from topix.image_generation.models import (
    GeneratedImagePayload,
    ImageGenerationParameters,
    ProviderImageReference,
    ProviderImageRequest,
    ProviderImageResult,
    ProviderUsage,
)
from topix.image_generation.providers import ImageProviderAdapter


class FakeImageProvider:
    """Small adapter double that returns one deterministic image."""

    provider_id = "fake"

    async def generate(self, request: ProviderImageRequest) -> ProviderImageResult:
        """Return deterministic bytes without any network access."""
        content = b"generated-image"
        return ProviderImageResult(
            image=GeneratedImagePayload(
                mime_type="image/png",
                content=content,
                width=64,
                height=64,
                content_sha256=sha256(content).hexdigest(),
            ),
            provider_request_id=f"fake-{request.attempt_uid}",
            usage=ProviderUsage(input_units=5, output_units=7, total_units=12, generated_images=1),
        )


def _all_mapping_keys(value: object) -> set[str]:
    """Collect nested mapping keys from a serialized provider request."""
    if isinstance(value, dict):
        keys = {str(key) for key in value}
        for child in value.values():
            keys.update(_all_mapping_keys(child))
        return keys
    if isinstance(value, (list, tuple)):
        keys: set[str] = set()
        for child in value:
            keys.update(_all_mapping_keys(child))
        return keys
    return set()


@pytest.mark.asyncio
async def test_adapter_protocol_and_request_exclude_credentials_and_locations() -> None:
    """Adapter input contains trusted bytes but no secret, URL, or path fields."""
    reference_content = b"reference-image"
    request = ProviderImageRequest(
        generation_uid="generation-1",
        attempt_uid="attempt-1",
        model_id="x-ai/grok-imagine-image-2.0",
        prompt="Draw a safe test image",
        parameters=ImageGenerationParameters(aspect_ratio="1:1"),
        references=(
            ProviderImageReference(
                asset_uid="asset-1",
                ordinal=0,
                mime_type="image/png",
                content_sha256=sha256(reference_content).hexdigest(),
                width=32,
                height=32,
                content=reference_content,
            ),
        ),
    )
    adapter = FakeImageProvider()

    assert isinstance(adapter, ImageProviderAdapter)
    result = await adapter.generate(request)
    assert result.image.content == b"generated-image"

    forbidden = {"api_key", "authorization", "header", "headers", "url", "path", "storage_key"}
    request_keys = {key.lower() for key in _all_mapping_keys(request.model_dump())}
    assert request_keys.isdisjoint(forbidden)
