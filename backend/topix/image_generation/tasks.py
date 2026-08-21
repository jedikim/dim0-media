"""Bounded process-local execution for image generation jobs."""

from __future__ import annotations

import asyncio
import logging

from collections.abc import Awaitable, Callable
from datetime import timedelta

logger = logging.getLogger(__name__)

DEFAULT_IMAGE_GENERATION_CONCURRENCY = 2
DEFAULT_IMAGE_GENERATION_SHUTDOWN_SECONDS = 10.0
IMAGE_GENERATION_RECONCILIATION_GRACE = timedelta(minutes=15)


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

    def schedule(self, generation_uid: str, work: Callable[[], Awaitable[None]]) -> bool:
        """Schedule one generation once in this process and retain its task."""
        if self._closed:
            raise RuntimeError("Image generation task manager is closed")
        if generation_uid in self._generation_uids:
            return False

        async def run_bounded() -> None:
            """Execute provider work under the process-local concurrency cap."""
            async with self._semaphore:
                await work()

        task = asyncio.create_task(run_bounded(), name=f"image-generation:{generation_uid}")
        self._generation_uids.add(generation_uid)
        self._tasks.add(task)

        def collect_result(completed: asyncio.Task[None]) -> None:
            """Remove one task and retrieve exceptions without logging request data."""
            self._tasks.discard(completed)
            self._generation_uids.discard(generation_uid)
            try:
                completed.result()
            except asyncio.CancelledError:
                logger.info("Image generation background task was cancelled")
            except Exception as exc:  # noqa: BLE001 - callback must retrieve every task failure
                logger.error("Image generation background task failed (%s)", type(exc).__name__)

        task.add_done_callback(collect_result)
        return True

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
        done, pending = await asyncio.wait(pending, timeout=timeout_seconds)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            if not task.done():
                continue
            try:
                task.result()
            except (asyncio.CancelledError, Exception):
                pass
