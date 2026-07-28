/**
 * Code interpreter as a service — a managed `CodeClient` + the `code_interpreter`
 * agent tool + resolution.
 *
 * Execution runs in a Daytona sandbox via `/ai/code` (a browser can't run a
 * sandbox). "Our keys first, yours as fallback": a signed-in user runs on our
 * Daytona account; if that's over quota (429) and the user has a BYOK Daytona
 * key, the run is retried with `X-Provider-Key` (relayed, not stored).
 * Signed-out has no authed proxy → off.
 */
import { z } from "zod"
import { defineTool, type Tool } from "./types"
import type { CodeClient, CodeResult } from "./services/clients"
import { resolveService } from "./services/resolve"
import { isOverQuotaError, runIdHeaders } from "./services/run"
import { servicesPost } from "./services/transport"


type CodeResponse = {
  status: "success" | "error" | "timeout"
  stdout: string
  stderr: string
  duration_ms: number
}


/** POST code to `/ai/code`. Injectable for tests. */
export type CodePost = (body: { code: string; language: string }) => Promise<CodeResponse>


const makeDefaultCodePost = (runId?: string, byokKey?: string, alwaysByok = false): CodePost => async (body) => {
  const call = (withKey: boolean) =>
    servicesPost<CodeResponse>("/ai/code", body, {
      ...runIdHeaders(runId),
      ...(withKey && byokKey ? { "X-Provider-Key": byokKey } : {}),
    })
  // byok mode → run on the user's Daytona key directly; managed → ours first,
  // fall back to their key on a 429 (over quota).
  if (alwaysByok && byokKey) return call(true)
  try {
    return await call(false)
  } catch (e) {
    if (byokKey && isOverQuotaError(e)) return call(true)
    throw e
  }
}


/** Managed code client — our Daytona via `/ai/code`, BYOK key as fallback (or the source in byok mode). */
export const managedCodeClient = (
  opts: { runId?: string; byokKey?: string; alwaysByok?: boolean; post?: CodePost } = {},
): CodeClient => {
  const post = opts.post ?? makeDefaultCodePost(opts.runId, opts.byokKey, opts.alwaysByok)
  return {
    async run(code: string, language: string): Promise<CodeResult> {
      const r = await post({ code, language })
      const ok = r.status === "success"
      return {
        ok,
        stdout: r.stdout,
        stderr: r.stderr,
        error: ok ? undefined : r.stderr || r.status,
      }
    },
  }
}


/** Resolve the code service to a client, or null when unavailable. A saved
 *  Daytona key makes code available even signed-out (relayed); signed-in prefers
 *  our account with the key as the over-limit fallback. */
export const resolveCodeClient = (opts: {
  signedIn: boolean
  runId?: string
  byokKey?: string | null
}): CodeClient | null => {
  const cred = opts.byokKey ? { provider: "daytona", apiKey: opts.byokKey } : undefined
  const resolution = resolveService("code", {
    signedIn: opts.signedIn,
    preferManaged: opts.signedIn,
    byok: cred ? { code: cred } : {},
  })
  if (resolution.mode === "off") return null
  return managedCodeClient({
    runId: opts.runId,
    byokKey: opts.byokKey ?? undefined,
    alwaysByok: resolution.mode === "byok",
  })
}


/** The `code_interpreter` agent tool, backed by a resolved code client. */
export const makeCodeInterpreterTool = (client: CodeClient): Tool =>
  defineTool({
    name: "code_interpreter",
    description:
      "Run Python or JavaScript in an isolated sandbox and return stdout/stderr. Use for calculations, data wrangling, or verifying logic.",
    parameters: z.object({
      code: z.string().describe("Source code to execute"),
      language: z.enum(["python", "javascript"]).default("python"),
    }),
    run: async ({ code, language }) => client.run(code, language),
  })
