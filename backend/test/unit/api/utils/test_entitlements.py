"""Unit tests for plan / entitlement resolution.

The load-bearing invariant: when billing is inactive (flag off OR Stripe keys
missing → `is_billing_active()` false), the deploy is full-OSS and every plan
resolver returns `plus` WITHOUT touching the billing store. When active, the
stored plan is returned, status-gated.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from topix.api.utils.rate_limit import entitlements
from topix.api.utils.rate_limit.entitlements import (
    resolve_effective_plan,
    resolve_entitlement_context,
)


def _set_billing_active(monkeypatch, active: bool):
    monkeypatch.setattr(entitlements, "is_billing_active", lambda: active)


class _FailIfCalledStore:
    """Store that must never be hit (proves the OSS short-circuit skips it)."""

    async def get_user_billing(self, user_uid: str):
        raise AssertionError(f"store should not be called for {user_uid}")


class _StubStore:
    def __init__(self, row):
        self.row = row
        self.calls: list[str] = []

    async def get_user_billing(self, user_uid: str):
        self.calls.append(user_uid)
        return self.row


def _req(store=None):
    app = SimpleNamespace(user_billing_store=store) if store is not None else SimpleNamespace()
    return SimpleNamespace(app=app)


# --- billing inactive → OSS plus, no store access ----------------------------


@pytest.mark.asyncio
async def test_effective_plan_is_plus_and_skips_store_when_inactive(monkeypatch):
    """Inactive billing → plus, and the store is never queried."""
    _set_billing_active(monkeypatch, False)
    assert await resolve_effective_plan(_req(_FailIfCalledStore()), "u1") == "plus"


@pytest.mark.asyncio
async def test_entitlement_is_plus_no_cycle_when_inactive(monkeypatch):
    """Inactive billing → plus entitlement with no billing cycle (nothing metered)."""
    _set_billing_active(monkeypatch, False)
    ctx = await resolve_entitlement_context(_req(_FailIfCalledStore()), "u1")
    assert ctx.plan == "plus"
    assert ctx.cycle is None


# --- billing active → stored plan, status-gated ------------------------------


@pytest.mark.asyncio
async def test_active_no_row_is_free(monkeypatch):
    """Active billing with no subscription row → free."""
    _set_billing_active(monkeypatch, True)
    store = _StubStore(None)
    assert await resolve_effective_plan(_req(store), "u1") == "free"
    assert store.calls == ["u1"]


@pytest.mark.asyncio
async def test_active_paid_active_row_is_that_plan(monkeypatch):
    """Active billing with a paid+active row → that plan."""
    _set_billing_active(monkeypatch, True)
    store = _StubStore(SimpleNamespace(plan="plus", status="active"))
    assert await resolve_effective_plan(_req(store), "u1") == "plus"


@pytest.mark.asyncio
async def test_active_never_paid_incomplete_falls_back_to_free(monkeypatch):
    """A never-paid (`incomplete`) subscription must not grant a paid tier."""
    _set_billing_active(monkeypatch, True)
    store = _StubStore(SimpleNamespace(plan="plus", status="incomplete"))
    assert await resolve_effective_plan(_req(store), "u1") == "free"


@pytest.mark.asyncio
async def test_entitlement_carries_billing_cycle_when_present(monkeypatch):
    """Active billing with period bounds → entitlement carries the billing cycle."""
    _set_billing_active(monkeypatch, True)
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=30)
    store = _StubStore(
        SimpleNamespace(plan="plus", status="active", current_period_start=start, current_period_end=end)
    )
    ctx = await resolve_entitlement_context(_req(store), "u1")
    assert ctx.plan == "plus"
    assert ctx.cycle is not None
    assert ctx.cycle.start == start and ctx.cycle.end == end
