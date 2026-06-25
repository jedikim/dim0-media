"""User billing model definition."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

BillingPlan = Literal["free", "plus"]
BillingStatus = Literal["active", "trialing", "past_due", "canceled", "incomplete"]

# Subscription statuses that actually grant paid access. `incomplete` (a
# subscription created before its first payment succeeds) and `canceled` must
# NOT grant access; `past_due` keeps access during Stripe's retry grace window.
ACCESS_GRANTING_STATUSES: frozenset[str] = frozenset({"active", "trialing", "past_due"})


def effective_plan(plan: BillingPlan, status: BillingStatus) -> BillingPlan:
    """Resolve the plan a user is truly entitled to, gated on subscription status.

    A paid plan only grants access while the subscription is in an
    access-granting status; otherwise the user falls back to ``free``. This
    guards against never-paid (``incomplete``) subscriptions granting Plus.
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
