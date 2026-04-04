"""Reasoning-related data types."""

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel

from topix.agents.datatypes.outputs import ToolOutput
from topix.agents.datatypes.tools import AgentToolName

MAX_COMPACT_TEXT_LENGTH = 10_000
MAX_COMPACT_COLLECTION_ITEMS = 10
CONTENT_HEAVY_KEYS = {
    "answer",
    "code",
    "content",
    "html",
    "input",
    "input_text",
    "markdown",
    "message",
    "new",
    "old",
    "query_text",
    "reasoning",
    "stderr",
    "stdout",
    "text",
}


class ToolCallState(StrEnum):
    """Enum for reasoning step states."""

    STARTED = "started"
    COMPLETED = "completed"
    FAILED = "failed"


class ToolCall(BaseModel):
    """A single step in the reasoning process."""

    type: Literal["tool_call"] = "tool_call"
    id: str
    name: AgentToolName
    thought: str = ""
    output: ToolOutput
    event_messages: list[str] = []
    state: ToolCallState = ToolCallState.STARTED
    arguments: dict[str, Any] = {}

    def to_compact_step_description(self) -> str:
        """Convert to a compact string representation for display."""
        input_repr = self._compact_input_repr()
        output_repr = self._compact_output_repr()
        parts = [f'<ToolCall name="{self.name}">']
        if input_repr:
            parts.append(f"<Input>{input_repr}</Input>")
        if output_repr:
            parts.append(f"<Output>{output_repr}</Output>")
        parts.append("</ToolCall>")
        return "\n".join(parts)

    def _compact_input_repr(self) -> str:
        """Return a short input summary for the tool call history block."""
        args_str = ", ".join(
            f'{key}="{self._format_compact_value(key, value)}"'
            for key, value in self.arguments.items()
        )
        if len(args_str) > MAX_COMPACT_TEXT_LENGTH:
            return args_str[:MAX_COMPACT_TEXT_LENGTH] + "..."
        return args_str

    def _compact_output_repr(self) -> str:
        """Return a short output summary suitable for chat history compaction."""
        if isinstance(self.output, str):
            if self.name == AgentToolName.LEARN_GENERATE_HTML_WIDGET:
                return "loaded widget generation guidance"
            compact = self.output.strip().replace("\n", " ")
            return compact[:MAX_COMPACT_TEXT_LENGTH] + ("..." if len(compact) > MAX_COMPACT_TEXT_LENGTH else "")

        if hasattr(self.output, "to_compact_repr"):
            return self.output.to_compact_repr()

        return ""

    def _format_compact_value(self, key: str, value: Any) -> str:  # noqa: C901
        """Collapse noisy inputs into short metadata-oriented summaries."""
        if value is None:
            return "null"

        if isinstance(value, str):
            compact = " ".join(value.split())
            if key in CONTENT_HEAVY_KEYS:
                return f"<{len(value)} chars>"
            if len(compact) > MAX_COMPACT_TEXT_LENGTH:
                return compact[:MAX_COMPACT_TEXT_LENGTH] + "..."
            return compact

        if isinstance(value, dict):
            if not value:
                return "{}"
            items = []
            for index, (nested_key, nested_value) in enumerate(value.items()):
                if index >= MAX_COMPACT_COLLECTION_ITEMS:
                    items.append("...")
                    break
                items.append(
                    f"{nested_key}={self._format_compact_value(nested_key, nested_value)}"
                )
            return "{ " + ", ".join(items) + " }"

        if isinstance(value, list):
            if not value:
                return "[]"
            if len(value) > MAX_COMPACT_COLLECTION_ITEMS:
                return f"[{len(value)} items]"
            return "[" + ", ".join(self._format_compact_value(key, item) for item in value) + "]"

        return str(value)
