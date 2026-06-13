"""Tests for the mini-app sucrase compile bridge.

These run the real Node subprocess against
``backend/scripts/mini-app-compiler/compile.mjs`` — they're effectively
integration tests for the Python↔Node bridge. The script's
``node_modules`` must be installed (``npm ci`` in that dir, or
``make setup-mini-app-compiler``); both CI and the Dockerfile do this.
Tests skip with a helpful message when ``node`` isn't on PATH **or** the
compiler's ``node_modules`` is absent.
"""

from __future__ import annotations

import shutil

import pytest

from topix.mini_app.compile import _COMPILER_SCRIPT, compile_mini_app_source

# All tests in this module need a real Node binary AND the compiler's
# installed node_modules (sucrase). Skip cleanly when either is missing
# so a contributor without the local setup gets a green-by-skip rather
# than a confusing `subprocess_failure` from an ERR_MODULE_NOT_FOUND.
# CI / the Dockerfile install the deps; locally run `make
# setup-mini-app-compiler` (or `npm ci` in that dir).
_NODE_MISSING = shutil.which("node") is None
_DEPS_MISSING = not (_COMPILER_SCRIPT.parent / "node_modules").is_dir()
pytestmark = pytest.mark.skipif(
    _NODE_MISSING or _DEPS_MISSING,
    reason=(
        "mini-app compile bridge unavailable — needs `node` on PATH and the "
        "compiler's node_modules (run `make setup-mini-app-compiler`)"
    ),
)


_VALID_WIDGET = """
function Widget() {
  const [count, setCount] = useState(0)
  return <div onClick={() => setCount(count + 1)}>{count}</div>
}
"""


async def test_valid_widget_compiles():
    """A clean Widget definition returns ok=True."""
    result = await compile_mini_app_source(_VALID_WIDGET)
    assert result.ok is True
    assert result.error is None


async def test_arrow_const_widget_compiles():
    """`const Widget = () => ...` is also accepted."""
    result = await compile_mini_app_source(
        "const Widget = () => <div>hi</div>"
    )
    assert result.ok is True


async def test_alternative_app_export_compiles():
    """The fallback `App` name is recognized."""
    result = await compile_mini_app_source(
        "function App() { return <div/> }"
    )
    assert result.ok is True


async def test_syntax_error_returns_compile_kind():
    """Sucrase syntax errors come back as kind=compile + line/col."""
    bad = "function Widget(  return <div/>"
    result = await compile_mini_app_source(bad)
    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "compile"
    # sucrase reports a position for this case
    assert result.error.line is not None
    assert result.error.column is not None


async def test_empty_source_returns_empty_kind():
    """An empty string is rejected cleanly, not as a parse error."""
    result = await compile_mini_app_source("")
    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "empty"


async def test_whitespace_only_source_returns_empty_kind():
    """Whitespace-only input is treated the same as truly empty."""
    result = await compile_mini_app_source("   \n  \t  ")
    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "empty"


async def test_source_without_widget_returns_no_widget_kind():
    """Source that parses but defines no Widget/App is rejected."""
    result = await compile_mini_app_source("const x = 42")
    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "no_widget"
    assert "Widget" in result.error.message


async def test_typescript_annotations_are_stripped():
    """TS types in the source compile through sucrase's typescript transform."""
    source = """
    interface Props { initial: number }
    function Widget(props: Props): JSX.Element {
      const [n, setN] = useState<number>(props.initial)
      return <div>{n}</div>
    }
    """
    result = await compile_mini_app_source(source)
    assert result.ok is True


async def test_unicode_in_source_does_not_corrupt_round_trip():
    """Non-ASCII characters in JSX strings survive the subprocess pipe."""
    source = "function Widget() { return <div>résumé · 日本語 · 😀</div> }"
    result = await compile_mini_app_source(source)
    assert result.ok is True


async def test_very_long_source_is_not_rejected_for_size():
    """A large but valid source compiles fine — no artificial size cap."""
    body = "<div>" + "<span>x</span>" * 5000 + "</div>"
    source = f"function Widget() {{ return {body} }}"
    result = await compile_mini_app_source(source)
    assert result.ok is True
