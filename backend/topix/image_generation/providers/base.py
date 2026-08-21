"""Provider adapter interface for server-side image generation."""

from typing import Protocol, runtime_checkable

from topix.image_generation.models import ProviderImageRequest, ProviderImageResult


@runtime_checkable
class ImageProviderAdapter(Protocol):
    """Generate one image from a credential-free normalized request."""

    provider_id: str

    async def generate(self, request: ProviderImageRequest) -> ProviderImageResult:
        """Generate and normalize a single provider image response."""
        ...
