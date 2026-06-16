"""Tests for widget learning tools."""

from __future__ import annotations

import pytest

from agents import RunContextWrapper

from topix.agents.datatypes.context import Context
from topix.agents.prompt_utils import render_prompt
from topix.agents.widgets.learn import (
    learn_generate_diagram,
    learn_generate_html_widget,
    learn_generate_mini_app,
)


@pytest.mark.asyncio
async def test_learn_generate_html_widget_returns_widget_note_guidance() -> None:
    """HTML widget skill still returns guidance, with a deprecation banner.

    The note type stays renderable forever (existing widget notes), but
    the skill must steer the agent toward mini-app for new authoring.
    """
    prompt = await learn_generate_html_widget(RunContextWrapper(Context()))

    assert "write_note" in prompt
    # Phase A deprecation banner — anchored so it can't silently regress.
    assert "legacy" in prompt.lower()
    assert "learn_generate_mini_app" in prompt


@pytest.mark.asyncio
async def test_learn_generate_mini_app_returns_skill_prompt() -> None:
    """Mini-app learning tool returns prompt guidance for mini-app notes."""
    prompt = await learn_generate_mini_app(RunContextWrapper(Context()))

    # The skill prompt must teach the contract the validator enforces:
    # write_note + the mini-app note type + the host RPC surface + the
    # Widget convention. If any of these drop out we'd ship a misleading
    # prompt the agent can't act on.
    assert "write_note" in prompt
    assert "mini-app" in prompt
    assert "host.saveState" in prompt
    assert "Widget" in prompt
    # Drift guard for the scope manifest: when new identifiers join
    # MINI_APP_SCOPE on the frontend, the prompt must mention them too —
    # otherwise the agent doesn't know they're available and the
    # widgets it ships are limited to a stale subset of the runtime.
    assert "Chart" in prompt
    assert "Graph" in prompt
    # Map primitive — agents must know the world choropleth exists and that
    # they supply data by country name, not coordinates.
    assert "Map" in prompt
    assert "choropleth" in prompt
    assert "markers" in prompt
    # Graph layout vocabulary — the agent must know it can hand over a bare
    # node/edge list and pick a layout instead of hand-computing every x/y.
    # If these drop out, the prompt regresses to the old "supply coordinates
    # yourself" contract and widgets get tangled graphs again.
    assert "force" in prompt
    assert "tree" in prompt
    assert "manual" in prompt
    # Typography + color guidance — the agent must know about the three
    # font families and the semantic shadcn palette, otherwise widgets
    # come out monochrome and don't theme across light/dark.
    assert "font-handwriting" in prompt
    assert "font-mono" in prompt
    assert "bg-card" in prompt
    assert "text-muted-foreground" in prompt
    assert "oklch" in prompt
    # Color rules that keep widgets readable + themed: every colored bg
    # pairs with its foreground, primary is reserved for the one main
    # action, secondary is the default themed surface, and chart-N is the
    # categorical ramp. If these regress, widgets go monochrome or ship
    # unreadable text on colored backgrounds.
    assert "text-primary-foreground" in prompt
    assert "text-secondary-foreground" in prompt
    assert "chart-1" in prompt
    assert "visual explainers" in prompt
    # Phase A demotion: the prompt no longer compares to HTML widget —
    # mini-app is the answer, not "the better of two options". Keeps
    # us from accidentally re-introducing the decision tree.
    assert "HTML widget" not in prompt
    assert "Pick mini-app over" not in prompt


@pytest.mark.asyncio
async def test_learn_generate_diagram_returns_skill_prompt() -> None:
    """Diagram skill must teach brevity + the rectangle/ellipse/diamond shape vocabulary.

    The agent loads this skill before any multi-note structured answer
    (mindmap, taxonomy, schema, flowchart). Drift guards:
    - the brevity rule survives ("paragraph" forbidden, "label" mentioned)
    - the minimal shape vocabulary (rectangle / ellipse / diamond) is in
      the prompt — if any drops, the agent can't tell when to mix them
    - the calls the skill anchors on (`write_note`, `link_notes`) stay
    """
    prompt = await learn_generate_diagram(RunContextWrapper(Context()))

    assert "write_note" in prompt
    assert "link_notes" in prompt
    # Brevity rule.
    assert "paragraph" in prompt.lower()
    assert "label" in prompt.lower()
    # Shape vocabulary — narrow on purpose (no capsule / tag / thought-cloud).
    assert "rectangle" in prompt
    assert "ellipse" in prompt
    assert "diamond" in prompt
    # Mindmap/taxonomy hub: the root is a layered-circle, branches rectangles.
    # Drift here would let the agent flatten the center back into a rectangle.
    assert "layered-circle" in prompt
    # Hub-plus-rectangles rule for pure taxonomies — drift would
    # let the agent over-decorate hierarchies.
    assert "taxonomy" in prompt.lower() or "hierarchy" in prompt.lower()


def test_plan_system_prompt_lists_mini_app_before_html_widget() -> None:
    """Plan agent's main prompt should reach for mini-app first.

    The PICK ONE FORMAT decision tree drives which `learn_generate_*`
    skill the agent loads. If HTML widget is mentioned before mini-app,
    the agent's first-pass heuristic pulls the legacy skill and we
    silently regress on the deprecation. Anchor the order explicitly.
    """
    prompt = render_prompt("plan.system.jinja")
    mini_app_idx = prompt.find("learn_generate_mini_app")
    html_widget_idx = prompt.find("learn_generate_html_widget")
    assert mini_app_idx >= 0, "mini-app skill must be referenced in plan.system.jinja"
    assert html_widget_idx >= 0, "html widget skill still referenced as legacy"
    assert mini_app_idx < html_widget_idx, (
        "mini-app must be listed before HTML widget in plan.system.jinja "
        "so the agent's first-pass heuristic picks the modern skill"
    )
    # Demotion marker — same idea as above but anchored to the literal.
    assert "legacy" in prompt.lower()
    # Diagram skill must be referenced so the agent knows to call it
    # before a mindmap / schema / flowchart turn.
    assert "learn_generate_diagram" in prompt
