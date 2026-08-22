"""Unit tests for the dedicated OpenRouter Image API adapter."""

from __future__ import annotations

import base64
import json
import logging

from hashlib import sha256
from io import BytesIO
from uuid import uuid4

import httpx
import pytest

from PIL import Image
from pydantic import SecretStr

from topix.config.catalog import OPENROUTER_BASE_URL
from topix.image_generation.config import ImageProviderConfigurationError
from topix.image_generation.models import (
    ImageGenerationParameters,
    ImageProviderError,
    ProviderImageReference,
    ProviderImageRequest,
)
from topix.image_generation.providers.openrouter import OpenRouterImageAdapter, serialize_openrouter_request


def _image_bytes(image_format: str = "PNG", color: str = "red") -> bytes:
    """Create one small deterministic raster for adapter tests."""
    output = BytesIO()
    Image.new("RGB", (8, 6), color=color).save(output, format=image_format)
    return output.getvalue()


def _reference(content: bytes, *, ordinal: int, asset_uid: str) -> ProviderImageReference:
    """Build one validated provider reference."""
    mime = "image/jpeg" if content.startswith(b"\xff\xd8") else "image/png"
    return ProviderImageReference(
        asset_uid=asset_uid,
        ordinal=ordinal,
        mime_type=mime,
        content_sha256=sha256(content).hexdigest(),
        width=8,
        height=6,
        content=content,
    )


def _request(
    *,
    model_id: str = "x-ai/grok-imagine-image-2.0",
    prompt: str = "Create a safe classroom image",
    parameters: ImageGenerationParameters | None = None,
    references: tuple[ProviderImageReference, ...] = (),
) -> ProviderImageRequest:
    """Build one credential-free adapter request."""
    return ProviderImageRequest(
        generation_uid="generation-1",
        attempt_uid="attempt-1",
        model_id=model_id,
        prompt=prompt,
        parameters=parameters or ImageGenerationParameters(),
        references=references,
    )


def test_serialization_preserves_reference_order_and_top_level_options() -> None:
    """The dedicated Images API shape keeps references ordered and options top-level."""
    first = _image_bytes("PNG", "red")
    second = _image_bytes("JPEG", "blue")
    payload = serialize_openrouter_request(
        _request(
            parameters=ImageGenerationParameters(resolution="2K", aspect_ratio="16:9", quality="medium"),
            references=(
                _reference(first, ordinal=0, asset_uid="asset-first"),
                _reference(second, ordinal=1, asset_uid="asset-second"),
            ),
        )
    )

    assert payload["resolution"] == "2K"
    assert payload["aspect_ratio"] == "16:9"
    assert payload["quality"] == "medium"
    assert payload["n"] == 1
    assert "image_config" not in payload
    assert "output_format" not in payload
    urls = [item["image_url"]["url"] for item in payload["input_references"]]
    assert urls[0] == f"data:image/png;base64,{base64.b64encode(first).decode('ascii')}"
    assert urls[1] == f"data:image/jpeg;base64,{base64.b64encode(second).decode('ascii')}"


def test_serialization_omits_unset_and_unadvertised_options() -> None:
    """The adapter sends no optional field that the validated request did not select."""
    payload = serialize_openrouter_request(_request())

    assert payload == {
        "model": "x-ai/grok-imagine-image-2.0",
        "prompt": "Create a safe classroom image",
        "n": 1,
    }


def test_gemini_4k_is_pinned_to_the_verified_ai_studio_endpoint() -> None:
    """Only the endpoint advertising 4K may receive Gemini 4K requests."""
    payload = serialize_openrouter_request(
        _request(
            model_id="google/gemini-3-pro-image",
            parameters=ImageGenerationParameters(resolution="4K"),
        )
    )
    assert payload["provider"] == {"only": ["google-ai-studio/global"], "allow_fallbacks": False}

    unpinned = serialize_openrouter_request(
        _request(
            model_id="google/gemini-3-pro-image",
            parameters=ImageGenerationParameters(resolution="2K"),
        )
    )
    assert "provider" not in unpinned


@pytest.mark.asyncio
async def test_adapter_normalizes_success_usage_cost_and_optional_body_id() -> None:
    """A valid response becomes one sanitized provider-neutral result."""
    content = _image_bytes("PNG")
    sentinel = f"runtime-{uuid4()}"

    async def handler(request: httpx.Request) -> httpx.Response:
        """Assert the adapter calls only the dedicated Images endpoint."""
        assert request.url == f"{OPENROUTER_BASE_URL}/images"
        assert request.headers["Authorization"] == f"Bearer {sentinel}"
        sent = json.loads(request.content)
        assert sent["model"] == "x-ai/grok-imagine-image-2.0"
        return httpx.Response(
            200,
            headers={"X-Generation-Id": "unverified-header-must-be-ignored"},
            json={
                "id": "provider-generation-1",
                "data": [{"b64_json": base64.b64encode(content).decode("ascii"), "media_type": "image/png"}],
                "usage": {"prompt_tokens": 7, "completion_tokens": 11, "total_tokens": 18, "cost": 0.0125},
            },
        )

    async with httpx.AsyncClient(
        base_url=f"{OPENROUTER_BASE_URL}/",
        transport=httpx.MockTransport(handler),
        follow_redirects=False,
    ) as client:
        result = await OpenRouterImageAdapter(client, SecretStr(sentinel)).generate(_request())

    assert result.provider_request_id == "provider-generation-1"
    assert result.image.content == content
    assert result.image.mime_type == "image/png"
    assert result.usage is not None and result.usage.total_units == 18
    assert str(result.cost_usd) == "0.0125"


@pytest.mark.asyncio
async def test_adapter_normalizes_jpeg_without_provider_request_id() -> None:
    """A JPEG response without an optional body ID retains exact image and usage metadata."""
    content = _image_bytes("JPEG")

    def handler(_: httpx.Request) -> httpx.Response:
        """Return the minimal successful shape observed from image providers."""
        return httpx.Response(
            200,
            json={
                "data": [{"b64_json": base64.b64encode(content).decode("ascii"), "media_type": "image/jpeg"}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8, "cost": 0.04},
            },
        )

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        result = await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())

    assert result.provider_request_id is None
    assert result.image.content == content
    assert result.image.mime_type == "image/jpeg"
    assert (result.image.width, result.image.height) == (8, 6)
    assert result.image.content_sha256 == sha256(content).hexdigest()
    assert result.usage is not None and result.usage.total_units == 8
    assert str(result.cost_usd) == "0.04"


@pytest.mark.asyncio
@pytest.mark.parametrize(("image_format", "mime_type"), [("PNG", "image/png"), ("WEBP", "image/webp")])
async def test_adapter_preserves_other_supported_raster_formats(image_format: str, mime_type: str) -> None:
    """PNG and WebP success paths remain byte-sniffed provider-neutral results."""
    content = _image_bytes(image_format)

    def handler(_: httpx.Request) -> httpx.Response:
        """Return one valid raster in the requested synthetic format."""
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(content).decode("ascii"), "media_type": mime_type}]})

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        result = await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())

    assert result.image.mime_type == mime_type
    assert result.image.content == content


@pytest.mark.asyncio
async def test_adapter_debug_logs_only_bounded_success_shape_names(caplog: pytest.LogCaptureFixture) -> None:
    """DEBUG diagnostics expose bounded names but no provider, credential, prompt, or image values."""
    content = _image_bytes("JPEG")
    api_key_value = f"runtime-key-{uuid4()}"
    prompt_value = f"runtime-prompt-{uuid4()}"
    body_value = f"runtime-body-{uuid4()}"
    header_value = f"runtime-header-{uuid4()}"
    encoded_image = base64.b64encode(content).decode("ascii")
    long_name = "provider-shape-" + "x" * 100
    extra_names = {f"extra-{index}": index for index in range(40)}

    def handler(_: httpx.Request) -> httpx.Response:
        """Return safe success metadata with values that must never reach logs."""
        return httpx.Response(
            200,
            headers={"X-Trace-Shape": header_value},
            json={
                "data": [{"b64_json": encoded_image, "media_type": "image/jpeg"}],
                "usage": {"cost": 0.04},
                "vendor_meta": body_value,
                long_name: "long-name-value",
                **extra_names,
            },
        )

    caplog.set_level(logging.DEBUG, logger="topix.image_generation.providers.openrouter")
    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        await OpenRouterImageAdapter(client, SecretStr(api_key_value)).generate(_request(prompt=prompt_value))

    diagnostic = caplog.text
    assert "OpenRouter image success response shape" in diagnostic
    assert "body_keys=" in diagnostic and "data" in diagnostic and "vendor_meta" in diagnostic
    assert "response_header_names=" in diagnostic and "x-trace-shape" in diagnostic
    assert long_name not in diagnostic
    assert long_name[:64] in diagnostic
    assert diagnostic.count("extra-") <= 28
    for hidden_value in (api_key_value, prompt_value, body_value, header_value, encoded_image, "long-name-value"):
        assert hidden_value not in diagnostic


@pytest.mark.asyncio
async def test_adapter_emits_no_shape_diagnostic_when_debug_is_disabled(caplog: pytest.LogCaptureFixture) -> None:
    """Normal logging levels omit success-response diagnostics entirely."""
    content = _image_bytes("PNG")

    def handler(_: httpx.Request) -> httpx.Response:
        """Return one ordinary successful image response."""
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(content).decode("ascii")}]})

    caplog.set_level(logging.INFO, logger="topix.image_generation.providers.openrouter")
    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())

    assert "OpenRouter image success response shape" not in caplog.text


@pytest.mark.asyncio
async def test_adapter_leaves_provider_request_id_null_when_body_has_no_bounded_id() -> None:
    """Undocumented response headers never become durable provider identifiers."""
    content = _image_bytes("PNG")

    def handler(_: httpx.Request) -> httpx.Response:
        """Return only an unverified response header."""
        return httpx.Response(
            200,
            headers={"X-Generation-Id": "header-only"},
            json={
                "id": "x" * 513,
                "data": [{"b64_json": base64.b64encode(content).decode("ascii"), "media_type": "image/png"}],
            },
        )

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        result = await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())

    assert result.provider_request_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "expected_code"),
    [
        (400, "provider_rejected"),
        (401, "provider_unauthorized"),
        (403, "provider_unauthorized"),
        (408, "provider_timeout"),
        (429, "provider_rate_limited"),
        (503, "provider_unavailable"),
    ],
)
async def test_adapter_sanitizes_provider_http_errors(
    status_code: int,
    expected_code: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Provider bodies and runtime secrets never escape an HTTP failure."""
    sentinel = f"runtime-{uuid4()}"

    def handler(_: httpx.Request) -> httpx.Response:
        """Return a body that must never be logged or propagated."""
        return httpx.Response(status_code, text=f"raw-provider-body-{sentinel}")

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ImageProviderError) as raised:
            await OpenRouterImageAdapter(client, SecretStr(sentinel)).generate(_request())

    assert raised.value.code == expected_code
    combined = f"{raised.value!r} {raised.value} {caplog.text}"
    assert sentinel not in combined
    assert "raw-provider-body" not in combined
    assert "Create a safe classroom image" not in combined
    assert "Authorization" not in combined


@pytest.mark.asyncio
async def test_adapter_sanitizes_timeout() -> None:
    """Network timeouts are normalized and never automatically retried."""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        """Raise one timeout and record that no second call occurs."""
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("unsafe raw timeout", request=request)

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ImageProviderError) as raised:
            await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())

    assert raised.value.code == "provider_timeout"
    assert calls == 1


@pytest.mark.asyncio
async def test_adapter_sanitizes_network_error_without_retry() -> None:
    """Connection failures become one safe error and are never retried automatically."""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        """Raise one connection error from the in-memory transport."""
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("unsafe network detail", request=request)

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ImageProviderError) as raised:
            await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())

    assert raised.value.code == "provider_unavailable"
    assert calls == 1


@pytest.mark.asyncio
async def test_adapter_maps_missing_server_key_without_exposing_configuration(
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A missing server credential fails safely before any HTTP request."""
    sentinel = f"runtime-{uuid4()}"

    def missing_key() -> None:
        """Simulate the existing fail-closed server key helper."""
        raise ImageProviderConfigurationError(f"missing configuration {sentinel}")

    monkeypatch.setattr("topix.image_generation.providers.openrouter.require_openrouter_api_key", missing_key)
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        """Fail the test if a keyless adapter reaches HTTP."""
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ImageProviderError) as raised:
            await OpenRouterImageAdapter(client).generate(_request())

    assert raised.value.code == "provider_unavailable"
    assert sentinel not in f"{raised.value!r} {raised.value} {caplog.text}"
    assert calls == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response_json",
    [
        {"data": []},
        {"data": [{"b64_json": "not-base64!"}]},
        {"data": [{"b64_json": base64.b64encode(b"<svg></svg>").decode("ascii"), "media_type": "image/svg+xml"}]},
        {"data": [{"b64_json": base64.b64encode(_image_bytes("PNG")).decode("ascii"), "media_type": "image/jpeg"}]},
    ],
)
async def test_adapter_rejects_malformed_or_unsafe_image_responses(response_json: dict[str, object]) -> None:
    """Malformed base64, count, SVG, and media mismatch all fail closed."""

    def handler(_: httpx.Request) -> httpx.Response:
        """Return one invalid provider response fixture."""
        return httpx.Response(200, json=response_json)

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ImageProviderError, match="provider") as raised:
            await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())
    assert raised.value.code == "invalid_provider_response"


@pytest.mark.asyncio
async def test_adapter_rejects_oversized_response_before_reading_image_data() -> None:
    """A declared oversized JSON response is rejected before buffering it."""

    def handler(_: httpx.Request) -> httpx.Response:
        """Advertise an impossible response length without a large fixture."""
        return httpx.Response(200, headers={"Content-Length": str(31 * 1024 * 1024)}, content=b"{}")

    async with httpx.AsyncClient(base_url=f"{OPENROUTER_BASE_URL}/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ImageProviderError) as raised:
            await OpenRouterImageAdapter(client, SecretStr(f"runtime-{uuid4()}")).generate(_request())
    assert raised.value.code == "invalid_provider_response"
