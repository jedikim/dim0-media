"""Tests for the modular rate limiter dependency."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from fastapi import HTTPException, status

from topix.api.utils.rate_limit import entitlements, policy
from topix.api.utils.rate_limit.dependency import rate_limiter
from topix.api.utils.rate_limit.policy import (
    DAILY_UTC_LIMITS,
    MINUTE_BURST_LIMITS,
    MONTHLY_UTC_LIMITS,
)


def _set_billing_active(monkeypatch, active: bool):
    """Patch the billing-active gate in both namespaces that consult it.

    `policy` resolves the limits; `entitlements` resolves the plan.
    """
    monkeypatch.setattr(policy, "is_billing_active", lambda: active)
    monkeypatch.setattr(entitlements, "is_billing_active", lambda: active)


class _FakeRedisStore:
    """Helper store that tracks fixed-window quota checks."""

    def __init__(
        self,
        minute_allowed: bool = True,
        day_allowed: bool = True,
        month_allowed: bool = True,
    ):
        self.minute_allowed = minute_allowed
        self.day_allowed = day_allowed
        self.month_allowed = month_allowed
        self.fixed_calls = []
        self.cycle_calls = []

    async def check_fixed_window_quota(
        self,
        user_id: str,
        limit: int,
        period: str,
        scope: str = "tier_usage",
    ) -> tuple[bool, int]:
        self.fixed_calls.append(
            {
                "user_id": user_id,
                "limit": limit,
                "period": period,
                "scope": scope,
            }
        )
        if period == "minute":
            return self.minute_allowed, 60
        if period == "day":
            return self.day_allowed, 3600
        return self.month_allowed, 7200

    async def check_cycle_window_quota(
        self,
        user_id: str,
        limit: int,
        cycle_start: datetime,
        cycle_end: datetime,
        scope: str = "tier_usage",
    ) -> tuple[bool, int]:
        self.cycle_calls.append(
            {
                "user_id": user_id,
                "limit": limit,
                "cycle_start": cycle_start,
                "cycle_end": cycle_end,
                "scope": scope,
            }
        )
        return self.month_allowed, 7200


class _FakeUserBillingStore:
    """Helper store that returns a fixed plan or no billing row."""

    def __init__(
        self,
        plan: str | None,
        cycle_start: datetime | None = None,
        cycle_end: datetime | None = None,
        status: str = "active",
    ):
        self.plan = plan
        self.cycle_start = cycle_start
        self.cycle_end = cycle_end
        self.status = status

    async def get_user_billing(self, user_uid: str):
        if self.plan is None:
            return None
        return SimpleNamespace(
            plan=self.plan,
            status=self.status,
            current_period_start=self.cycle_start,
            current_period_end=self.cycle_end,
        )


def _build_request(
    redis_store: _FakeRedisStore,
    plan: str | None,
    cycle_start: datetime | None = None,
    cycle_end: datetime | None = None,
    status: str = "active",
):
    return SimpleNamespace(
        app=SimpleNamespace(
            redis_store=redis_store,
            user_billing_store=_FakeUserBillingStore(
                plan=plan,
                cycle_start=cycle_start,
                cycle_end=cycle_end,
                status=status,
            ),
        ),
        scope={"route": SimpleNamespace(path="/foo")},
        url=SimpleNamespace(path="/fallback"),
    )


@pytest.mark.asyncio
async def test_rate_limiter_uses_free_limits_when_billing_missing(monkeypatch):
    """Should apply free limits when no billing row exists."""
    _set_billing_active(monkeypatch, True)
    fake_store = _FakeRedisStore()
    request = _build_request(fake_store, plan=None)

    await rate_limiter(request=request, user_id="user-123")

    assert fake_store.fixed_calls == [
        {
            "user_id": "user-123",
            "limit": MINUTE_BURST_LIMITS["free"],
            "period": "minute",
            "scope": "tier_usage",
        },
        {
            "user_id": "user-123",
            "limit": DAILY_UTC_LIMITS["free"],
            "period": "day",
            "scope": "tier_usage",
        },
        {
            "user_id": "user-123",
            "limit": MONTHLY_UTC_LIMITS["free"],
            "period": "month",
            "scope": "tier_usage",
        },
    ]
    assert fake_store.cycle_calls == []


@pytest.mark.asyncio
async def test_rate_limiter_uses_plus_limits(monkeypatch):
    """Plus applies minute + daily fair-use caps and NO monthly cap (unlimited)."""
    _set_billing_active(monkeypatch, True)
    fake_store = _FakeRedisStore()
    cycle_start = datetime.now(timezone.utc) - timedelta(days=3)
    cycle_end = datetime.now(timezone.utc) + timedelta(days=27)
    request = _build_request(fake_store, plan="plus", cycle_start=cycle_start, cycle_end=cycle_end)

    await rate_limiter(request=request, user_id="user-123")

    assert fake_store.fixed_calls == [
        {
            "user_id": "user-123",
            "limit": MINUTE_BURST_LIMITS["plus"],
            "period": "minute",
            "scope": "tier_usage",
        },
        {
            "user_id": "user-123",
            "limit": DAILY_UTC_LIMITS["plus"],
            "period": "day",
            "scope": "tier_usage",
        },
    ]
    # No monthly rule for plus, even when a billing cycle exists.
    assert fake_store.cycle_calls == []


@pytest.mark.asyncio
async def test_rate_limiter_gates_incomplete_plus_to_free_limits(monkeypatch):
    """A plus plan with a never-paid `incomplete` status gets only free limits."""
    _set_billing_active(monkeypatch, True)
    fake_store = _FakeRedisStore()
    request = _build_request(fake_store, plan="plus", status="incomplete")

    await rate_limiter(request=request, user_id="user-123")

    assert fake_store.fixed_calls[1]["limit"] == DAILY_UTC_LIMITS["free"]
    assert fake_store.cycle_calls == []  # no billing cycle -> fixed monthly window


@pytest.mark.asyncio
async def test_rate_limiter_raises_on_minute_limit(monkeypatch):
    """Should raise 429 when minute quota is exceeded."""
    _set_billing_active(monkeypatch, True)
    fake_store = _FakeRedisStore(minute_allowed=False)
    request = _build_request(fake_store, plan="free")

    with pytest.raises(HTTPException) as exc:
        await rate_limiter(request=request, user_id="user-123")

    assert exc.value.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert "Limit: 10 requests/minute" in exc.value.detail
    assert exc.value.headers == {"Retry-After": "60"}


@pytest.mark.asyncio
async def test_rate_limiter_raises_on_daily_limit(monkeypatch):
    """Should raise 429 when daily quota is exceeded."""
    _set_billing_active(monkeypatch, True)
    fake_store = _FakeRedisStore(day_allowed=False)
    request = _build_request(fake_store, plan="free")

    with pytest.raises(HTTPException) as exc:
        await rate_limiter(request=request, user_id="user-123")

    assert exc.value.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert "Limit: 50 requests/day" in exc.value.detail
    assert exc.value.headers == {"Retry-After": "3600"}


@pytest.mark.asyncio
async def test_rate_limiter_raises_on_monthly_limit(monkeypatch):
    """Should raise 429 when monthly quota is exceeded (basic has a monthly cap)."""
    _set_billing_active(monkeypatch, True)
    fake_store = _FakeRedisStore(month_allowed=False)
    cycle_start = datetime.now(timezone.utc) - timedelta(days=3)
    cycle_end = datetime.now(timezone.utc) + timedelta(days=27)
    request = _build_request(fake_store, plan="basic", cycle_start=cycle_start, cycle_end=cycle_end)

    with pytest.raises(HTTPException) as exc:
        await rate_limiter(request=request, user_id="user-123")

    assert exc.value.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert f"Limit: {MONTHLY_UTC_LIMITS['basic']} requests/month" in exc.value.detail
    assert exc.value.headers == {"Retry-After": "7200"}


@pytest.mark.asyncio
async def test_rate_limiter_oss_keeps_only_minute_burst(monkeypatch):
    """Billing inactive (OSS) applies only a per-user minute burst (DoS valve)."""
    from topix.api.utils.rate_limit.policy import OSS_MINUTE_BURST

    _set_billing_active(monkeypatch, False)
    fake_store = _FakeRedisStore()
    request = _build_request(fake_store, plan="free")

    await rate_limiter(request=request, user_id="user-123")

    assert fake_store.fixed_calls == [
        {
            "user_id": "user-123",
            "limit": OSS_MINUTE_BURST,
            "period": "minute",
            "scope": "tier_usage",
        },
    ]
    assert fake_store.cycle_calls == []  # no daily/monthly caps in OSS
