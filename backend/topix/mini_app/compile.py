"""Compile + validate agent-authored mini-app JSX.

Runs the sucrase-based Node CLI under ``backend/scripts/mini-app-compiler``
as a subprocess and parses its JSON response. We **do not** evaluate
the agent's code server-side — that would give it access to Node's
globals (fs, child_process, fetch) which is a remote-code-execution
surface. The contract here is: "this string sucrase-transpiles cleanly
and declares a Widget/App at the top level." Subtler runtime errors
(e.g. referencing identifiers not in the iframe scope) get caught at
render time by the iframe runtime's error boundary.

The Python wrapper is async (spawns the subprocess via ``asyncio``),
returns a structured ``CompileResult`` rather than raising on
agent-level errors, and times out after 10 seconds for the subprocess
call itself — a hung Node process should not pin the validate_note
tool indefinitely.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil

from pathlib import Path
from typing import Literal

from pydantic import BaseModel

logger = logging.getLogger(__name__)


# Subprocess wall-clock budget. sucrase compile of a typical agent
# widget runs in <50ms; 10 seconds is a generous ceiling for "the
# subprocess hung" rather than a perf target.
_COMPILE_TIMEOUT_SECONDS = 10.0


# Where the Node compiler lives. Resolved once at import time.
_COMPILER_SCRIPT = (
    Path(__file__).resolve().parent.parent.parent
    / "scripts"
    / "mini-app-compiler"
    / "compile.mjs"
)


class CompileError(BaseModel):
    """One compile-level problem in a mini-app source string."""

    kind: Literal["compile", "no_widget", "empty", "subprocess_failure"]
    message: str
    line: int | None = None
    column: int | None = None


class CompileResult(BaseModel):
    """Outcome of compiling a mini-app source string."""

    ok: bool
    error: CompileError | None = None


def _resolve_node_binary() -> str:
    """Locate the ``node`` executable on PATH or fail loudly.

    Raises :class:`RuntimeError` with a clear message when not found so
    future contributors aren't left squinting at a cryptic
    FileNotFoundError. Phase 3 added ``nodejs`` to the backend
    Dockerfile; local dev needs Node installed independently.
    """
    binary = shutil.which("node")
    if binary is None:
        raise RuntimeError(
            "node binary not found on PATH — install Node (>=18) to run "
            "the mini-app compile bridge. Backend Dockerfile installs it "
            "automatically; for local dev see backend/scripts/"
            "mini-app-compiler/README or run `brew install node` / "
            "`apt install nodejs`."
        )
    return binary


async def compile_mini_app_source(source: str) -> CompileResult:
    """Compile + validate a mini-app source string.

    Returns ``CompileResult(ok=True)`` on success and
    ``CompileResult(ok=False, error=...)`` on any failure mode (syntax
    error, missing Widget/App, empty source, subprocess crash).
    """
    if not _COMPILER_SCRIPT.exists():
        return CompileResult(
            ok=False,
            error=CompileError(
                kind="subprocess_failure",
                message=(
                    f"mini-app compiler script missing at {_COMPILER_SCRIPT}; "
                    "did backend/scripts/mini-app-compiler get included in the "
                    "image / checked out?"
                ),
            ),
        )

    try:
        node_binary = _resolve_node_binary()
    except RuntimeError as exc:
        return CompileResult(
            ok=False,
            error=CompileError(kind="subprocess_failure", message=str(exc)),
        )

    proc = await asyncio.create_subprocess_exec(
        node_binary,
        str(_COMPILER_SCRIPT),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(source.encode("utf-8")),
            timeout=_COMPILE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return CompileResult(
            ok=False,
            error=CompileError(
                kind="subprocess_failure",
                message=(
                    f"compile subprocess timed out after "
                    f"{_COMPILE_TIMEOUT_SECONDS:.0f}s"
                ),
            ),
        )

    if proc.returncode != 0:
        # The Node script catches its own errors and emits JSON with
        # ok=false rather than non-zero exit, so a non-zero return code
        # means the script itself died unexpectedly (e.g. missing
        # node_modules). Surface stderr for the maintainer.
        err_text = stderr.decode("utf-8", errors="replace").strip()
        logger.error(
            "mini-app compile subprocess exited with code %s: %s",
            proc.returncode,
            err_text,
        )
        return CompileResult(
            ok=False,
            error=CompileError(
                kind="subprocess_failure",
                message=(
                    f"compile subprocess exited with code {proc.returncode}"
                    + (f": {err_text}" if err_text else "")
                ),
            ),
        )

    try:
        payload = json.loads(stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        return CompileResult(
            ok=False,
            error=CompileError(
                kind="subprocess_failure",
                message=f"compile subprocess returned non-JSON: {exc}",
            ),
        )

    if payload.get("ok") is True:
        return CompileResult(ok=True)

    error_payload = payload.get("error") or {}
    return CompileResult(
        ok=False,
        error=CompileError(
            kind=error_payload.get("kind", "compile"),
            message=error_payload.get("message", "unknown compile error"),
            line=error_payload.get("line"),
            column=error_payload.get("column"),
        ),
    )
