"""write_note validation for mini-app note type.

Mini-app sources must sucrase-compile cleanly + declare a top-level
Widget/App before the note is persisted. These tests exercise the
write_note tool's pre-persist guard.

The compile bridge spawns a real Node subprocess (see
test/unit/mini_app/test_compile.py) — that's needed for end-to-end
fidelity. Tests are skipped cleanly when ``node`` isn't on PATH so
contributors without a local Node install still get a green build.
"""

from __future__ import annotations

import asyncio
import json
import shutil

from unittest.mock import AsyncMock

import pytest

from agents.tool_context import ToolContext

from topix.agents.datatypes.context import Context
from topix.agents.notes.tools import create_write_note_tool
from topix.datatypes.note.style import NodeType

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None,
    reason="`node` not on PATH — mini-app compile bridge cannot run",
)


_VALID_MINI_APP_SOURCE = """
function Widget() {
  const [count, setCount] = useState(0)
  return <div onClick={() => setCount(count + 1)}>{count}</div>
}
""".strip()


_INVALID_SYNTAX_SOURCE = "function Widget(  return <div/>"


_NO_WIDGET_SOURCE = "const helper = (x) => x + 1"


class _DummyGraphStore:
    """Minimal graph-store stub matching the shape note tools use."""

    def __init__(self) -> None:
        """Init the AsyncMock surface that build_note + write_note touch."""
        self.add_notes = AsyncMock()
        self.add_links = AsyncMock()
        self.get_graph = AsyncMock(
            return_value=type("Graph", (), {"nodes": []})()
        )
        self.get_nodes = AsyncMock(return_value=[])
        self.patch_note = AsyncMock()
        self._note_locks: dict[str, asyncio.Lock] = {}


    def note_lock(self, note_id: str) -> asyncio.Lock:
        """Mirror GraphStore.note_lock so tools can serialize edits."""
        return self._note_locks.setdefault(note_id, asyncio.Lock())


def _make_tool(graph_store: _DummyGraphStore):
    """Build the write_note tool with no agent bridge (direct store calls)."""
    return create_write_note_tool(
        graph_store=graph_store,  # type: ignore[arg-type]
        graph_uid="board-1",
        root_id=None,
        agent_bridge=None,
    )


def _ctx() -> ToolContext[Context]:
    """ToolContext stub matching the existing note-tool test pattern."""
    return ToolContext(
        context=Context(),
        tool_name="write_note",
        tool_call_id="test-call-id",
        tool_arguments="{}",
    )


async def _invoke(tool, **kwargs):
    """Invoke a FunctionTool with arbitrary keyword args."""
    return await tool.on_invoke_tool(_ctx(), json.dumps(kwargs))


async def test_valid_mini_app_source_creates_note():
    """A clean Widget source persists as a mini-app note."""
    store = _DummyGraphStore()
    tool = _make_tool(store)

    result = await _invoke(
        tool,
        content=_VALID_MINI_APP_SOURCE,
        note_type="mini-app",
    )

    assert result.action == "created"
    store.add_notes.assert_awaited_once()
    persisted_note = store.add_notes.await_args.args[0][0]
    assert persisted_note.style.type == NodeType.MINI_APP


async def test_syntax_error_in_mini_app_is_rejected_with_line_col():
    """Sucrase syntax errors surface as a tool-result error, no persist.

    The agents-sdk's FunctionTool runner catches our ValueError and
    converts it into a string result of the form "Function call
    failed: <message>" — so we assert on the returned string rather
    than expecting an exception.
    """
    store = _DummyGraphStore()
    tool = _make_tool(store)

    result = await _invoke(
        tool,
        content=_INVALID_SYNTAX_SOURCE,
        note_type="mini-app",
    )

    text = str(result)
    assert "mini-app" in text
    assert "line" in text
    store.add_notes.assert_not_awaited()


async def test_no_widget_in_mini_app_is_rejected():
    """Source that parses but defines no Widget/App is rejected."""
    store = _DummyGraphStore()
    tool = _make_tool(store)

    result = await _invoke(
        tool,
        content=_NO_WIDGET_SOURCE,
        note_type="mini-app",
    )

    text = str(result)
    assert "Widget" in text
    assert "no_widget" in text or "no Widget" in text
    store.add_notes.assert_not_awaited()


async def test_non_mini_app_note_skips_compile_validation():
    """A rectangle note with malformed-looking content is *not* validated.

    Pins the contract that the compile guard only fires for
    ``note_type=mini-app``. Other note types accept anything — the
    validation is content-type-specific.
    """
    store = _DummyGraphStore()
    tool = _make_tool(store)

    # This string would fail mini-app validation, but rectangle notes
    # accept arbitrary prose/markdown.
    await _invoke(
        tool,
        content=_INVALID_SYNTAX_SOURCE,
        note_type=NodeType.RECTANGLE,
    )

    store.add_notes.assert_awaited_once()
