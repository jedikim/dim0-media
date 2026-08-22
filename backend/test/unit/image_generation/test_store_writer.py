"""Unit tests for bounded image-result writer ownership."""

from __future__ import annotations

import asyncio
import logging

import pytest

from topix.store import image_generation as image_generation_store_module
from topix.store.image_generation import ImageGenerationOutputWriterBusyError, ImageGenerationStore

BOARD_UID = "b" * 32
GENERATION_UID = "g" * 32


class _FakeWriterPool:
    """Capture acquire and release budgets without opening PostgreSQL."""

    def __init__(
        self,
        *,
        acquire_error: BaseException | None = None,
        release_error: BaseException | None = None,
    ) -> None:
        """Initialize timeout observations and optional pool failures."""
        self.acquire_error = acquire_error
        self.release_error = release_error
        self.acquire_timeouts: list[float] = []
        self.release_timeouts: list[float | None] = []
        self.connection = object()

    async def acquire(self, *, timeout: float):
        """Return one sentinel connection after recording its shrinking budget."""
        self.acquire_timeouts.append(timeout)
        if self.acquire_error is not None:
            raise self.acquire_error
        return self.connection

    async def release(self, conn: object, *, timeout: float | None = None) -> None:
        """Record the independent reset budget used for the sentinel connection."""
        assert conn is self.connection
        self.release_timeouts.append(timeout)
        if self.release_error is not None:
            raise self.release_error


def _patch_writer_queries(
    monkeypatch: pytest.MonkeyPatch,
    *,
    lock_acquired: bool,
) -> None:
    """Replace PostgreSQL calls while preserving the store control flow."""

    async def try_lock(_conn: object, *, generation_uid: str) -> bool:
        """Return the configured advisory-lock outcome."""
        assert generation_uid == GENERATION_UID
        return lock_acquired

    async def read_output(_conn: object, *, board_uid: str, generation_uid: str):
        """Return no record after validating the requested scope."""
        assert board_uid == BOARD_UID
        assert generation_uid == GENERATION_UID
        return None

    async def unlock(_conn: object, *, generation_uid: str) -> bool:
        """Release the fake advisory lock."""
        assert generation_uid == GENERATION_UID
        return True

    monkeypatch.setattr(
        image_generation_store_module,
        "try_acquire_image_generation_output_writer",
        try_lock,
    )
    monkeypatch.setattr(image_generation_store_module, "get_image_generation_output", read_output)
    monkeypatch.setattr(
        image_generation_store_module,
        "release_image_generation_output_writer",
        unlock,
    )


@pytest.mark.asyncio
async def test_writer_release_uses_fixed_timeout_after_short_acquire_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A near-deadline acquire never becomes the connection reset timeout."""
    pool = _FakeWriterPool()
    _patch_writer_queries(monkeypatch, lock_acquired=True)
    monkeypatch.setattr(image_generation_store_module, "OUTPUT_NODE_WRITER_WAIT_SECONDS", 0.005)
    store = ImageGenerationStore()
    await store.open(pool)  # type: ignore[arg-type]

    async with store.output_node_writer(
        board_uid=BOARD_UID,
        generation_uid=GENERATION_UID,
    ):
        pass

    assert len(pool.acquire_timeouts) == 1
    assert 0 < pool.acquire_timeouts[0] <= 0.005
    assert pool.release_timeouts == [image_generation_store_module.OUTPUT_NODE_WRITER_RELEASE_TIMEOUT_SECONDS]
    assert pool.release_timeouts[0] != pool.acquire_timeouts[0]


@pytest.mark.parametrize(
    ("release_error", "propagates"),
    [
        (TimeoutError("private reset detail"), False),
        (asyncio.CancelledError(), True),
    ],
)
@pytest.mark.asyncio
async def test_normal_writer_completion_only_propagates_cleanup_cancellation(
    release_error: BaseException,
    propagates: bool,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Committed work ignores ordinary cleanup faults but preserves cancellation."""
    pool = _FakeWriterPool(release_error=release_error)
    _patch_writer_queries(monkeypatch, lock_acquired=True)
    store = ImageGenerationStore()
    await store.open(pool)  # type: ignore[arg-type]

    async def complete_writer() -> None:
        """Complete one normal writer body before the injected release anomaly."""
        async with store.output_node_writer(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
        ):
            pass

    with caplog.at_level(logging.ERROR):
        if propagates:
            with pytest.raises(asyncio.CancelledError):
                await complete_writer()
        else:
            await complete_writer()

    assert any(
        record.getMessage() == "Image generation output writer connection release failed"
        and getattr(record, "release_error_type", None) == type(release_error).__name__
        for record in caplog.records
    )
    assert "private reset detail" not in caplog.text


@pytest.mark.parametrize(
    ("failure_kind", "acquire_error", "lock_acquired"),
    [
        ("pool_timeout", TimeoutError("private pool detail"), True),
        ("writer_contended", None, False),
    ],
)
@pytest.mark.asyncio
async def test_writer_logs_only_the_final_bounded_failure_kind(
    failure_kind: str,
    acquire_error: BaseException | None,
    lock_acquired: bool,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Pool exhaustion and generation contention emit distinct safe events."""
    pool = _FakeWriterPool(acquire_error=acquire_error)
    _patch_writer_queries(monkeypatch, lock_acquired=lock_acquired)
    monkeypatch.setattr(image_generation_store_module, "OUTPUT_NODE_WRITER_WAIT_SECONDS", 0.001)
    monkeypatch.setattr(image_generation_store_module, "OUTPUT_NODE_WRITER_RETRY_SECONDS", 0.001)
    store = ImageGenerationStore()
    await store.open(pool)  # type: ignore[arg-type]

    with caplog.at_level(logging.WARNING), pytest.raises(ImageGenerationOutputWriterBusyError):
        async with store.output_node_writer(
            board_uid=BOARD_UID,
            generation_uid=GENERATION_UID,
        ):
            pytest.fail("bounded failure unexpectedly entered the writer")

    failure_records = [record for record in caplog.records if getattr(record, "failure_kind", None) in {"pool_timeout", "writer_contended"}]
    assert len(failure_records) == 1
    assert failure_records[0].failure_kind == failure_kind
    assert failure_records[0].generation_uid == GENERATION_UID
    assert failure_records[0].wait_milliseconds == 1
    assert "private pool detail" not in caplog.text
