/**
 * Per-run metering header. A whole agent run (one user message) carries a single
 * `X-Run-Id`; the server charges the plan's AI quota once per run id and lets the
 * rest of the run's managed calls through free (see backend `meter_run`). All
 * managed transports attach this header.
 */
export const RUN_ID_HEADER = "X-Run-Id"


/** Header object carrying the run id, or empty when there's no run context. */
export const runIdHeaders = (runId?: string): Record<string, string> =>
  runId ? { [RUN_ID_HEADER]: runId } : {}


/**
 * True when an error surfaced an HTTP 429 from a managed call — i.e. the run was
 * rejected for being over the plan's AI quota. Both transports fold the status
 * into the error message (`apiFetch` → "429 …", the stream → "…failed: 429"), so
 * a word-boundary match on 429 is a reliable signal for the over-quota UX.
 */
export const isOverQuotaError = (err: unknown): boolean =>
  /\b429\b/.test(err instanceof Error ? err.message : String(err))
