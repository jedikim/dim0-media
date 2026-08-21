"""Bounded process-local execution for image generation jobs."""

from __future__ import annotations

import asyncio
import logging

from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

DEFAULT_IMAGE_GENERATION_CONCURRENCY = 2
DEFAULT_IMAGE_GENERATION_SHUTDOWN_SECONDS = 10.0


class ImageGenerationTaskManager:
    """Keep strong task references and bound provider work per process."""

    def __init__(self, concurrency: int = DEFAULT_IMAGE_GENERATION_CONCURRENCY) -> None:
        """Initialize an empty task manager with a process-local semaphore."""
        if concurrency <= 0:
            raise ValueError("Image generation concurrency must be positive")
        self._semaphore = asyncio.Semaphore(concurrency)
        self._tasks: set[asyncio.Task[None]] = set()
        self._generation_uids: set[str] = set()
        self._closed = False

    def schedule(
        self,
        generation_uid: str,
        work: Callable[[], Awaitable[None]],
        *,
        keepalive: Callable[[], Awaitable[bool]] | None = None,
        heartbeat_seconds: float = 30.0,
        lease_seconds: float = 120.0,
    ) -> None:
        """Schedule one owned generation with an optional lease heartbeat."""
        if self._closed:
            raise RuntimeError("Image generation task manager is closed")
        if generation_uid in self._generation_uids:
            raise RuntimeError("Image generation is already scheduled in this process")
        if keepalive is not None and (heartbeat_seconds <= 0 or lease_seconds <= heartbeat_seconds):
            raise ValueError("Image generation lease must be longer than its positive heartbeat interval")

        task = asyncio.create_task(
            self._run_owned(generation_uid, work, keepalive, heartbeat_seconds, lease_seconds),
            name=f"image-generation:{generation_uid}",
        )
        self._generation_uids.add(generation_uid)
        self._tasks.add(task)
        task.add_done_callback(lambda completed: self._collect_result(generation_uid, completed))

    async def _run_owned(
        self,
        generation_uid: str,
        work: Callable[[], Awaitable[None]],
        keepalive: Callable[[], Awaitable[bool]] | None,
        heartbeat_seconds: float,
        lease_seconds: float,
    ) -> None:
        """Keep an owned task alive while it is queued and executing."""
        if keepalive is None:
            await self._run_bounded(work)
            return
        if not await self._initial_renewal(keepalive):
            raise RuntimeError("Image generation lease ownership was lost")

        stop = asyncio.Event()
        work_task = asyncio.create_task(
            self._run_bounded(work),
            name=f"image-generation-work:{generation_uid}",
        )
        lease_task = asyncio.create_task(
            self._maintain_lease(keepalive, stop, heartbeat_seconds, lease_seconds),
            name=f"image-generation-lease:{generation_uid}",
        )
        try:
            done, _ = await asyncio.wait({work_task, lease_task}, return_when=asyncio.FIRST_COMPLETED)
            if work_task in done:
                await work_task
            else:
                await lease_task
        finally:
            stop.set()
            for child in (work_task, lease_task):
                if not child.done():
                    child.cancel()
            await asyncio.gather(work_task, lease_task, return_exceptions=True)

    async def _run_bounded(self, work: Callable[[], Awaitable[None]]) -> None:
        """Execute provider work under the process-local concurrency cap."""
        async with self._semaphore:
            await work()

    @staticmethod
    async def _initial_renewal(keepalive: Callable[[], Awaitable[bool]]) -> bool:
        """Renew immediately and fail closed when ownership cannot be confirmed."""
        try:
            return await keepalive()
        except Exception as exc:  # noqa: BLE001 - normalize without leaking DB details
            logger.warning("Initial image generation lease renewal failed (%s)", type(exc).__name__)
            return False

    @staticmethod
    async def _maintain_lease(
        keepalive: Callable[[], Awaitable[bool]],
        stop: asyncio.Event,
        heartbeat_seconds: float,
        lease_seconds: float,
    ) -> None:
        """Renew ownership until work completes or ownership is lost."""
        lease_deadline = asyncio.get_running_loop().time() + lease_seconds
        while True:
            try:
                await asyncio.wait_for(stop.wait(), timeout=heartbeat_seconds)
                return
            except TimeoutError:
                pass
            try:
                owned = await keepalive()
            except Exception as exc:  # noqa: BLE001 - retry while the current lease may remain valid
                logger.warning("Image generation lease renewal failed (%s)", type(exc).__name__)
                if asyncio.get_running_loop().time() >= lease_deadline:
                    raise RuntimeError("Image generation lease expired during renewal failure") from None
                continue
            if not owned:
                raise RuntimeError("Image generation lease ownership was lost")
            lease_deadline = asyncio.get_running_loop().time() + lease_seconds

    def _collect_result(self, generation_uid: str, completed: asyncio.Task[None]) -> None:
        """Remove one task and retrieve exceptions without logging request data."""
        self._tasks.discard(completed)
        self._generation_uids.discard(generation_uid)
        try:
            completed.result()
        except asyncio.CancelledError:
            logger.info("Image generation background task was cancelled")
        except Exception as exc:  # noqa: BLE001 - callback must retrieve every task failure
            logger.error("Image generation background task failed (%s)", type(exc).__name__)

    async def wait(self) -> None:
        """Wait for the currently scheduled tasks without closing the manager."""
        pending = list(self._tasks)
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    async def close(self, timeout_seconds: float = DEFAULT_IMAGE_GENERATION_SHUTDOWN_SECONDS) -> None:
        """Stop scheduling, drain briefly, then cancel and retrieve remaining tasks."""
        if timeout_seconds < 0:
            raise ValueError("Shutdown timeout must not be negative")
        self._closed = True
        pending = set(self._tasks)
        if not pending:
            return
        _, pending = await asyncio.wait(pending, timeout=timeout_seconds)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await asyncio.sleep(0)
