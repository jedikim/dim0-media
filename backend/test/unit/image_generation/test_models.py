"""Unit tests for trusted image-generation domain models."""

from __future__ import annotations

from hashlib import sha256

import pytest

from pydantic import ValidationError

import topix.image_generation.models as image_models

from topix.image_generation.models import (
    MAX_PROVIDER_IMAGE_BYTES,
    ImageAssetCreate,
    ImageAssetSource,
    ProviderImageReference,
    ProviderImageRequest,
)


def _asset_kwargs() -> dict[str, object]:
    """Return deterministic valid metadata for one image asset."""
    return {
        "board_uid": "board-1",
        "created_by_user_uid": "user-1",
        "source_kind": ImageAssetSource.UPLOADED,
        "mime_type": "image/png",
        "byte_size": 1,
        "width": 1,
        "height": 1,
        "content_sha256": "a" * 64,
    }


@pytest.mark.parametrize(
    "storage_key",
    [
        "./images/x.png",
        "images/./x.png",
        "images/../x.png",
        "images//x.png",
        "images/",
        ".",
        "..",
        "/images/x.png",
        "images\\x.png",
        "https://example.test/x.png",
    ],
)
def test_asset_rejects_unsafe_raw_storage_keys(storage_key: str) -> None:
    """Raw dot, empty, URL, absolute, and backslash forms never normalize through."""
    with pytest.raises(ValidationError, match="storage_key"):
        ImageAssetCreate(storage_key=storage_key, **_asset_kwargs())


@pytest.mark.parametrize("storage_key", ["images/x.png", "generated/01ABCDEF/result.avif"])
def test_asset_accepts_internal_relative_storage_keys(storage_key: str) -> None:
    """Opaque internal relative keys accepted by PostgreSQL also validate here."""
    asset = ImageAssetCreate(storage_key=storage_key, **_asset_kwargs())
    assert asset.storage_key == storage_key


def test_asset_rejects_svg_mime_type() -> None:
    """Active image assets are restricted to the raster allowlist."""
    with pytest.raises(ValidationError, match="mime_type"):
        ImageAssetCreate(storage_key="images/x.svg", **(_asset_kwargs() | {"mime_type": "image/svg+xml"}))


def _reference(*, content: bytes, ordinal: int = 0) -> ProviderImageReference:
    """Build one hash-verified in-memory provider reference."""
    return ProviderImageReference(
        asset_uid=f"asset-{ordinal}",
        ordinal=ordinal,
        mime_type="image/png",
        content_sha256=sha256(content).hexdigest(),
        width=1,
        height=1,
        content=content,
    )


def test_provider_reference_rejects_payload_above_memory_ceiling() -> None:
    """A single domain reference cannot retain unbounded external bytes."""
    content = b"x" * (MAX_PROVIDER_IMAGE_BYTES + 1)
    with pytest.raises(ValidationError, match="at most"):
        _reference(content=content)


def test_provider_request_rejects_aggregate_bytes_above_memory_ceiling(monkeypatch) -> None:
    """Many individually valid references also have one aggregate request cap."""
    monkeypatch.setattr(image_models, "MAX_PROVIDER_REQUEST_BYTES", 3)
    references = (_reference(content=b"aa", ordinal=0), _reference(content=b"bb", ordinal=1))

    with pytest.raises(ValidationError, match="request byte limit"):
        ProviderImageRequest(
            generation_uid="generation-1",
            attempt_uid="attempt-1",
            model_id="test/model",
            prompt="test",
            references=references,
        )


def test_verified_reference_is_not_rehashed_when_reused(monkeypatch) -> None:
    """Frozen trusted instances verify once when nested, copied, or revalidated."""
    calls = 0
    real_sha256 = sha256

    def counting_sha256(content: bytes):
        """Count digest construction while preserving hashlib behavior."""
        nonlocal calls
        calls += 1
        return real_sha256(content)

    monkeypatch.setattr(image_models, "sha256", counting_sha256)
    reference = _reference(content=b"reference")
    request = ProviderImageRequest(
        generation_uid="generation-1",
        attempt_uid="attempt-1",
        model_id="test/model",
        prompt="test",
        references=(reference,),
    )

    request.model_copy()
    ProviderImageReference.model_validate(reference)
    assert calls == 1
