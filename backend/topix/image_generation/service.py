"""Application service for auditable server-side image generation."""

from __future__ import annotations

import asyncio
import logging
import time

from topix.image_generation.capabilities import validate_generation_parameters
from topix.image_generation.models import (
    MAX_GENERATED_IMAGE_PIXELS,
    MAX_PROVIDER_ENCODED_REQUEST_BYTES,
    MAX_PROVIDER_REFERENCE_IMAGE_BYTES,
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
    estimate_provider_request_bytes,
)
from topix.image_generation.providers.base import ImageProviderAdapter
from topix.image_generation.storage import ImageStorage
from topix.image_generation.tasks import ImageGenerationTaskManager
from topix.store.image_generation import ImageGenerationStore

logger = logging.getLogger(__name__)

_REFERENCE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
DEFAULT_IMAGE_GENERATION_LEASE_SECONDS = 120.0
DEFAULT_IMAGE_GENERATION_HEARTBEAT_SECONDS = 30.0


class ImageGenerationService:
    """Coordinate validation, audit, provider execution, and safe storage."""

    def __init__(
        self,
        *,
        store: ImageGenerationStore,
        adapter: ImageProviderAdapter,
        storage: ImageStorage,
        tasks: ImageGenerationTaskManager,
        worker_uid: str,
        lease_seconds: float = DEFAULT_IMAGE_GENERATION_LEASE_SECONDS,
        heartbeat_seconds: float = DEFAULT_IMAGE_GENERATION_HEARTBEAT_SECONDS,
    ) -> None:
        """Bind the shared image-generation dependencies."""
        if not worker_uid:
            raise ValueError("worker_uid is required")
        if lease_seconds <= 0 or heartbeat_seconds <= 0 or heartbeat_seconds >= lease_seconds:
            raise ValueError("Image generation heartbeat must be positive and shorter than its lease")
        self._store = store
        self._adapter = adapter
        self._storage = storage
        self._tasks = tasks
        self._worker_uid = worker_uid
        self._lease_seconds = lease_seconds
        self._heartbeat_seconds = heartbeat_seconds

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
        self._validate_reference_metadata(assets, model_id=model_id, prompt=prompt)
        generation = GenerationStart(
            client_request_uid=client_request_uid,
            user_uid=user_uid,
            board_uid=board_uid,
            worker_uid=self._worker_uid,
            generator_node_uid=generator_node_uid,
            provider=self._adapter.provider_id,
            model_id=model_id,
            prompt=prompt,
            parameters=parameters,
            references=tuple(GenerationReference(ordinal=ordinal, asset_uid=asset.asset_uid) for ordinal, asset in enumerate(assets)),
        )
        outcome = await self._store.start_generation(generation, lease_seconds=self._lease_seconds)
        if not outcome.created:
            return outcome

        try:
            self._tasks.schedule(
                generation.uid,
                lambda: self._execute_generation(generation=generation, assets=assets),
                keepalive=lambda: self._store.renew_lease(
                    generation_uid=generation.uid,
                    worker_uid=self._worker_uid,
                    lease_seconds=self._lease_seconds,
                ),
                heartbeat_seconds=self._heartbeat_seconds,
                lease_seconds=self._lease_seconds,
            )
        except RuntimeError:
            await self._finalize_failure(
                generation=generation,
                error=ImageProviderError("worker_lost", "The image generation worker is unavailable"),
                latency_ms=0,
            )
            raise
        return outcome

    @staticmethod
    def _validate_reference_metadata(
        assets: tuple[ImageAssetRecord, ...],
        *,
        model_id: str,
        prompt: str,
    ) -> None:
        """Reject unsafe reference metadata before reading or provider work."""
        total_bytes = 0
        for asset in assets:
            if asset.mime_type not in _REFERENCE_MIME_TYPES:
                raise ImageAssetResolutionError("One or more reference assets use an unsupported image format")
            if asset.byte_size > MAX_PROVIDER_REFERENCE_IMAGE_BYTES:
                raise ImageAssetResolutionError("One or more reference assets exceed the byte limit")
            if asset.width * asset.height > MAX_GENERATED_IMAGE_PIXELS:
                raise ImageAssetResolutionError("One or more reference assets exceed the pixel limit")
            total_bytes += asset.byte_size
        if total_bytes > MAX_PROVIDER_REQUEST_BYTES:
            raise ImageAssetResolutionError("Reference assets exceed the request byte limit")
        if (
            estimate_provider_request_bytes(
                model_id=model_id,
                prompt=prompt,
                reference_byte_sizes=tuple(asset.byte_size for asset in assets),
            )
            > MAX_PROVIDER_ENCODED_REQUEST_BYTES
        ):
            raise ImageAssetResolutionError("Encoded reference request exceeds the memory limit")

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
            storage_key = self._storage.generated_storage_key(generation.uid, result.image)
            pending_recorded = await self._store.set_pending_output(
                generation_uid=generation.uid,
                worker_uid=self._worker_uid,
                storage_key=storage_key,
            )
            if not pending_recorded:
                raise RuntimeError("Image generation ownership was lost before persistence")
            written_storage_key = await self._storage.write_generated(generation.uid, result.image)
            if written_storage_key != storage_key:
                raise RuntimeError("Generated storage key changed during persistence")
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
                worker_uid=self._worker_uid,
                output_asset=output_asset,
                result=result,
                latency_ms=self._latency_ms(started),
            )
        except asyncio.CancelledError:
            await asyncio.shield(
                self._handle_failure(
                    generation=generation,
                    error=ImageProviderError("worker_lost", "The image generation worker stopped before completion"),
                    latency_ms=self._latency_ms(started),
                    storage_key=storage_key,
                )
            )
            raise
        except ImageProviderError as error:
            await self._handle_failure(
                generation=generation,
                error=error,
                latency_ms=self._latency_ms(started),
                storage_key=storage_key,
            )
        except (ImageStorageError, ImageContentValidationError):
            if stage == "reference":
                code = "reference_content_mismatch"
                message = "A reference image is unavailable or no longer matches its audit metadata"
            else:
                code = "result_persist_failed"
                message = "The generated image could not be safely persisted"
            await self._handle_failure(
                generation=generation,
                error=ImageProviderError(code, message),
                latency_ms=self._latency_ms(started),
                storage_key=storage_key,
            )
        except Exception as exc:  # noqa: BLE001 - audit every unexpected background failure
            code = "provider_unavailable" if stage == "provider" else "result_persist_failed"
            message = "The image provider is temporarily unavailable" if stage == "provider" else "The image generation could not be completed"
            committed = await self._handle_failure(
                generation=generation,
                error=ImageProviderError(code, message),
                latency_ms=self._latency_ms(started),
                storage_key=storage_key,
            )
            if committed:
                logger.warning("Recovered a committed image generation after an ambiguous persistence response")
                return
            raise RuntimeError(f"Image generation failed during {stage} ({type(exc).__name__})") from None

    async def _handle_failure(
        self,
        *,
        generation: GenerationStart,
        error: ImageProviderError,
        latency_ms: int,
        storage_key: str | None,
    ) -> bool:
        """Compensate persisted bytes, then safely finalize without masking the cause."""
        compensation = await self._compensate_output(generation=generation, storage_key=storage_key)
        if compensation == "committed":
            return True
        if compensation == "uncertain":
            return False
        await self._finalize_failure(generation=generation, error=error, latency_ms=latency_ms)
        return False

    async def _compensate_output(self, *, generation: GenerationStart, storage_key: str | None) -> str:
        """Preserve committed output or delete only a proven unreferenced file."""
        if storage_key is None:
            return "cleaned"
        try:
            state = await self._store.get_storage_state(generation_uid=generation.uid, storage_key=storage_key)
        except Exception as exc:  # noqa: BLE001 - uncertainty must preserve potentially committed bytes
            logger.warning("Image output compensation state lookup failed (%s)", type(exc).__name__)
            return "uncertain"
        if state is None:
            logger.warning("Image output compensation found no generation state")
            return "uncertain"
        if state.status == "succeeded" and state.output_storage_key == storage_key and state.storage_key_referenced:
            return "committed"
        if state.storage_key_referenced:
            logger.warning("Image output compensation preserved a referenced storage key")
            return "committed"
        if not await self._storage.ensure_generated_deleted(storage_key):
            logger.warning("Image output compensation cleanup failed")
            return "uncertain"
        try:
            await self._store.clear_pending_output(generation_uid=generation.uid, storage_key=storage_key)
        except Exception as exc:  # noqa: BLE001 - durable pending work remains retryable
            logger.warning("Image output compensation acknowledgement failed (%s)", type(exc).__name__)
        return "cleaned"

    async def _finalize_failure(
        self,
        *,
        generation: GenerationStart,
        error: ImageProviderError,
        latency_ms: int,
    ) -> None:
        """Atomically terminally fail a no-retry run without masking its cause."""
        try:
            transitioned = await self._store.finish_terminal_failed(
                generation_uid=generation.uid,
                attempt_uid=generation.attempt_uid,
                worker_uid=self._worker_uid,
                error=error,
                latency_ms=latency_ms,
            )
        except Exception as exc:  # noqa: BLE001 - compensation must never replace the original failure
            logger.warning("Image generation failure finalization failed (%s)", type(exc).__name__)
            return
        if not transitioned:
            logger.info("Image generation failure finalization observed a terminal or ownership conflict")

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

    async def reconcile_incomplete(self) -> int:
        """Fail expired leases and drain durable unreferenced-file cleanup work."""
        reconciled = await self._store.reconcile_incomplete()
        if reconciled:
            logger.warning("Reconciled %d expired image generation leases", reconciled)
        for pending in await self._store.list_pending_outputs():
            if not await self._storage.ensure_generated_deleted(pending.storage_key):
                logger.warning("Reconciled image output cleanup failed")
                continue
            try:
                await self._store.clear_pending_output(
                    generation_uid=pending.generation_uid,
                    storage_key=pending.storage_key,
                )
            except Exception as exc:  # noqa: BLE001 - the durable row remains for a later retry
                logger.warning("Reconciled image output acknowledgement failed (%s)", type(exc).__name__)
        return reconciled
