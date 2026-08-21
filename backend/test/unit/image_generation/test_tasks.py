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

    assert manager.schedule("generation-1", work) is None
    with pytest.raises(RuntimeError, match="already scheduled"):
        manager.schedule("generation-1", work)
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


@pytest.mark.asyncio
async def test_task_manager_renews_lease_while_work_waits_for_semaphore() -> None:
    """Queued work remains owned instead of being reclaimed by another worker."""
    manager = ImageGenerationTaskManager(concurrency=1)
    release_first = asyncio.Event()
    second_started = asyncio.Event()
    renewals = 0

    async def first() -> None:
        """Occupy the only provider slot."""
        await release_first.wait()

    async def second() -> None:
        """Record entry after the semaphore becomes available."""
        second_started.set()

    async def keepalive() -> bool:
        """Record each immediate or periodic lease renewal."""
        nonlocal renewals
        renewals += 1
        return True

    manager.schedule("generation-1", first)
    manager.schedule("generation-2", second, keepalive=keepalive, heartbeat_seconds=0.01)
    await asyncio.sleep(0.035)
    assert renewals >= 3
    assert not second_started.is_set()
    release_first.set()
    await manager.wait()
    assert second_started.is_set()
    await manager.close()


@pytest.mark.asyncio
async def test_task_manager_cancels_work_when_lease_is_lost() -> None:
    """A false heartbeat stops provider work owned by a different worker."""
    manager = ImageGenerationTaskManager()
    work_cancelled = asyncio.Event()
    renewal = 0

    async def work() -> None:
        """Wait until lease loss cancels the running work."""
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            work_cancelled.set()
            raise

    async def keepalive() -> bool:
        """Allow the initial renewal and reject the first heartbeat."""
        nonlocal renewal
        renewal += 1
        return renewal == 1

    manager.schedule("generation-1", work, keepalive=keepalive, heartbeat_seconds=0.01)
    await manager.wait()
    assert work_cancelled.is_set()
    await manager.close()


@pytest.mark.asyncio
async def test_task_manager_never_starts_work_when_initial_ownership_is_unknown(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An initial DB error fails closed before any provider work begins."""
    manager = ImageGenerationTaskManager()
    called = False

    async def work() -> None:
        """Record an unsafe provider start."""
        nonlocal called
        called = True

    async def unavailable() -> bool:
        """Simulate a lease database outage without exposing its detail."""
        raise RuntimeError("unsafe-database-detail")

    manager.schedule("generation-1", work, keepalive=unavailable, heartbeat_seconds=0.01, lease_seconds=0.03)
    await manager.wait()
    assert called is False
    assert "RuntimeError" in caplog.text
    assert "unsafe-database-detail" not in caplog.text
    await manager.close()


@pytest.mark.asyncio
async def test_task_manager_stops_after_renewal_errors_outlast_lease() -> None:
    """Transient renewal errors may retry only until the last confirmed lease expires."""
    manager = ImageGenerationTaskManager()
    cancelled = asyncio.Event()
    renewals = 0

    async def work() -> None:
        """Wait for lease expiry to cancel provider work."""
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    async def keepalive() -> bool:
        """Confirm initial ownership and fail every subsequent renewal."""
        nonlocal renewals
        renewals += 1
        if renewals == 1:
            return True
        raise RuntimeError("database unavailable")

    manager.schedule("generation-1", work, keepalive=keepalive, heartbeat_seconds=0.01, lease_seconds=0.025)
    await manager.wait()
    assert renewals >= 3
    assert cancelled.is_set()
    await manager.close()
