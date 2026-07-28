"""Primitive code execution tool backed by Daytona sandboxes."""

import asyncio
import contextlib
import logging
import os
import time

from typing import Literal

from agents import RunContextWrapper
from daytona import (
    AsyncDaytona,
    AsyncSandbox,
    CreateSandboxFromImageParams,
    CreateSandboxFromSnapshotParams,
    DaytonaConfig,
    Image,
)

from topix.agents.datatypes.context import Context
from topix.agents.datatypes.outputs import CodeInterpreterOutput
from topix.agents.datatypes.tools import AgentToolName, tool_descriptions
from topix.agents.tool_handler import ToolHandler

logger = logging.getLogger(__name__)

MAX_CONCURRENT_CODE_RUNS = int(os.getenv("CODE_INTERPRETER_MAX_CONCURRENT_RUNS", "20"))
CODE_RUN_TIMEOUT_SECONDS = int(os.getenv("CODE_INTERPRETER_TIMEOUT_SECONDS", "60"))
SANDBOX_CREATE_TIMEOUT_SECONDS = int(os.getenv("CODE_INTERPRETER_CREATE_TIMEOUT_SECONDS", "30"))
SANDBOX_AUTO_STOP_INTERVAL_MINUTES = int(os.getenv("CODE_INTERPRETER_AUTO_STOP_MINUTES", "5"))
CODE_RUN_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_CODE_RUNS)
REQUIRED_DAYTONA_ENV_VARS = (
    "DAYTONA_API_KEY",
    "DAYTONA_API_URL",
    "DAYTONA_TARGET",
)

# Languages Daytona can actually execute via its built-in code toolboxes
# (`process.code_run`). These values match Daytona's `CodeLanguage` enum
# verbatim, so they pass straight through to sandbox creation. Any other
# language is a display-only code note — the UI hides the run affordance
# and this module never sees an execute request for it.
RUNNABLE_LANGUAGES = frozenset({"python", "javascript"})
DEFAULT_LANGUAGE = "python"

# Each runnable language maps to a *runtime family* — the toolchain its
# sandbox image must carry. Several languages can share one family (and so
# one image), e.g. javascript and (later) typescript both run on Node. The
# image is selected per family, not per language, so adding a language that
# reuses an existing runtime is free.
LANGUAGE_FAMILY: dict[str, str] = {
    "python": "python",
    "javascript": "node",
}
DEFAULT_FAMILY = "python"


def _family_for(language: str) -> str:
    """Return the runtime family (shared image) for a runnable language."""
    return LANGUAGE_FAMILY.get(language, DEFAULT_FAMILY)


def _default_family_image(family: str) -> Image:
    """Build the declarative fallback image for a runtime family.

    Daytona content-addresses and caches the built image, so it's built once
    then reused. Only used when no ``DAYTONA_SNAPSHOT_<FAMILY>`` /
    ``DAYTONA_IMAGE_<FAMILY>`` (or, for python, the legacy global vars) is
    configured — production should point those at pre-warmed snapshots.
    """
    if family == "node":
        # Node runs javascript out of the box — no extra install needed.
        return Image.base("node:20-slim")
    return Image.debian_slim("3.13")


class DaytonaSandboxManager:
    """Create and tear down a Daytona sandbox for a single code execution."""

    def __init__(self, api_key: str | None = None):
        """Initialize the sandbox manager.

        `api_key` is a caller-supplied (BYOK) Daytona key used instead of the
        env default; the service URL/target stay env-configured. Held only for
        this run — never persisted.
        """
        daytona_config = DaytonaConfig(
            api_key=api_key or os.getenv("DAYTONA_API_KEY"),
            api_url=os.getenv("DAYTONA_API_URL"),
            target=os.getenv("DAYTONA_TARGET", "eu")
        )

        self._client = AsyncDaytona(config=daytona_config)
        self._image = os.getenv("DAYTONA_IMAGE")
        self._snapshot = os.getenv("DAYTONA_SNAPSHOT")

    def _sandbox_kwargs(self, language: str) -> dict[str, object]:
        """Return shared sandbox creation defaults for short-lived code runs.

        ``language`` selects Daytona's code toolbox (the command used by
        ``code_run``); the configured image/snapshot must carry the matching
        runtime (e.g. Node for javascript/typescript).
        """
        return {
            "language": language,
            "auto_stop_interval": SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
            "network_block_all": True,
            "ephemeral": True,
        }

    def _resolve_source(self, family: str) -> tuple[str, object]:
        """Resolve the sandbox source for a runtime family.

        Returns ``("snapshot", name)`` or ``("image", image)`` where image is
        a registry name or a declarative ``Image``. Precedence:
          1. ``DAYTONA_SNAPSHOT_<FAMILY>`` (pre-warmed snapshot)
          2. ``DAYTONA_IMAGE_<FAMILY>`` (registry image name)
          3. legacy global ``DAYTONA_SNAPSHOT`` / ``DAYTONA_IMAGE`` — scoped to
             the python family only, since they predate per-language support
             and only ever ran python (keeps existing deploys unchanged)
          4. the declarative default image for the family
        """
        suffix = family.upper()
        snapshot = os.getenv(f"DAYTONA_SNAPSHOT_{suffix}")
        if snapshot:
            return "snapshot", snapshot

        image = os.getenv(f"DAYTONA_IMAGE_{suffix}")
        if image:
            return "image", image

        if family == DEFAULT_FAMILY:
            if self._snapshot:
                return "snapshot", self._snapshot
            if self._image:
                return "image", self._image

        return "image", _default_family_image(family)

    async def create(self, language: str = DEFAULT_LANGUAGE) -> AsyncSandbox:
        """Create a sandbox configured for ``language``'s code toolbox.

        The image is selected by the language's runtime family; the
        ``language`` kwarg still selects Daytona's per-language toolbox.
        """
        family = _family_for(language)
        kind, source = self._resolve_source(family)
        kwargs = self._sandbox_kwargs(language)

        if kind == "snapshot":
            params = CreateSandboxFromSnapshotParams(snapshot=source, **kwargs)
        else:
            params = CreateSandboxFromImageParams(image=source, **kwargs)

        return await self._client.create(params, timeout=SANDBOX_CREATE_TIMEOUT_SECONDS)

    async def destroy(self, sandbox: AsyncSandbox) -> None:
        """Destroy the sandbox after execution completes."""
        await sandbox.delete(timeout=CODE_RUN_TIMEOUT_SECONDS)

    async def run_code(self, sandbox: AsyncSandbox, code: str) -> tuple[str, str]:
        """Execute code inside the sandbox and capture stdio.

        The language was fixed at create time via the sandbox's code toolbox,
        so this just runs whatever the agent/user wrote against it.
        """
        response = await sandbox.process.code_run(
            code,
            timeout=CODE_RUN_TIMEOUT_SECONDS,
        )
        artifacts = getattr(response, "artifacts", None)
        stdout = getattr(artifacts, "stdout", "") or getattr(response, "result", "") or ""
        stderr = ""
        if getattr(response, "exit_code", 0) != 0:
            stderr = getattr(response, "result", "") or "Execution failed."
        return stdout, stderr

    async def close(self):
        """Close the Daytona client."""
        await self._client.close()


def _derive_status(stderr: str, timed_out: bool) -> Literal["success", "error", "timeout"]:
    """Map execution signals into the public tool status."""
    if timed_out:
        return "timeout"
    if stderr.strip():
        return "error"
    return "success"


def _get_missing_daytona_env_vars(has_byok_key: bool = False) -> list[str]:
    """Return the Daytona env vars required to enable the tool but currently unset.

    With a BYOK key the caller supplies the secret, so `DAYTONA_API_KEY` isn't
    required from the env — only the (non-secret) service URL/target are.
    """
    return [
        name
        for name in REQUIRED_DAYTONA_ENV_VARS
        if not os.getenv(name) and not (has_byok_key and name == "DAYTONA_API_KEY")
    ]


async def execute_code(
    code: str,
    language: str = DEFAULT_LANGUAGE,
    api_key: str | None = None,
) -> CodeInterpreterOutput:
    """Run code in an isolated Daytona sandbox and return execution results.

    ``language`` must be one of ``RUNNABLE_LANGUAGES``; anything else is
    rejected up front since Daytona has no toolbox to execute it. `api_key` is
    an optional BYOK Daytona key (used for this run only, never stored).
    """
    started_at = time.perf_counter()

    if language not in RUNNABLE_LANGUAGES:
        return CodeInterpreterOutput(
            status="error",
            stdout="",
            stderr=f"Language '{language}' is not runnable.",
            duration_ms=int((time.perf_counter() - started_at) * 1000),
        )

    missing_env_vars = _get_missing_daytona_env_vars(has_byok_key=bool(api_key))

    if missing_env_vars:
        return CodeInterpreterOutput(
            status="error",
            stdout="",
            stderr=(
                "Code interpreter is unavailable because Daytona is not fully configured. "
                f"Missing env vars: {', '.join(missing_env_vars)}"
            ),
            duration_ms=int((time.perf_counter() - started_at) * 1000),
        )

    sandbox_manager = DaytonaSandboxManager(api_key=api_key)
    sandbox = None
    stdout = ""
    stderr = ""

    async with CODE_RUN_SEMAPHORE:
        try:
            sandbox = await sandbox_manager.create(language)
            stdout, stderr = await sandbox_manager.run_code(sandbox, code)
        except TimeoutError:
            stderr = (
                f"Execution exceeded the {CODE_RUN_TIMEOUT_SECONDS}s limit and was stopped."
            )
        except Exception as exc:
            logger.exception("Code execution failed")
            stderr = str(exc)
        finally:
            if sandbox is not None:
                with contextlib.suppress(Exception):
                    await sandbox_manager.destroy(sandbox)
                with contextlib.suppress(Exception):
                    await sandbox_manager.close()

    duration_ms = int((time.perf_counter() - started_at) * 1000)

    return CodeInterpreterOutput(
        status=_derive_status(stderr=stderr, timed_out=False),
        stdout=stdout,
        stderr=stderr,
        duration_ms=duration_ms,
    )


async def execute_python_code(code: str) -> CodeInterpreterOutput:
    """Run Python code in an isolated Daytona sandbox (agent-tool entrypoint)."""
    return await execute_code(code, language="python")


async def run_code(
    _wrapper: RunContextWrapper[Context],
    code: str,
) -> CodeInterpreterOutput:
    """Run Python code in an isolated Daytona sandbox and return execution results.

    The tool executes one short-lived Python run, captures stdout/stderr, and always
    attempts sandbox cleanup after execution. Use explicit ``print(...)`` statements
    in the provided code because bare final expressions are not auto-displayed.

    Args:
        code: The Python source to execute; use print(...) to surface any output.

    """
    return await execute_python_code(code)


run_code_tool = ToolHandler.convert_func_to_tool(
    run_code,
    tool_name=AgentToolName.CODE_INTERPRETER,
    tool_description=tool_descriptions.get(AgentToolName.CODE_INTERPRETER, ""),
)
