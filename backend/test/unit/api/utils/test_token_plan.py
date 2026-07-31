"""Unit tests for JWT plan resolution helper."""

from types import SimpleNamespace

import pytest

from topix.api.utils.rate_limit import entitlements
from topix.api.utils.rate_limit.token_plan import resolve_plan_for_token


def _set_billing_active(monkeypatch, active: bool):
    # resolve_plan_for_token delegates to resolve_effective_plan, which reads the
    # gate from the entitlements module namespace.
    monkeypatch.setattr(entitlements, "is_billing_active", lambda: active)


class _FailIfCalledStore:
    """Store stub that should never be called."""

    async def get_user_billing(self, user_uid: str):
        raise AssertionError(f"store should not be called for user {user_uid}")


class _StubBillingStore:
    """Store stub that returns a fixed billing row."""

    def __init__(self, plan: str | None):
        self.plan = plan
        self.calls: list[str] = []

    async def get_user_billing(self, user_uid: str):
        self.calls.append(user_uid)
        if self.plan is None:
            return None
        return SimpleNamespace(plan=self.plan, status="active")


@pytest.mark.asyncio
async def test_resolve_plan_returns_plus_when_billing_inactive(monkeypatch):
    """Billing inactive (disabled or unconfigured) forces plus for token claims."""
    _set_billing_active(monkeypatch, False)
    request = SimpleNamespace(app=SimpleNamespace(user_billing_store=_FailIfCalledStore()))

    plan = await resolve_plan_for_token(request, "user-1")

    assert plan == "plus"


@pytest.mark.asyncio
async def test_resolve_plan_returns_free_when_store_missing(monkeypatch):
    """Billing active but no store should fallback to free."""
    _set_billing_active(monkeypatch, True)
    request = SimpleNamespace(app=SimpleNamespace())

    plan = await resolve_plan_for_token(request, "user-1")

    assert plan == "free"


@pytest.mark.asyncio
async def test_resolve_plan_returns_free_when_billing_row_missing(monkeypatch):
    """Billing active with no row should fallback to free."""
    _set_billing_active(monkeypatch, True)
    store = _StubBillingStore(plan=None)
    request = SimpleNamespace(app=SimpleNamespace(user_billing_store=store))

    plan = await resolve_plan_for_token(request, "user-1")

    assert plan == "free"
    assert store.calls == ["user-1"]


@pytest.mark.asyncio
async def test_resolve_plan_returns_persisted_plan(monkeypatch):
    """Billing active should return the persisted plan."""
    _set_billing_active(monkeypatch, True)
    store = _StubBillingStore(plan="plus")
    request = SimpleNamespace(app=SimpleNamespace(user_billing_store=store))

    plan = await resolve_plan_for_token(request, "user-1")

    assert plan == "plus"
    assert store.calls == ["user-1"]
