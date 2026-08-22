"""Security and integrity tests for image-generation storage."""

from __future__ import annotations

import asyncio
import os
import threading

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
from topix.image_generation.storage import ImageStorage, validate_asset_bytes, validate_provider_raster_bytes


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


@pytest.mark.parametrize(("image_format", "mime_type"), [("GIF", "image/gif"), ("AVIF", "image/avif")])
@pytest.mark.asyncio
async def test_storage_reads_full_asset_allowlist(tmp_path, image_format: str, mime_type: str) -> None:
    """GIF and AVIF remain readable through the authenticated asset boundary."""
    content = _image_bytes(image_format)
    storage_key = f"images/reference.{image_format.lower()}"
    path = tmp_path / storage_key
    path.parent.mkdir(parents=True)
    path.write_bytes(content)

    assert await ImageStorage(tmp_path).read_asset(_snapshot(storage_key, content, mime_type=mime_type)) == content


@pytest.mark.parametrize(
    ("image_format", "mime_type"),
    [
        ("PNG", "image/png"),
        ("JPEG", "image/jpeg"),
        ("WEBP", "image/webp"),
        ("GIF", "image/gif"),
        ("AVIF", "image/avif"),
    ],
)
def test_asset_validation_accepts_supported_storage_formats(image_format: str, mime_type: str) -> None:
    """Authenticated asset reads support the complete database raster allowlist."""
    result = validate_asset_bytes(_image_bytes(image_format), claimed_mime_type=mime_type)
    assert result.mime_type == mime_type
    assert (result.width, result.height) == (10, 7)


@pytest.mark.parametrize(("image_format", "mime_type"), [("GIF", "image/gif"), ("AVIF", "image/avif")])
def test_provider_validation_rejects_non_provider_asset_formats(image_format: str, mime_type: str) -> None:
    """GIF and AVIF remain serveable assets but cannot enter provider requests."""
    with pytest.raises(ImageContentValidationError, match="allowed raster") as exc_info:
        validate_provider_raster_bytes(_image_bytes(image_format), claimed_mime_type=mime_type)
    assert exc_info.value.reason == "unsupported_format"


@pytest.mark.parametrize("content", [b"<svg></svg>", b"<html></html>", b"<?xml version='1.0'?>"])
def test_raster_validation_rejects_markup(content: bytes) -> None:
    """SVG, HTML, and XML cannot pass as generated raster output."""
    with pytest.raises(ImageContentValidationError):
        validate_provider_raster_bytes(content)


def test_raster_validation_rejects_excessive_pixel_count(monkeypatch) -> None:
    """Valid compressed bytes still fail when decoded dimensions exceed the cap."""
    monkeypatch.setattr(image_storage, "MAX_GENERATED_IMAGE_PIXELS", 50)
    with pytest.raises(ImageContentValidationError, match="pixel") as exc_info:
        validate_provider_raster_bytes(_image_bytes(size=(10, 7)))
    assert exc_info.value.reason == "pixel_limit"


@pytest.mark.asyncio
async def test_uploaded_write_is_content_addressed_and_compensatable(tmp_path) -> None:
    """Uploaded keys contain verified digests and support exact failed-row cleanup."""
    content = _image_bytes("WEBP")
    raster = validate_provider_raster_bytes(content, claimed_mime_type="image/webp")
    storage = ImageStorage(tmp_path)

    key, created = await storage.write_uploaded(
        board_uid="board-1",
        asset_uid="asset-1",
        content=content,
        raster=raster,
    )

    assert created is True
    assert key == f"images/uploaded/board-1/asset-1/{raster.content_sha256}.webp"
    assert (tmp_path / key).read_bytes() == content
    assert await storage.ensure_uploaded_deleted(key) is True
    assert not (tmp_path / key).exists()


@pytest.mark.parametrize(
    ("image_format", "mime_type", "extension"),
    [("PNG", "image/png", "png"), ("JPEG", "image/jpeg", "jpg"), ("WEBP", "image/webp", "webp")],
)
@pytest.mark.asyncio
async def test_generated_write_is_content_addressed_and_deletable(
    tmp_path,
    image_format: str,
    mime_type: str,
    extension: str,
) -> None:
    """Generated raster formats use content-addressed keys with matching extensions."""
    content = _image_bytes(image_format)
    digest = sha256(content).hexdigest()
    image = GeneratedImagePayload(
        mime_type=mime_type,
        content=content,
        width=10,
        height=7,
        content_sha256=digest,
    )
    storage = ImageStorage(tmp_path)

    key = await storage.write_generated("generation-1", image)

    assert key == f"images/generated/generation-1/{digest}.{extension}"
    assert (tmp_path / key).read_bytes() == content
    assert not list((tmp_path / "images" / "generated" / "generation-1").glob(".image-generation-*"))
    assert await storage.delete_generated(key) is True
    assert not (tmp_path / key).exists()


@pytest.mark.asyncio
async def test_directory_fsync_failure_removes_new_destination(tmp_path, monkeypatch) -> None:
    """A post-replace directory fsync failure cannot leave an untracked output."""
    content = _image_bytes("PNG")
    image = GeneratedImagePayload(
        mime_type="image/png",
        content=content,
        width=10,
        height=7,
        content_sha256=sha256(content).hexdigest(),
    )
    storage = ImageStorage(tmp_path)
    real_fsync = os.fsync
    calls = 0

    def fail_directory_fsync(descriptor: int) -> None:
        """Allow the file fsync and fail the following directory fsync."""
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated directory fsync failure")
        real_fsync(descriptor)

    monkeypatch.setattr(image_storage.os, "fsync", fail_directory_fsync)
    with pytest.raises(ImageStorageError):
        await storage.write_generated("generation-1", image)

    assert not list(tmp_path.glob("images/generated/**/*.*"))


@pytest.mark.asyncio
async def test_cancelled_to_thread_write_waits_then_removes_created_file(tmp_path, monkeypatch) -> None:
    """Cancellation waits for the worker thread and compensates its completed write."""
    content = _image_bytes("PNG")
    image = GeneratedImagePayload(
        mime_type="image/png",
        content=content,
        width=10,
        height=7,
        content_sha256=sha256(content).hexdigest(),
    )
    storage = ImageStorage(tmp_path)
    started = threading.Event()
    release = threading.Event()

    def delayed_write(storage_key: str, output: bytes) -> bool:
        """Finish a real file write only after the async caller is cancelled."""
        started.set()
        release.wait(timeout=5)
        destination = tmp_path / storage_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(output)
        return True

    monkeypatch.setattr(storage, "_write_atomic", delayed_write)
    task = asyncio.create_task(storage.write_generated("generation-1", image))
    assert await asyncio.to_thread(started.wait, 5)
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert not list(tmp_path.glob("images/generated/**/*.*"))
