"""Unit tests for base agent model setting adjustments."""

from agents import ModelSettings
from agents.extensions.models.litellm_model import LitellmModel

from topix.agents.base import BaseAgent


def test_adjust_model_settings_enables_openai_prompt_cache_retention():
    """OpenAI string models should enable 24h prompt cache retention."""
    agent = BaseAgent.__new__(BaseAgent)
    agent.name = "planner_agent"

    settings = agent._adjust_model_settings(
        "openai/gpt-5.4-mini",
        ModelSettings(extra_args={"existing": "value"}),
    )

    assert settings.extra_body == {
        "prompt_cache_retention": "24h",
    }
    assert settings.extra_args == {
        "existing": "value",
    }


def test_adjust_model_settings_keeps_litellm_specific_extra_args():
    """LiteLLM models should keep the provider-specific dropped-params config."""
    agent = BaseAgent.__new__(BaseAgent)

    settings = agent._adjust_model_settings(
        LitellmModel("anthropic/claude-3-5-sonnet"),
        ModelSettings(),
    )

    assert settings.extra_args == {
        "drop_params": True,
        "additional_drop_params": ["frequency_penalty", "presence_penalty"],
    }


def test_adjust_model_settings_detects_reasoning_for_openrouter_routed_model():
    """An OpenAI reasoning model routed via OpenRouter must keep reasoning settings.

    Regression: capability detection used to match only bare "openai/..." codes,
    so the routed code "openrouter/openai/gpt-5.4" (wrapped in LitellmModel) was
    mis-classified — reasoning dropped and temperature wrongly forced on.
    """
    agent = BaseAgent.__new__(BaseAgent)

    settings = agent._adjust_model_settings(
        LitellmModel("openrouter/openai/gpt-5.4"),
        ModelSettings(),
    )

    assert settings.reasoning is not None
    assert settings.temperature is None


def test_adjust_model_settings_routed_matches_native_for_reasoning_model():
    """Routed and native addressing of the same model yield the same capabilities."""
    agent = BaseAgent.__new__(BaseAgent)

    native = agent._adjust_model_settings("openai/gpt-5.4", ModelSettings())
    routed = agent._adjust_model_settings(
        LitellmModel("openrouter/openai/gpt-5.4"), ModelSettings()
    )

    assert (native.reasoning is None) == (routed.reasoning is None)
    assert (native.temperature is None) == (routed.temperature is None)
