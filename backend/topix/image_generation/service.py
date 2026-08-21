"""Application service for auditable server-side image generation."""

from __future__ import annotations

import asyncio
import logging
import time

from datetime import datetime

from topix.image_generation.capabilities import validate_generation_parameters
from topix.image_generation.models import (
    MAX_GENERATED_IMAGE_PIXELS,
    MAX_PROVIDER_IMAGE_BYTES,
    MAX_PROVIDER_REQUEST_BYTES,
    GenerationReference,
    GenerationStart,
    GenerationStartOutcome,
    ImageAssetCreate,
    ImageAssetRecord,
    ImageAssetResolutionError,
    ImageAssetSource,
    ImageContentValidationError,
    ImageGenerationParameters,
    ImageGenerationRecord,
    ImageProviderError,
    ImageStorageError,
    ProviderImageReference,
    ProviderImageRequest,
)
from topix.image_generation.providers.base import ImageProviderAdapter
from topix.image_generation.storage import ImageStorage
from topix.image_generation.tasks import ImageGenerationTaskManager
from topix.store.image_generation import ImageGenerationStore

logger = logging.getLogger(__name__)

_REFERENCE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}


class ImageGenerationService:
    """Coordinate validation, audit, provider execution, and safe storage."""

    def __init__(
        self,
        *,
        store: ImageGenerationStore,
        adapter: ImageProviderAdapter,
        storage: ImageStorage,
        tasks: ImageGenerationTaskManager,
    ) -> None:
        """Bind the shared image-generation dependencies."""
        self._store = store
        self._adapter = adapter
        self._storage = storage
        self._tasks = tasks

    async def start_generation(
        self,
        *,
        user_uid: str,
        board_uid: str,
        client_request_uid: str,
        model_id: str,
        prompt: str,
        parameters: ImageGenerationParameters,
        reference_asset_uids: tuple[str, ...],
        generator_node_uid: str | None,
    ) -> GenerationStartOutcome:
        """Durably start one idempotent request and schedule only its winner."""
        validate_generation_parameters(model_id, parameters, reference_count=len(reference_asset_uids))
        assets = await self._store.get_assets(board_uid=board_uid, asset_uids=reference_asset_uids)
        self._validate_reference_metadata(assets)
        generation = GenerationStart(
            client_request_uid=client_request_uid,
            user_uid=user_uid,
            board_uid=board_uid,
            generator_node_uid=generator_node_uid,
            provider=self._adapter.provider_id,
            model_id=model_id,
            prompt=prompt,
            parameters=parameters,
            references=tuple(GenerationReference(ordinal=ordinal, asset_uid=asset.asset_uid) for ordinal, asset in enumerate(assets)),
        )
        outcome = await self._store.start_generation(generation)
        if not outcome.created:
            return outcome

        try:
            scheduled = self._tasks.schedule(
                generation.uid,
                lambda: self._execute_generation(generation=generation, assets=assets),
            )
        except RuntimeError:
            await self._finalize_failure(
                generation=generation,
                error=ImageProviderError("worker_lost", "The image generation worker is unavailable"),
                latency_ms=0,
            )
            raise
        if not scheduled:
            await self._finalize_failure(
                generation=generation,
                error=ImageProviderError("worker_lost", "The image generation worker is unavailable"),
                latency_ms=0,
            )
            raise RuntimeError("New image generation was not scheduled")
        return outcome

    @staticmethod
    def _validate_reference_metadata(assets: tuple[ImageAssetRecord, ...]) -> None:
        """Reject unsafe reference metadata before reading or provider work."""
        total_bytes = 0
        for asset in assets:
            if asset.mime_type not in _REFERENCE_MIME_TYPES:
                raise ImageAssetResolutionError("One or more reference assets use an unsupported image format")
            if asset.byte_size > MAX_PROVIDER_IMAGE_BYTES:
                raise ImageAssetResolutionError("One or more reference assets exceed the byte limit")
            if asset.width * asset.height > MAX_GENERATED_IMAGE_PIXELS:
                raise ImageAssetResolutionError("One or more reference assets exceed the pixel limit")
            total_bytes += asset.byte_size
        if total_bytes > MAX_PROVIDER_REQUEST_BYTES:
            raise ImageAssetResolutionError("Reference assets exceed the request byte limit")

    async def _execute_generation(  # noqa: C901 - explicit audit mapping for every execution stage
        self,
        *,
        generation: GenerationStart,
        assets: tuple[ImageAssetRecord, ...],
    ) -> None:
        """Execute one already-audited provider attempt without automatic retry."""
        started = time.monotonic()
        storage_key: str | None = None
        stage = "reference"
        try:
            references: list[ProviderImageReference] = []
            for ordinal, asset in enumerate(assets):
                content = await self._storage.read_asset(asset)
                references.append(
                    ProviderImageReference(
                        asset_uid=asset.asset_uid,
                        ordinal=ordinal,
                        mime_type=asset.mime_type,
                        content_sha256=asset.content_sha256,
                        width=asset.width,
                        height=asset.height,
                        content=content,
                    )
                )

            stage = "provider"
            result = await self._adapter.generate(
                ProviderImageRequest(
                    generation_uid=generation.uid,
                    attempt_uid=generation.attempt_uid,
                    model_id=generation.model_id,
                    prompt=generation.prompt,
                    parameters=generation.parameters,
                    references=tuple(references),
                )
            )

            stage = "persist"
            storage_key = await self._storage.write_generated(generation.uid, result.image)
            output_asset = ImageAssetCreate(
                board_uid=generation.board_uid,
                created_by_user_uid=generation.user_uid,
                source_kind=ImageAssetSource.GENERATED,
                storage_key=storage_key,
                mime_type=result.image.mime_type,
                byte_size=len(result.image.content),
                width=result.image.width,
                height=result.image.height,
                content_sha256=result.image.content_sha256,
            )
            await self._store.finish_succeeded(
                generation_uid=generation.uid,
                attempt_uid=generation.attempt_uid,
                output_asset=output_asset,
                result=result,
                latency_ms=self._latency_ms(started),
            )
        except asyncio.CancelledError:
            if storage_key is not None:
                await self._storage.delete_generated(storage_key)
            await asyncio.shield(
                self._finalize_failure(
                    generation=generation,
                    error=ImageProviderError("worker_lost", "The image generation worker stopped before completion"),
                    latency_ms=self._latency_ms(started),
                )
            )
            raise
        except ImageProviderError as error:
            if storage_key is not None:
                await self._storage.delete_generated(storage_key)
            await self._finalize_failure(generation=generation, error=error, latency_ms=self._latency_ms(started))
        except (ImageStorageError, ImageContentValidationError):
            if storage_key is not None:
                await self._storage.delete_generated(storage_key)
            if stage == "reference":
                code = "reference_content_mismatch"
                message = "A reference image is unavailable or no longer matches its audit metadata"
            else:
                code = "result_persist_failed"
                message = "The generated image could not be safely persisted"
            await self._finalize_failure(
                generation=generation,
                error=ImageProviderError(code, message),
                latency_ms=self._latency_ms(started),
            )
        except Exception as exc:  # noqa: BLE001 - audit every unexpected background failure
            if storage_key is not None:
                await self._storage.delete_generated(storage_key)
            code = "provider_unavailable" if stage == "provider" else "result_persist_failed"
            message = "The image provider is temporarily unavailable" if stage == "provider" else "The image generation could not be completed"
            await self._finalize_failure(
                generation=generation,
                error=ImageProviderError(code, message),
                latency_ms=self._latency_ms(started),
            )
            raise RuntimeError(f"Image generation failed during {stage} ({type(exc).__name__})") from None

    async def _finalize_failure(
        self,
        *,
        generation: GenerationStart,
        error: ImageProviderError,
        latency_ms: int,
    ) -> None:
        """Preserve the failed attempt, then terminally fail the no-retry run."""
        await self._store.finish_attempt_failed(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
            error=error,
            latency_ms=latency_ms,
        )
        await self._store.finish_failed(
            generation_uid=generation.uid,
            attempt_uid=generation.attempt_uid,
        )

    @staticmethod
    def _latency_ms(started: float) -> int:
        """Return nonnegative elapsed milliseconds for audit storage."""
        return max(0, int((time.monotonic() - started) * 1000))

    async def get_generation(self, *, board_uid: str, generation_uid: str) -> ImageGenerationRecord | None:
        """Return one board-scoped generation polling record."""
        return await self._store.get_generation(board_uid=board_uid, generation_uid=generation_uid)

    async def get_asset_content(self, *, board_uid: str, asset_uid: str) -> tuple[ImageAssetRecord, bytes] | None:
        """Return verified asset bytes for an authenticated board reader."""
        asset = await self._store.get_asset(board_uid=board_uid, asset_uid=asset_uid)
        if asset is None:
            return None
        content = await self._storage.read_asset(asset)
        return asset, content

    async def reconcile_incomplete(self, *, cutoff: datetime) -> int:
        """Fail incomplete runs that cannot have a live task in this process."""
        reconciled = await self._store.reconcile_incomplete(cutoff=cutoff)
        if reconciled:
            logger.warning("Reconciled %d incomplete image generations from an earlier process", reconciled)
        return reconciled
