/**
 * Document parsing as a service — a managed `ParseClient` + resolution.
 *
 * PDFs can't be OCR'd in the browser, so parsing always goes through `/ai/parse`
 * (Mistral OCR). "Our keys first, yours as fallback": a signed-in user hits our
 * proxy with our Mistral key; if that's over quota (429) and the user has a BYOK
 * Mistral key, the same call is retried with `X-Provider-Key` (relayed, not
 * stored). Signed-out with a BYOK key → relayed directly; otherwise off (so the
 * upload affordance greys out).
 */
import type { ServiceResolution } from "./services/kinds"
import { resolveService } from "./services/resolve"
import { isOverQuotaError, runIdHeaders } from "./services/run"
import { servicesUpload } from "./services/transport"


/** The `/ai/parse` reply: the document's OCR'd markdown + its page count. */
export type ParseResponse = { markdown: string; pages: number }


/** POST a file to `/ai/parse`. Injectable for tests. */
export type ParsePost = (file: File) => Promise<ParseResponse>


export interface ParseClient {
  parse(file: File): Promise<ParseResponse>
}


const makeDefaultParsePost = (runId?: string, byokKey?: string, alwaysByok = false): ParsePost => async (file) => {
  const call = (withKey: boolean) => {
    const form = new FormData()
    form.append("file", file)
    return servicesUpload<ParseResponse>("/ai/parse", form, {
      ...runIdHeaders(runId),
      ...(withKey && byokKey ? { "X-Provider-Key": byokKey } : {}),
    })
  }
  // byok mode → the user's Mistral key IS the source; managed → ours first, fall
  // back to their key only on a 429 (over quota).
  if (alwaysByok && byokKey) return call(true)
  try {
    return await call(false)
  } catch (e) {
    if (byokKey && isOverQuotaError(e)) return call(true)
    throw e
  }
}


/** Managed parse client — our Mistral key via `/ai/parse`, BYOK key as fallback. */
export const managedParseClient = (
  opts: { runId?: string; byokKey?: string; alwaysByok?: boolean; post?: ParsePost } = {},
): ParseClient => {
  const post = opts.post ?? makeDefaultParsePost(opts.runId, opts.byokKey, opts.alwaysByok)
  return {
    parse: (file: File) => post(file),
  }
}


/**
 * Resolve the parse service to a client, or `null` when unavailable — the signal
 * the upload UI uses to grey out. A BYOK Mistral key makes parsing available
 * even signed-out (relayed); signed-in prefers our key with the key as the
 * over-limit fallback.
 */
export const resolveParseClient = (opts: {
  signedIn: boolean
  runId?: string
  byokKey?: string | null
}): ParseClient | null => {
  const cred = opts.byokKey ? { provider: "mistral", apiKey: opts.byokKey } : undefined
  const resolution: ServiceResolution = resolveService("parse", {
    signedIn: opts.signedIn,
    preferManaged: opts.signedIn,
    byok: cred ? { parse: cred } : {},
  })
  if (resolution.mode === "off") return null
  return managedParseClient({
    runId: opts.runId,
    byokKey: opts.byokKey ?? undefined,
    alwaysByok: resolution.mode === "byok",
  })
}
