"""Router tests for GET /billing/me — the plan the settings UI reads.

Pins the OSS regression: with billing inactive the endpoint MUST report `plus` +
`billing_enabled: False` (not `free`), so a self-host deploy doesn't show a free
tier with limits. The `is_billing_active` gate is patched; when active a small
fake store stands in.
"""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from topix.api.router import billing
from topix.api.router.billing import router
from topix.api.utils.security import get_current_user_uid


def _build_client(monkeypatch, *, active: bool, row=None) -> TestClient:
    monkeypatch.setattr(billing, "is_billing_active", lambda: active)
    app = FastAPI()
    app.include_router(router)

    class _Store:
        async def get_user_billing(self, user_uid: str):
            return row

    app.user_billing_store = _Store()

    async def _fake_uid():
        return "u1"

    app.dependency_overrides[get_current_user_uid] = _fake_uid
    return TestClient(app)


def test_me_reports_oss_plus_when_billing_inactive(monkeypatch):
    """Billing inactive → /me reports plus + billing_enabled False (the regression)."""
    client = _build_client(monkeypatch, active=False)
    data = client.get("/billing/me").json()["data"]
    assert data["plan"] == "plus"
    assert data["billing_enabled"] is False


def test_me_reports_free_for_a_user_with_no_subscription_when_active(monkeypatch):
    """Billing active, no subscription → free + billing_enabled True."""
    client = _build_client(monkeypatch, active=True, row=None)
    data = client.get("/billing/me").json()["data"]
    assert data["plan"] == "free"
    assert data["billing_enabled"] is True


def test_me_status_gates_a_never_paid_subscription_when_active(monkeypatch):
    """Billing active, incomplete sub → displays free, not the paid plan."""
    row = SimpleNamespace(
        plan="plus",
        status="incomplete",
        cancel_at_period_end=False,
        current_period_start=None,
        current_period_end=None,
    )
    client = _build_client(monkeypatch, active=True, row=row)
    data = client.get("/billing/me").json()["data"]
    assert data["plan"] == "free"  # incomplete sub doesn't display as paid
    assert data["billing_enabled"] is True
