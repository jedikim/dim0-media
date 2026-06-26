"""Rate limit policy definitions.

Minute/day rules use UTC fixed windows. Monthly switches to billing-cycle windows
when entitlement contains cycle bounds; otherwise it falls back to UTC month.
"""

import logging

from topix.api.utils.billing.stripe_config import is_billing_active
from topix.api.utils.rate_limit.types import EntitlementContext, PlanType, RateLimitRule

logger = logging.getLogger(__name__)

# A `None` limit means "no cap" for that window (e.g. Plus has no monthly cap,
# so it is marketed as Unlimited with only a daily fair-use ceiling).
MINUTE_BURST_LIMITS: dict[PlanType, int] = {
    "free": 10,
    "basic": 20,
    "plus": 40,
}

DAILY_UTC_LIMITS: dict[PlanType, int] = {
    "free": 50,
    "basic": 150,
    "plus": 1000,  # fair-use ceiling, not a marketed cap
}

MONTHLY_UTC_LIMITS: dict[PlanType, int | None] = {
    "free": 750,
    "basic": 3000,
    "plus": None,  # Unlimited — no monthly meter, daily fair-use only
}

# OSS / unconfigured deploys have no plan-based caps, but keep a per-user
# minute burst as a denial-of-service safety valve (generous enough that normal
# use never hits it).
OSS_MINUTE_BURST = 60

# Model capability tiers (matches `tier` in models.yml) a plan may use.
ALL_MODEL_TIERS: set[str] = {"lite", "pro"}

PLAN_ALLOWED_TIERS: dict[PlanType, set[str]] = {
    "free": {"lite"},
    "basic": {"lite"},
    "plus": {"lite", "pro"},
}


def resolve_tier_limits(plan: PlanType) -> dict[str, int | None]:
    """Resolve minute/day/month limits for a plan.

    When billing is inactive (disabled or unconfigured), only a per-user minute
    burst applies (DoS safety valve) with no daily/monthly caps, so OSS /
    self-hosted deploys are effectively unlimited. A `None` value for any window
    means that window is uncapped.
    """
    if not is_billing_active():
        return {"minute": OSS_MINUTE_BURST, "day": None, "month": None}

    return {
        "minute": MINUTE_BURST_LIMITS.get(plan, MINUTE_BURST_LIMITS["free"]),
        "day": DAILY_UTC_LIMITS.get(plan, DAILY_UTC_LIMITS["free"]),
        "month": MONTHLY_UTC_LIMITS.get(plan, MONTHLY_UTC_LIMITS["free"]),
    }


def resolve_allowed_model_tiers(plan: PlanType) -> set[str]:
    """Resolve the model tiers a plan may use.

    When billing is inactive (OSS mode), all tiers are allowed so self-hosted
    deploys keep unrestricted model access.
    """
    if not is_billing_active():
        return set(ALL_MODEL_TIERS)
    return set(PLAN_ALLOWED_TIERS.get(plan, PLAN_ALLOWED_TIERS["free"]))


def build_rate_limit_rules(entitlement: EntitlementContext) -> list[RateLimitRule]:
    """Build ordered rules for the given entitlement, skipping uncapped windows."""
    plan = entitlement.plan
    limits = resolve_tier_limits(plan)
    monthly_kind = "cycle" if entitlement.cycle is not None else "fixed_utc"

    specs = (
        ("minute", "minute", "fixed_utc"),
        ("day", "day", "fixed_utc"),
        ("month", "month", monthly_kind),
    )
    rules: list[RateLimitRule] = []
    for name, period, kind in specs:
        limit = limits[name]
        if limit is None:
            continue  # uncapped window — no rule
        rules.append(
            RateLimitRule(name=name, period=period, limit=limit, kind=kind, scope="tier_usage")
        )
    return rules
