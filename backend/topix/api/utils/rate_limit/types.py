"""Types for rate limit policy and enforcement."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

type PlanType = Literal["free", "basic", "plus"]
type RateLimitPeriod = Literal["minute", "day", "month"]
type RateLimitKind = Literal["fixed_utc", "cycle"]


@dataclass(frozen=True)
class BillingCycle:
    """Billing cycle boundaries for a user."""

    start: datetime
    end: datetime


@dataclass(frozen=True)
class EntitlementContext:
    """Resolved entitlement context for one request."""

    plan: PlanType
    cycle: BillingCycle | None = None


@dataclass(frozen=True)
class RateLimitRule:
    """Policy rule applied to a request."""

    name: str
    period: RateLimitPeriod
    limit: int
    kind: RateLimitKind = "fixed_utc"
    scope: str = "tier_usage"


@dataclass(frozen=True)
class RateLimitResult:
    """Result from one rate limit check."""

    allowed: bool
    retry_after: int
