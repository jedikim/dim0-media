"""Confined storage and raster validation for image generation."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile

from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from topix.image_generation.models import (
    MAX_GENERATED_IMAGE_PIXELS,
    MAX_IMAGE_ASSET_BYTES,
    MAX_PROVIDER_IMAGE_BYTES,
    GeneratedImagePayload,
    ImageAssetCreate,
    ImageAssetSnapshot,
    ImageContentValidationError,
    ImageStorageError,
    ProviderRasterMimeType,
    RasterImageMimeType,
)
from topix.utils.file import DATADIR

logger = logging.getLogger(__name__)

_ASSET_FORMAT_TO_MIME: dict[str, RasterImageMimeType] = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
    "AVIF": "image/avif",
}
_PROVIDER_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
_MIME_TO_EXTENSION: dict[ProviderRasterMimeType, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


@dataclass(frozen=True)
class ValidatedRaster:
    """Trusted metadata derived from bounded raster bytes."""

    mime_type: RasterImageMimeType
    width: int
    height: int
    content_sha256: str


def _validate_image_bytes(
    content: bytes,
    *,
    claimed_mime_type: str | None = None,
    allowed_mime_types: frozenset[str],
    max_bytes: int,
) -> ValidatedRaster:
    """Validate bounded image bytes against an explicit MIME policy."""
    if not content or len(content) > max_bytes:
        raise ImageContentValidationError("Image content exceeds the allowed byte size")

    try:
        with Image.open(BytesIO(content)) as image:
            mime_type = _ASSET_FORMAT_TO_MIME.get(image.format or "")
            if mime_type is None or mime_type not in allowed_mime_types:
                raise ImageContentValidationError("Image content is not an allowed raster format")
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_GENERATED_IMAGE_PIXELS:
                raise ImageContentValidationError("Image dimensions exceed the allowed pixel size")
            image.verify()
    except ImageContentValidationError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageContentValidationError("Image content is not a valid bounded raster") from exc

    if claimed_mime_type is not None and claimed_mime_type != mime_type:
        raise ImageContentValidationError("Image media type does not match its bytes")
    return ValidatedRaster(
        mime_type=mime_type,
        width=width,
        height=height,
        content_sha256=sha256(content).hexdigest(),
    )


def validate_asset_bytes(content: bytes, *, claimed_mime_type: str | None = None) -> ValidatedRaster:
    """Validate a bounded PNG/JPEG/WebP/GIF/AVIF asset for authenticated serving."""
    return _validate_image_bytes(
        content,
        claimed_mime_type=claimed_mime_type,
        allowed_mime_types=frozenset(_ASSET_FORMAT_TO_MIME.values()),
        max_bytes=MAX_IMAGE_ASSET_BYTES,
    )


def validate_provider_raster_bytes(content: bytes, *, claimed_mime_type: str | None = None) -> ValidatedRaster:
    """Validate a bounded PNG/JPEG/WebP provider input or generated output."""
    return _validate_image_bytes(
        content,
        claimed_mime_type=claimed_mime_type,
        allowed_mime_types=_PROVIDER_MIME_TYPES,
        max_bytes=MAX_PROVIDER_IMAGE_BYTES,
    )


class ImageStorage:
    """Resolve and atomically persist opaque image keys below one data root."""

    def __init__(self, root: Path = DATADIR) -> None:
        """Bind storage to one resolved server-controlled root."""
        root.mkdir(parents=True, exist_ok=True)
        self._root = root.resolve()

    def _resolve(self, storage_key: str, *, must_exist: bool) -> Path:
        """Resolve one validated relative key and reject symlink escapes."""
        try:
            ImageAssetCreate.validate_storage_key(storage_key)
            resolved = (self._root / storage_key).resolve(strict=must_exist)
        except (OSError, ValueError) as exc:
            raise ImageStorageError("Image asset storage key is unavailable") from exc
        if self._root not in resolved.parents:
            raise ImageStorageError("Image asset storage key is unavailable")
        if must_exist and not resolved.is_file():
            raise ImageStorageError("Image asset content is unavailable")
        return resolved

    async def read_asset(self, asset: ImageAssetSnapshot) -> bytes:
        """Read bounded bytes and verify them against immutable asset metadata."""
        if asset.byte_size > MAX_IMAGE_ASSET_BYTES:
            raise ImageContentValidationError("Image asset exceeds the allowed byte size")
        content = await asyncio.to_thread(self._read_bounded, asset.storage_key)
        validated = validate_asset_bytes(content, claimed_mime_type=asset.mime_type)
        if (
            len(content) != asset.byte_size
            or validated.width != asset.width
            or validated.height != asset.height
            or validated.content_sha256 != asset.content_sha256
        ):
            raise ImageContentValidationError("Image asset content does not match its immutable metadata")
        return content

    def _read_bounded(self, storage_key: str) -> bytes:
        """Read at most one image plus a sentinel byte from a confined file."""
        path = self._resolve(storage_key, must_exist=True)
        try:
            if path.stat().st_size > MAX_IMAGE_ASSET_BYTES:
                raise ImageContentValidationError("Image asset exceeds the allowed byte size")
            with path.open("rb") as file:
                content = file.read(MAX_IMAGE_ASSET_BYTES + 1)
        except ImageContentValidationError:
            raise
        except OSError as exc:
            raise ImageStorageError("Image asset content is unavailable") from exc
        if len(content) > MAX_IMAGE_ASSET_BYTES:
            raise ImageContentValidationError("Image asset exceeds the allowed byte size")
        return content

    def generated_storage_key(self, generation_uid: str, image: GeneratedImagePayload) -> str:
        """Derive and validate the deterministic key before any filesystem write."""
        validated = validate_provider_raster_bytes(image.content, claimed_mime_type=image.mime_type)
        if validated.width != image.width or validated.height != image.height or validated.content_sha256 != image.content_sha256:
            raise ImageContentValidationError("Generated image metadata does not match its bytes")
        extension = _MIME_TO_EXTENSION[validated.mime_type]
        storage_key = f"images/generated/{generation_uid}/{validated.content_sha256}.{extension}"
        ImageAssetCreate.validate_storage_key(storage_key)
        return storage_key

    async def write_generated(self, generation_uid: str, image: GeneratedImagePayload) -> str:
        """Atomically write a validated generated raster under a content-addressed key."""
        storage_key = self.generated_storage_key(generation_uid, image)
        write_task = asyncio.create_task(asyncio.to_thread(self._write_atomic, storage_key, image.content))
        try:
            await asyncio.shield(write_task)
        except asyncio.CancelledError:
            created = False
            try:
                created = await write_task
            except Exception as exc:  # noqa: BLE001 - cancellation must retain its identity
                logger.warning("Cancelled image write completed with %s", type(exc).__name__)
            if created and not await asyncio.to_thread(self._ensure_generated_deleted, storage_key):
                logger.warning("Cancelled image write cleanup failed")
            raise
        return storage_key

    def _write_atomic(self, storage_key: str, content: bytes) -> bool:
        """Atomically write new content and report whether this call created it."""
        destination = self._resolve(storage_key, must_exist=False)
        parent = destination.parent
        parent.mkdir(parents=True, exist_ok=True)
        resolved_parent = parent.resolve(strict=True)
        if self._root not in resolved_parent.parents:
            raise ImageStorageError("Generated image destination is unavailable")

        if destination.exists():
            try:
                if destination.stat().st_size != len(content):
                    raise ImageStorageError("Generated image destination does not match its content key")
                with destination.open("rb") as file:
                    existing = file.read(len(content) + 1)
            except OSError as exc:
                raise ImageStorageError("Generated image destination is unavailable") from exc
            if existing != content:
                raise ImageStorageError("Generated image destination does not match its content key")
            return False

        descriptor, temporary_name = tempfile.mkstemp(prefix=".image-generation-", dir=resolved_parent)
        temporary = Path(temporary_name)
        replaced = False
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, destination)
            replaced = True
            directory_fd = os.open(resolved_parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            return True
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            if replaced:
                try:
                    destination.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Atomic image write rollback failed")
            raise ImageStorageError("Generated image could not be persisted") from exc

    async def delete_generated(self, storage_key: str) -> bool:
        """Best-effort delete one generated key without accepting arbitrary assets."""
        if not storage_key.startswith("images/generated/"):
            return False
        return await asyncio.to_thread(self._delete_generated, storage_key)

    async def ensure_generated_deleted(self, storage_key: str) -> bool:
        """Ensure one generated file is absent for idempotent durable cleanup."""
        if not storage_key.startswith("images/generated/"):
            return False
        return await asyncio.to_thread(self._ensure_generated_deleted, storage_key)

    def _delete_generated(self, storage_key: str) -> bool:
        """Delete one confined generated file and report whether it existed."""
        try:
            path = self._resolve(storage_key, must_exist=False)
            path.unlink(missing_ok=False)
            return True
        except FileNotFoundError:
            return False
        except (ImageStorageError, OSError):
            return False

    def _ensure_generated_deleted(self, storage_key: str) -> bool:
        """Delete a confined generated file and treat prior absence as success."""
        try:
            path = self._resolve(storage_key, must_exist=False)
            path.unlink(missing_ok=True)
            return True
        except (ImageStorageError, OSError):
            return False
