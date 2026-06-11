"""Widget learning tools."""

from agents import RunContextWrapper

from topix.agents.datatypes.context import Context
from topix.agents.datatypes.tools import AgentToolName, tool_descriptions
from topix.agents.prompt_utils import render_prompt
from topix.agents.tool_handler import ToolHandler


async def learn_generate_html_widget(_wrapper: RunContextWrapper[Context]) -> str:
    """Load guidance for generating HTML widget notes."""
    return render_prompt("widget/learn_generate_html_widget.jinja")


learn_generate_html_widget_tool = ToolHandler.convert_func_to_tool(
    learn_generate_html_widget,
    tool_name=AgentToolName.LEARN_GENERATE_HTML_WIDGET,
    tool_description=tool_descriptions.get(AgentToolName.LEARN_GENERATE_HTML_WIDGET, ""),
)


async def learn_generate_mini_app(_wrapper: RunContextWrapper[Context]) -> str:
    """Load guidance for authoring sandboxed interactive React mini-apps."""
    return render_prompt("widget/learn_generate_mini_app.jinja")


learn_generate_mini_app_tool = ToolHandler.convert_func_to_tool(
    learn_generate_mini_app,
    tool_name=AgentToolName.LEARN_GENERATE_MINI_APP,
    tool_description=tool_descriptions.get(AgentToolName.LEARN_GENERATE_MINI_APP, ""),
)


async def learn_generate_diagram(_wrapper: RunContextWrapper[Context]) -> str:
    """Load guidance for composing structured multi-note answers.

    Loaded lazily before any mindmap / schema / flowchart / taxonomy turn —
    teaches the brevity rule (short content per node) and the minimal
    shape vocabulary (rectangle / ellipse / diamond) so the resulting
    diagram reads at a glance instead of bunching paragraph-length text
    into uniformly-rectangular cards.
    """
    return render_prompt("widget/learn_generate_diagram.jinja")


learn_generate_diagram_tool = ToolHandler.convert_func_to_tool(
    learn_generate_diagram,
    tool_name=AgentToolName.LEARN_GENERATE_DIAGRAM,
    tool_description=tool_descriptions.get(AgentToolName.LEARN_GENERATE_DIAGRAM, ""),
)
