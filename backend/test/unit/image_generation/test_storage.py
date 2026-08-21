"""Security and integrity tests for image-generation storage."""

from __future__ import annotations

from hashlib import sha256
from io import BytesIO

import pytest

from PIL import Image

import topix.image_generation.storage as image_storage

from topix.image_generation.models import (
    GeneratedImagePayload,
    ImageAssetSnapshot,
    ImageContentValidationError,
    ImageStorageError,
)
from topix.image_generation.storage import ImageStorage, validate_raster_bytes


def _image_bytes(image_format: str = "PNG", *, size: tuple[int, int] = (10, 7)) -> bytes:
    """Create a small valid raster fixture."""
    output = BytesIO()
    Image.new("RGB", size, color="green").save(output, format=image_format)
    return output.getvalue()


def _snapshot(storage_key: str, content: bytes, *, mime_type: str = "image/png") -> ImageAssetSnapshot:
    """Build immutable metadata for one local test asset."""
    return ImageAssetSnapshot(
        asset_uid="asset-1",
        source_kind="uploaded",
        storage_key=storage_key,
        mime_type=mime_type,
        byte_size=len(content),
        width=10,
        height=7,
        content_sha256=sha256(content).hexdigest(),
    )


@pytest.mark.parametrize(
    "storage_key",
    ["../outside.png", "images/../outside.png", "/etc/passwd", "images//x.png", "images\\x.png", "https://example.test/x.png"],
)
@pytest.mark.asyncio
async def test_storage_rejects_untrusted_keys(tmp_path, storage_key: str) -> None:
    """Raw paths and URL syntax cannot reach the storage root."""
    storage = ImageStorage(tmp_path)
    with pytest.raises((ImageStorageError, ValueError)):
        await storage.read_asset(_snapshot(storage_key, _image_bytes()))


@pytest.mark.asyncio
async def test_storage_rejects_symlink_escape(tmp_path) -> None:
    """A key resolving through a symlink outside the root is rejected."""
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    content = _image_bytes()
    (outside / "secret.png").write_bytes(content)
    (root / "images").symlink_to(outside, target_is_directory=True)

    storage = ImageStorage(root)
    with pytest.raises(ImageStorageError):
        await storage.read_asset(_snapshot("images/secret.png", content))


@pytest.mark.asyncio
async def test_storage_verifies_immutable_metadata_after_read(tmp_path) -> None:
    """Length, digest, MIME, and dimensions must match the asset snapshot."""
    content = _image_bytes()
    path = tmp_path / "images" / "reference.png"
    path.parent.mkdir(parents=True)
    path.write_bytes(content)
    storage = ImageStorage(tmp_path)

    assert await storage.read_asset(_snapshot("images/reference.png", content)) == content

    changed = _image_bytes(size=(9, 7))
    path.write_bytes(changed)
    with pytest.raises(ImageContentValidationError, match="metadata"):
        await storage.read_asset(_snapshot("images/reference.png", content))


@pytest.mark.parametrize(
    ("image_format", "mime_type"),
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")],
)
def test_raster_validation_accepts_only_supported_formats(image_format: str, mime_type: str) -> None:
    """PNG, JPEG, and WebP signatures are detected from bytes."""
    result = validate_raster_bytes(_image_bytes(image_format), claimed_mime_type=mime_type)
    assert result.mime_type == mime_type
    assert (result.width, result.height) == (10, 7)


@pytest.mark.parametrize("content", [b"<svg></svg>", b"<html></html>", b"<?xml version='1.0'?>"])
def test_raster_validation_rejects_markup(content: bytes) -> None:
    """SVG, HTML, and XML cannot pass as generated raster output."""
    with pytest.raises(ImageContentValidationError):
        validate_raster_bytes(content)


def test_raster_validation_rejects_excessive_pixel_count(monkeypatch) -> None:
    """Valid compressed bytes still fail when decoded dimensions exceed the cap."""
    monkeypatch.setattr(image_storage, "MAX_GENERATED_IMAGE_PIXELS", 50)
    with pytest.raises(ImageContentValidationError, match="pixel"):
        validate_raster_bytes(_image_bytes(size=(10, 7)))


@pytest.mark.asyncio
async def test_generated_write_is_content_addressed_and_deletable(tmp_path) -> None:
    """Generated output is atomically stored under its digest and can be cleaned up."""
    content = _image_bytes("PNG")
    digest = sha256(content).hexdigest()
    image = GeneratedImagePayload(
        mime_type="image/png",
        content=content,
        width=10,
        height=7,
        content_sha256=digest,
    )
    storage = ImageStorage(tmp_path)

    key = await storage.write_generated("generation-1", image)

    assert key == f"images/generated/generation-1/{digest}.png"
    assert (tmp_path / key).read_bytes() == content
    assert not list((tmp_path / "images" / "generated" / "generation-1").glob(".image-generation-*"))
    assert await storage.delete_generated(key) is True
    assert not (tmp_path / key).exists()
