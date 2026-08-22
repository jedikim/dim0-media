"""OpenRouter dedicated Image API adapter."""

from __future__ import annotations

import base64
import binascii
import json
import logging

from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from pydantic import SecretStr, ValidationError

from topix.image_generation.capabilities import get_resolution_provider_tag
from topix.image_generation.config import ImageProviderConfigurationError, require_openrouter_api_key
from topix.image_generation.models import (
    MAX_PROVIDER_IMAGE_BYTES,
    MAX_PROVIDER_RESPONSE_BYTES,
    GeneratedImagePayload,
    ImageContentValidationError,
    ImageProviderError,
    ProviderImageRequest,
    ProviderImageResult,
    ProviderUsage,
)
from topix.image_generation.storage import validate_provider_raster_bytes

_MAX_BASE64_IMAGE_CHARS = ((MAX_PROVIDER_IMAGE_BYTES + 2) // 3) * 4
_MAX_DIAGNOSTIC_NAMES = 32
_MAX_DIAGNOSTIC_NAME_LENGTH = 64

logger = logging.getLogger(__name__)


def serialize_openrouter_request(request: ProviderImageRequest) -> dict[str, Any]:
    """Serialize one credential-free request for `/api/v1/images`."""
    payload: dict[str, Any] = {
        "model": request.model_id,
        "prompt": request.prompt,
        "n": request.parameters.output_count,
    }
    # Output format stays provider-defined until a model capability explicitly advertises and validates it.
    if request.references:
        payload["input_references"] = [
            {
                "type": "image_url",
                "image_url": {"url": f"data:{reference.mime_type};base64,{base64.b64encode(reference.content).decode('ascii')}"},
            }
            for reference in request.references
        ]
    if request.parameters.resolution is not None:
        payload["resolution"] = request.parameters.resolution
    if request.parameters.aspect_ratio is not None:
        payload["aspect_ratio"] = request.parameters.aspect_ratio
    if request.parameters.quality is not None:
        payload["quality"] = request.parameters.quality

    provider_tag = get_resolution_provider_tag(request.model_id, request.parameters.resolution)
    if provider_tag is not None:
        payload["provider"] = {
            "only": [provider_tag],
            "allow_fallbacks": False,
        }
    return payload


def _safe_provider_request_id(value: Any) -> str | None:
    """Accept only a bounded optional provider ID from the parsed response body."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value and len(value) <= 512 else None


def _bounded_diagnostic_names(values: Iterable[object]) -> tuple[str, ...]:
    """Bound and escape provider-controlled names before DEBUG logging."""
    names: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        escaped = value.encode("unicode_escape").decode("ascii")
        names.append(escaped[:_MAX_DIAGNOSTIC_NAME_LENGTH])
        if len(names) == _MAX_DIAGNOSTIC_NAMES:
            break
    return tuple(names)


def _log_success_shape(payload: dict[str, Any], response_header_names: tuple[str, ...]) -> None:
    """Log only bounded success-response key and header names at DEBUG level."""
    if not logger.isEnabledFor(logging.DEBUG):
        return
    logger.debug(
        "OpenRouter image success response shape: body_key_count=%d body_keys=%s response_header_count=%d response_header_names=%s",
        len(payload),
        _bounded_diagnostic_names(payload),
        len(response_header_names),
        _bounded_diagnostic_names(response_header_names),
    )


def _status_error(response: httpx.Response) -> ImageProviderError:
    """Map provider status codes without parsing or exposing raw bodies."""
    if response.status_code in (401, 403):
        return ImageProviderError(
            "provider_unauthorized",
            "The image provider rejected the server credential",
        )
    if response.status_code == 408:
        return ImageProviderError(
            "provider_timeout",
            "The image provider timed out",
        )
    if response.status_code == 429:
        return ImageProviderError(
            "provider_rate_limited",
            "The image provider is rate limited",
        )
    if response.status_code >= 500:
        return ImageProviderError(
            "provider_unavailable",
            "The image provider is temporarily unavailable",
        )
    return ImageProviderError(
        "provider_rejected",
        "The image provider rejected the generation request",
    )


async def _read_bounded_response(response: httpx.Response) -> bytes:
    """Read a buffered JSON response with a strict memory ceiling."""
    content_length = response.headers.get("Content-Length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_PROVIDER_RESPONSE_BYTES:
                raise ImageProviderError("invalid_provider_response", "The image provider response is too large")
        except ValueError:
            raise ImageProviderError("invalid_provider_response", "The image provider returned invalid response metadata") from None

    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_PROVIDER_RESPONSE_BYTES:
            raise ImageProviderError("invalid_provider_response", "The image provider response is too large")
        chunks.append(chunk)
    return b"".join(chunks)


def _nonnegative_int(value: Any) -> int | None:
    """Normalize an optional nonnegative integer usage field."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid usage metadata")
    return value


def _cost(value: Any) -> Decimal | None:
    """Normalize an optional finite nonnegative provider-reported cost."""
    if value is None:
        return None
    try:
        result = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid cost metadata") from None
    if not result.is_finite() or result < 0:
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid cost metadata")
    return result


def _decode_image(item: Any) -> GeneratedImagePayload:
    """Strictly decode and validate one provider image item."""
    if not isinstance(item, dict):
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid image data")
    encoded = item.get("b64_json")
    if not isinstance(encoded, str) or not encoded or len(encoded) > _MAX_BASE64_IMAGE_CHARS:
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid image data")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid base64 image data") from None

    claimed_mime = item.get("media_type")
    if claimed_mime is not None and not isinstance(claimed_mime, str):
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid image metadata")
    try:
        raster = validate_provider_raster_bytes(content, claimed_mime_type=claimed_mime)
        return GeneratedImagePayload(
            mime_type=raster.mime_type,
            content=content,
            width=raster.width,
            height=raster.height,
            content_sha256=raster.content_sha256,
        )
    except (ImageContentValidationError, ValidationError):
        raise ImageProviderError("invalid_provider_response", "The image provider returned an unsafe image") from None


def _normalize_usage(payload: dict[str, Any], *, generated_images: int) -> tuple[ProviderUsage | None, Decimal | None]:
    """Normalize optional provider-reported usage and exact cost."""
    raw_usage = payload.get("usage")
    if raw_usage is None:
        return None, None
    if not isinstance(raw_usage, dict):
        raise ImageProviderError("invalid_provider_response", "The image provider returned invalid usage metadata")
    usage = ProviderUsage(
        input_units=_nonnegative_int(raw_usage.get("prompt_tokens")),
        output_units=_nonnegative_int(raw_usage.get("completion_tokens")),
        total_units=_nonnegative_int(raw_usage.get("total_tokens")),
        generated_images=generated_images,
    )
    return usage, _cost(raw_usage.get("cost"))


def _normalize_response(
    body: bytes,
    *,
    request: ProviderImageRequest,
    response_header_names: tuple[str, ...] = (),
) -> ProviderImageResult:
    """Validate an OpenRouter response into the provider-neutral result."""
    try:
        payload = json.loads(body, parse_float=Decimal)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ImageProviderError("invalid_provider_response", "The image provider returned malformed JSON") from None
    if not isinstance(payload, dict):
        raise ImageProviderError("invalid_provider_response", "The image provider returned an invalid response")
    data = payload.get("data")
    if not isinstance(data, list) or len(data) != request.parameters.output_count:
        raise ImageProviderError("invalid_provider_response", "The image provider returned an unexpected image count")
    if request.parameters.output_count != 1:
        raise ImageProviderError("invalid_provider_response", "Multiple image results are not supported")

    image = _decode_image(data[0])
    usage, cost = _normalize_usage(payload, generated_images=len(data))
    _log_success_shape(payload, response_header_names)

    return ProviderImageResult(
        image=image,
        provider_request_id=_safe_provider_request_id(payload.get("id")),
        usage=usage,
        cost_usd=cost,
    )


class OpenRouterImageAdapter:
    """Generate images through one injected shared OpenRouter HTTP client."""

    provider_id = "openrouter"

    def __init__(self, client: httpx.AsyncClient, api_key: SecretStr | None = None) -> None:
        """Bind a shared client and an optional server-resolved secret."""
        self._client = client
        self._api_key = api_key

    async def generate(self, request: ProviderImageRequest) -> ProviderImageResult:
        """Call `/api/v1/images` and return only validated sanitized output."""
        try:
            api_key = self._api_key or require_openrouter_api_key()
        except ImageProviderConfigurationError:
            raise ImageProviderError("provider_unavailable", "The image provider is not configured") from None

        try:
            async with self._client.stream(
                "POST",
                "images",
                headers={"Authorization": f"Bearer {api_key.get_secret_value()}"},
                json=serialize_openrouter_request(request),
            ) as response:
                if response.status_code >= 400:
                    raise _status_error(response)
                body = await _read_bounded_response(response)
                response_header_names = tuple(response.headers.keys())
        except ImageProviderError:
            raise
        except httpx.TimeoutException:
            raise ImageProviderError("provider_timeout", "The image provider timed out") from None
        except httpx.RequestError:
            raise ImageProviderError("provider_unavailable", "The image provider is temporarily unavailable") from None

        return _normalize_response(body, request=request, response_header_names=response_header_names)
