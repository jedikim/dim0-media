"""Unit tests for bounded image-generation task execution."""

from __future__ import annotations

import asyncio

import pytest

from topix.image_generation.tasks import ImageGenerationTaskManager


@pytest.mark.asyncio
async def test_task_manager_deduplicates_generation_and_collects_success() -> None:
    """One generation UID is scheduled once while its task is live."""
    manager = ImageGenerationTaskManager(concurrency=1)
    release = asyncio.Event()
    calls = 0

    async def work() -> None:
        """Wait until the test has asserted live-task deduplication."""
        nonlocal calls
        calls += 1
        await release.wait()

    assert manager.schedule("generation-1", work) is True
    assert manager.schedule("generation-1", work) is False
    await asyncio.sleep(0)
    assert calls == 1
    release.set()
    await manager.wait()
    await manager.close()


@pytest.mark.asyncio
async def test_task_manager_enforces_process_local_concurrency() -> None:
    """The semaphore prevents more than the configured provider work count."""
    manager = ImageGenerationTaskManager(concurrency=1)
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    order: list[str] = []

    async def first() -> None:
        """Occupy the only execution slot until released."""
        order.append("first-start")
        first_started.set()
        await release_first.wait()
        order.append("first-end")

    async def second() -> None:
        """Run only after the first task leaves the semaphore."""
        order.append("second")

    manager.schedule("generation-1", first)
    manager.schedule("generation-2", second)
    await first_started.wait()
    await asyncio.sleep(0)
    assert order == ["first-start"]
    release_first.set()
    await manager.wait()
    assert order == ["first-start", "first-end", "second"]
    await manager.close()


@pytest.mark.asyncio
async def test_task_manager_retrieves_failures_without_logging_exception_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Done callbacks retrieve failures while keeping unsafe details out of logs."""
    manager = ImageGenerationTaskManager()

    async def fail() -> None:
        """Raise text that the callback must not log."""
        raise RuntimeError("unsafe-prompt-or-secret")

    manager.schedule("generation-1", fail)
    await manager.wait()
    await asyncio.sleep(0)

    assert "RuntimeError" in caplog.text
    assert "unsafe-prompt-or-secret" not in caplog.text
    await manager.close()


@pytest.mark.asyncio
async def test_task_manager_cancels_remaining_work_on_shutdown() -> None:
    """Shutdown cancels and retrieves work that cannot drain in time."""
    manager = ImageGenerationTaskManager()
    cancelled = asyncio.Event()

    async def work() -> None:
        """Record cancellation of one indefinitely waiting task."""
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    manager.schedule("generation-1", work)
    await asyncio.sleep(0)
    await manager.close(timeout_seconds=0)
    assert cancelled.is_set()
