"""Stripe runtime configuration helpers."""

import os

from dataclasses import dataclass

from fastapi import HTTPException, status

BILLING_ENABLED_ENV = "VITE_BILLING_ENABLED"

# Env vars required for billing to function. If any is missing, billing is
# treated as fully disabled (OSS mode) regardless of VITE_BILLING_ENABLED.
REQUIRED_ENV_VARS = (
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PLUS_MONTHLY",
    "STRIPE_PRICE_BASIC_MONTHLY",
    "APP_BASE_URL",
)


def _is_truthy(value: str | None) -> bool:
    """Parse common truthy env values."""
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def stripe_configured() -> bool:
    """Return True only if every required Stripe env var is present."""
    return all(_read_env(name) for name in REQUIRED_ENV_VARS)


def is_billing_active() -> bool:
    """Billing gates apply only when explicitly enabled AND fully configured.

    When billing is disabled or any Stripe key is missing, the deploy runs in
    full-OSS mode: no limits, all features and models available.
    """
    return _is_truthy(os.getenv(BILLING_ENABLED_ENV)) and stripe_configured()


@dataclass(frozen=True)
class StripeConfig:
    """Runtime Stripe configuration loaded from environment variables."""

    secret_key: str
    webhook_secret: str
    plus_monthly_price_id: str
    basic_monthly_price_id: str
    app_base_url: str

    def plan_to_price(self) -> dict[str, str]:
        """Map purchasable billing plans to their Stripe price id."""
        return {
            "basic": self.basic_monthly_price_id,
            "plus": self.plus_monthly_price_id,
        }

    def price_to_plan(self) -> dict[str, str]:
        """Map Stripe price ids back to billing plans (webhook source of truth)."""
        return {price: plan for plan, price in self.plan_to_price().items()}


def _read_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def get_stripe_config() -> StripeConfig:
    """Load Stripe settings from env and fail fast when missing."""
    secret_key = _read_env("STRIPE_SECRET_KEY")
    webhook_secret = _read_env("STRIPE_WEBHOOK_SECRET")
    plus_monthly_price_id = _read_env("STRIPE_PRICE_PLUS_MONTHLY")
    basic_monthly_price_id = _read_env("STRIPE_PRICE_BASIC_MONTHLY")
    app_base_url = _read_env("APP_BASE_URL")

    missing = [
        name
        for name, value in (
            ("STRIPE_SECRET_KEY", secret_key),
            ("STRIPE_WEBHOOK_SECRET", webhook_secret),
            ("STRIPE_PRICE_PLUS_MONTHLY", plus_monthly_price_id),
            ("STRIPE_PRICE_BASIC_MONTHLY", basic_monthly_price_id),
            ("APP_BASE_URL", app_base_url),
        )
        if value is None
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Stripe is not configured. Missing env: {', '.join(missing)}",
        )

    return StripeConfig(
        secret_key=secret_key,
        webhook_secret=webhook_secret,
        plus_monthly_price_id=plus_monthly_price_id,
        basic_monthly_price_id=basic_monthly_price_id,
        app_base_url=app_base_url.rstrip("/"),
    )
