"""Tests for the Stripe webhook handler's status/ordering guards."""

from types import SimpleNamespace

import pytest

import topix.api.router.billing as billing


class _FakeBillingStore:
    """Captures upserts and returns a preset existing billing row."""

    def __init__(self, existing=None):
        self.existing = existing
        self.upserts: list[dict] = []

    async def get_user_billing(self, user_uid: str):
        return self.existing

    async def get_user_billing_by_stripe_subscription_id(self, sub_id: str):
        return self.existing

    async def get_user_billing_by_stripe_customer_id(self, cust_id: str):
        return self.existing

    async def upsert_user_billing(self, *, user_uid: str, data: dict):
        self.upserts.append({"user_uid": user_uid, **data})


def _build_request(store: _FakeBillingStore):
    async def _body():
        return b"{}"

    return SimpleNamespace(
        app=SimpleNamespace(user_billing_store=store),
        headers=SimpleNamespace(get=lambda _k: "sig"),
        body=_body,
    )


def _subscription_event(*, status: str, sub_id: str = "sub_123", event_type: str = "customer.subscription.updated"):
    return {
        "type": event_type,
        "data": {
            "object": {
                "id": sub_id,
                "customer": "cus_123",
                "status": status,
                "metadata": {"user_uid": "u1"},
                "items": {"data": [{"price": {"id": "price_x"}}]},
            }
        },
    }


@pytest.fixture(autouse=True)
def _stub_stripe(monkeypatch):
    """Avoid env/signature deps: stub config + signature verification."""
    monkeypatch.setattr(billing, "get_stripe_config", lambda: SimpleNamespace(webhook_secret="whsec"))
    # verify returns whatever event the individual test injects via closure.


async def test_stale_incomplete_does_not_downgrade_active_subscription(monkeypatch):
    """A late `incomplete` event must not overwrite an already-active sub."""
    existing = SimpleNamespace(
        user_uid="u1", plan="plus", status="active", stripe_subscription_id="sub_123",
    )
    store = _FakeBillingStore(existing=existing)
    monkeypatch.setattr(billing, "verify_stripe_signature", lambda **_: _subscription_event(status="incomplete"))

    result = await billing.handle_stripe_webhook(_build_request(store))

    assert result["data"]["reason"] == "stale_incomplete"
    assert store.upserts == []  # no write — active state preserved


async def test_incomplete_for_new_subscription_is_persisted_as_free(monkeypatch):
    """A genuine first `incomplete` (no prior active row) downgrades to free."""
    store = _FakeBillingStore(existing=None)
    monkeypatch.setattr(billing, "verify_stripe_signature", lambda **_: _subscription_event(status="incomplete"))

    await billing.handle_stripe_webhook(_build_request(store))

    assert len(store.upserts) == 1
    assert store.upserts[0]["plan"] == "free"


async def test_active_subscription_is_persisted_as_plus(monkeypatch):
    """An active subscription event grants the paid plan."""
    store = _FakeBillingStore(existing=None)
    monkeypatch.setattr(billing, "verify_stripe_signature", lambda **_: _subscription_event(status="active"))

    await billing.handle_stripe_webhook(_build_request(store))

    assert len(store.upserts) == 1
    assert store.upserts[0]["plan"] == "plus"
