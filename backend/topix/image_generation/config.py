"""Server-only configuration helpers for image generation providers."""

from pydantic import SecretStr

from topix.config.config import Config, OpenRouterConfig
from topix.utils.singleton import SingletonNotInitializedError


class ImageProviderConfigurationError(RuntimeError):
    """Raised when a server-side image provider secret is unavailable."""


def require_openrouter_api_key(config: OpenRouterConfig | None = None) -> SecretStr:
    """Return the configured server secret without exposing its value."""
    try:
        openrouter = config if config is not None else Config.instance().run.apis.openrouter
    except SingletonNotInitializedError:
        raise ImageProviderConfigurationError("OpenRouter server configuration is not initialized") from None
    if openrouter.api_key is None:
        raise ImageProviderConfigurationError("OPENROUTER_API_KEY is not configured on the server")
    return openrouter.api_key
