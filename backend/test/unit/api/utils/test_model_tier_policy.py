"""Tests for per-plan model-tier gating."""

import topix.config.catalog as catalog

from topix.api.utils.rate_limit import policy
from topix.api.utils.rate_limit.policy import (
    DAILY_UTC_LIMITS,
    MONTHLY_UTC_LIMITS,
    resolve_allowed_model_tiers,
)


def _set_billing_active(monkeypatch, active: bool):
    monkeypatch.setattr(policy, "is_billing_active", lambda: active)


def test_basic_tier_sits_between_free_and_plus():
    """Basic has a higher daily cap than free; plus has no monthly cap."""
    assert DAILY_UTC_LIMITS["free"] < DAILY_UTC_LIMITS["basic"] < DAILY_UTC_LIMITS["plus"]
    assert MONTHLY_UTC_LIMITS["basic"] is not None
    assert MONTHLY_UTC_LIMITS["plus"] is None  # plus = unlimited monthly


def test_allowed_tiers_when_billing_active(monkeypatch):
    """With billing active, only plus reaches the pro tier."""
    _set_billing_active(monkeypatch, True)
    assert resolve_allowed_model_tiers("free") == {"lite"}
    assert resolve_allowed_model_tiers("basic") == {"lite"}
    assert resolve_allowed_model_tiers("plus") == {"lite", "pro"}


def test_allowed_tiers_unrestricted_when_billing_inactive(monkeypatch):
    """OSS mode (billing inactive) grants every tier to every plan."""
    _set_billing_active(monkeypatch, False)
    assert resolve_allowed_model_tiers("free") == {"lite", "pro"}
    assert resolve_allowed_model_tiers("basic") == {"lite", "pro"}


def test_available_llms_filters_by_tier(monkeypatch):
    """available_llms restricts to the requested tiers when given."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    catalog._resolved_for.cache_clear()

    lite_only = catalog.available_llms({"lite"})
    assert lite_only, "expected at least one lite model with OpenRouter key"
    assert all(m.tier == "lite" for m in lite_only)

    everything = catalog.available_llms()
    assert any(m.tier == "pro" for m in everything)


def test_model_tier_normalizes_legacy_prefixed_codes(monkeypatch):
    """A legacy provider-prefixed code resolves to its tier (no false 403)."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    catalog._resolved_for.cache_clear()

    # "gpt-5.4-mini" is a lite model; its legacy "openai/..." prefixed form
    # (neither the canonical id nor the full call code) must still resolve.
    assert catalog.model_tier("openai/gpt-5.4-mini") == "lite"
    assert catalog.is_model_allowed("openai/gpt-5.4-mini", {"lite"}) is True


def test_is_model_allowed_respects_tier(monkeypatch):
    """A pro model is gated for a lite-only plan but allowed otherwise."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    catalog._resolved_for.cache_clear()

    pro = next((m for m in catalog.available_llms() if m.tier == "pro"), None)
    lite = next((m for m in catalog.available_llms() if m.tier == "lite"), None)
    assert pro and lite

    assert catalog.is_model_allowed(pro.id, {"lite", "pro"}) is True
    assert catalog.is_model_allowed(pro.id, {"lite"}) is False
    assert catalog.is_model_allowed(lite.id, {"lite"}) is True
    # None means unrestricted (any reachable model is allowed).
    assert catalog.is_model_allowed(pro.id, None) is True
