"""User billing model definition."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

type BillingPlan = Literal["free", "basic", "plus"]
type BillingStatus = Literal["active", "trialing", "past_due", "canceled", "incomplete"]

# Subscription statuses that actually grant paid access. `incomplete` (a
# subscription created before its first payment succeeds) and `canceled` must
# NOT grant access; `past_due` keeps access during Stripe's retry grace window.
ACCESS_GRANTING_STATUSES: frozenset[str] = frozenset({"active", "trialing", "past_due"})

_VALID_PLANS: frozenset[str] = frozenset({"free", "basic", "plus"})


def coerce_plan(value: str | None) -> BillingPlan:
    """Coerce an untrusted plan string to a valid plan, defaulting to free.

    Fail-closed: unknown/missing values (e.g. unmapped Stripe prices, edited
    webhook metadata) resolve to ``free`` rather than over-granting a paid tier
    or violating the DB CHECK constraint.
    """
    return value if value in _VALID_PLANS else "free"


def effective_plan(plan: BillingPlan, status: BillingStatus) -> BillingPlan:
    """Resolve the plan a user is truly entitled to, gated on subscription status.

    A paid plan only grants access while the subscription is in an
    access-granting status; otherwise the user falls back to ``free``. This
    guards against never-paid (``incomplete``) subscriptions granting a paid tier.
    """
    if plan != "free" and status not in ACCESS_GRANTING_STATUSES:
        return "free"
    return plan


class UserBilling(BaseModel):
    """Billing model representing a user's current plan and status."""

    user_uid: str
    plan: BillingPlan = "free"
    status: BillingStatus = "active"
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False

    created_at: datetime | None = Field(default_factory=datetime.now)
    updated_at: datetime | None = None
