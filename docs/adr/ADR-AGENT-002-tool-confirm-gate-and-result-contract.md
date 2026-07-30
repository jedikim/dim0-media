# ADR-AGENT-002: Off-board tool confirm gate + unified tool-result contract

**Status:** Accepted · 2026-07-30
**Applies to:** `webui/src/features/agent/engine/**` (esp. `agent-loop.ts`, `tool-result.ts`, `tool-confirm-store.ts`, `types.ts`), `webui/src/features/agent/settings/tool-trust-store.ts`

## Decision
For the browser agent:
- Off-board tools (network egress + code execution) MUST be declared ONLY in
  `CONFIRM_TOOL_NAMES` (`engine/types.ts`) — the single source the loop's gate
  (`CONFIRM_TOOLS`) and the settings trust store both derive from. Adding a gated
  tool is a one-line change there.
- Every tool call MUST go through `executeToolCall` (the one choke point):
  unknown-tool guard → confirm gate → run, with confirm + run under one
  try/catch (so a throwing confirmer or tool never aborts the run).
- A tool signals failure by returning `{ error: string }`; `executeToolCall`
  normalizes it — and declined / unknown / thrown — into a `ToolFailure
  { ok:false, error, tool, message }`. `isToolFailure(result)` is the ONE
  "did it fail?" check for runtime, UI, and telemetry. New tools MUST use the
  `{ error }` convention, not invent a new shape.
- Confirm semantics: **deny is per specific call** (tool + args); **approve
  ("allow for this request") is per tool for the run**; a **persistent per-tool
  grant** (Settings) resolves to `once`, re-read each call so a mid-run revoke
  applies on the next call.

## Why
The gate exists to stop PROMPT-INJECTED off-board calls — a malicious note or
uploaded doc steering the agent to exfiltrate board data or run attacker code.
So it MUST fail closed: with no confirmer wired the tool doesn't run, and the
only production toolset containing gated tools always wires one.
- **Deny is per-call** because distinct web searches warrant distinct decisions;
  a per-tool ban after one refusal silently blocked later searches and read as a
  bug.
- **Approve is per-tool** because "allow for this request" is a deliberate broad
  grant; the persistent setting is likewise per-tool (trusting web search must
  not trust code execution).
- The unified `ToolFailure` replaced two divergent conventions (structured loop
  errors vs bare `{ error }`) that left "did it fail?" unanswerable and rendered
  failed calls as successes.

## Consequences
- New off-board tool: add its name to `CONFIRM_TOOL_NAMES` → gated + Settings-
  toggleable automatically, no other wiring.
- `resolveConfirmDecision` reads the persistent grant + the dialog via
  `getState()` per call, so Settings toggles take effect mid-run.
- `tool_error` (the tool threw) and `tool_rejected` (the tool returned `{error}`)
  are distinct codes — crash-with-retry vs deliberate rejection.

## Rejected alternatives
- **Per-tool decline memory** — banned distinct calls of the same tool after one
  refusal (the reported bug).
- **Two error conventions** (loop `ToolFailure` + tool `{ error }`) — no single
  failure check; the `state:"failed"` step render was dead.

## Verify
`grep -rn "CONFIRM_TOOL_NAMES" webui/src/features/agent` shows one definition
(`engine/types.ts`) consumed by both `agent-loop.ts` and `tool-trust-store.ts` —
i.e. no second hand-maintained gated-tool list.
