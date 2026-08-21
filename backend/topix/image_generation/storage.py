"""Confined storage and raster validation for image generation."""

from __future__ import annotations

import asyncio
import os
import tempfile

from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from topix.image_generation.models import (
    MAX_GENERATED_IMAGE_PIXELS,
    MAX_PROVIDER_IMAGE_BYTES,
    GeneratedImagePayload,
    ImageAssetCreate,
    ImageAssetSnapshot,
    ImageContentValidationError,
    ImageStorageError,
    ProviderRasterMimeType,
)
from topix.utils.file import DATADIR

_FORMAT_TO_MIME: dict[str, ProviderRasterMimeType] = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
_MIME_TO_EXTENSION: dict[ProviderRasterMimeType, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


@dataclass(frozen=True)
class ValidatedRaster:
    """Trusted metadata derived from bounded raster bytes."""

    mime_type: ProviderRasterMimeType
    width: int
    height: int
    content_sha256: str


def validate_raster_bytes(
    content: bytes,
    *,
    claimed_mime_type: str | None = None,
) -> ValidatedRaster:
    """Validate bounded PNG/JPEG/WebP bytes without trusting provider metadata."""
    if not content or len(content) > MAX_PROVIDER_IMAGE_BYTES:
        raise ImageContentValidationError("Image content exceeds the allowed byte size")

    try:
        with Image.open(BytesIO(content)) as image:
            mime_type = _FORMAT_TO_MIME.get(image.format or "")
            if mime_type is None:
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
        if asset.byte_size > MAX_PROVIDER_IMAGE_BYTES:
            raise ImageContentValidationError("Image asset exceeds the allowed byte size")
        content = await asyncio.to_thread(self._read_bounded, asset.storage_key)
        validated = validate_raster_bytes(content, claimed_mime_type=asset.mime_type)
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
            if path.stat().st_size > MAX_PROVIDER_IMAGE_BYTES:
                raise ImageContentValidationError("Image asset exceeds the allowed byte size")
            with path.open("rb") as file:
                content = file.read(MAX_PROVIDER_IMAGE_BYTES + 1)
        except ImageContentValidationError:
            raise
        except OSError as exc:
            raise ImageStorageError("Image asset content is unavailable") from exc
        if len(content) > MAX_PROVIDER_IMAGE_BYTES:
            raise ImageContentValidationError("Image asset exceeds the allowed byte size")
        return content

    async def write_generated(self, generation_uid: str, image: GeneratedImagePayload) -> str:
        """Atomically write a validated generated raster under a content-addressed key."""
        validated = validate_raster_bytes(image.content, claimed_mime_type=image.mime_type)
        if validated.width != image.width or validated.height != image.height or validated.content_sha256 != image.content_sha256:
            raise ImageContentValidationError("Generated image metadata does not match its bytes")
        extension = _MIME_TO_EXTENSION[validated.mime_type]
        storage_key = f"images/generated/{generation_uid}/{validated.content_sha256}.{extension}"
        ImageAssetCreate.validate_storage_key(storage_key)
        await asyncio.to_thread(self._write_atomic, storage_key, image.content)
        return storage_key

    def _write_atomic(self, storage_key: str, content: bytes) -> None:
        """Write and fsync a temporary sibling before atomic replacement."""
        destination = self._resolve(storage_key, must_exist=False)
        parent = destination.parent
        parent.mkdir(parents=True, exist_ok=True)
        resolved_parent = parent.resolve(strict=True)
        if self._root not in resolved_parent.parents:
            raise ImageStorageError("Generated image destination is unavailable")

        descriptor, temporary_name = tempfile.mkstemp(prefix=".image-generation-", dir=resolved_parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, destination)
            directory_fd = os.open(resolved_parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            raise ImageStorageError("Generated image could not be persisted") from exc

    async def delete_generated(self, storage_key: str) -> bool:
        """Best-effort delete one generated key without accepting arbitrary assets."""
        if not storage_key.startswith("images/generated/"):
            return False
        return await asyncio.to_thread(self._delete_generated, storage_key)

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
