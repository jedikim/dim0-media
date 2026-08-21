"""Tests for server-only OpenRouter image-generation configuration."""

import logging
import secrets

import pytest

from topix.config.config import Config, OpenRouterConfig
from topix.image_generation.config import (
    ImageProviderConfigurationError,
    require_openrouter_api_key,
)


def test_openrouter_key_is_read_as_secret_without_logging_value(monkeypatch, caplog) -> None:
    """The environment value remains masked in models, repr, and logs."""
    sentinel = secrets.token_urlsafe(24)
    monkeypatch.setenv("OPENROUTER_API_KEY", sentinel)
    caplog.set_level(logging.INFO)

    config = OpenRouterConfig()
    secret = require_openrouter_api_key(config)

    assert secret.get_secret_value() == sentinel
    assert sentinel not in repr(config)
    assert sentinel not in repr(secret)
    assert sentinel not in caplog.text


def test_missing_openrouter_key_raises_safe_error(monkeypatch) -> None:
    """Missing server configuration fails without embedding a credential value."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    config = OpenRouterConfig()

    with pytest.raises(ImageProviderConfigurationError, match="not configured") as exc_info:
        require_openrouter_api_key(config)

    assert "Authorization" not in str(exc_info.value)


def test_uninitialized_server_config_raises_provider_configuration_error(monkeypatch, caplog) -> None:
    """The default helper path normalizes an unavailable Config singleton."""
    sentinel = secrets.token_urlsafe(24)
    monkeypatch.setenv("OPENROUTER_API_KEY", sentinel)
    Config.teardown()

    with pytest.raises(ImageProviderConfigurationError, match="not initialized") as exc_info:
        require_openrouter_api_key()

    assert sentinel not in str(exc_info.value)
    assert sentinel not in caplog.text
