/**
 * Services transport — the single seam through which every managed `/ai/*` call
 * (search / code / fetch / llm / …) reaches the relay.
 *
 * Today the relay is the cloud backend (`API_URL`). This module is the ONE place
 * that owns "where the relay lives", so a future standalone/desktop build can
 * bundle the same backend locally and point every service at it with a single
 * `setServicesBaseUrl(...)` call — no per-client change. All requests go through
 * `fetchWithAuthRaw`, so auth (bearer + 401 refresh) is identical to the rest of
 * the app; only the base URL is swappable here.
 */
import { API_URL } from "@/config/api"
import { fetchWithAuthRaw } from "@/api"
import { handleStreamingResponse } from "../../utils/stream/digest"


let baseUrl: string = API_URL


/**
 * Point the `/ai/*` services at a different backend (e.g. a bundled local
 * backend on desktop). Call once at bootstrap; defaults to the cloud `API_URL`.
 */
export const setServicesBaseUrl = (url: string): void => {
  baseUrl = url
}


/** The base URL the services currently resolve against. */
export const getServicesBaseUrl = (): string => baseUrl


const buildUrl = (path: string): string => new URL(path, baseUrl).toString()


const jsonHeaders = (extra?: Record<string, string>): Headers =>
  new Headers({ "Content-Type": "application/json", ...(extra ?? {}) })


/**
 * Build the error for a non-2xx service reply. Keeps the status as a standalone
 * token so `isOverQuotaError`'s `\b429\b` match keeps working (it drives the
 * over-quota → BYOK fallback), and folds in the server's body (best-effort) so
 * a real error message survives to the agent's error toast.
 */
const failed = async (path: string, res: Response): Promise<Error> => {
  const body = await res.text().catch(() => "")
  return new Error(`${path} failed: ${res.status}${body ? ` - ${body}` : ""}`)
}


/**
 * POST a JSON body to a service endpoint and return the `{ data }` envelope's
 * payload (the shape `with_standard_response` wraps every `/ai/*` reply in).
 */
export async function servicesPost<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetchWithAuthRaw(buildUrl(path), {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await failed(path, res)
  const json = (await res.json()) as { data: T }
  return json.data
}


/**
 * POST a multipart form (file upload) to a service endpoint and return the
 * `{ data }` envelope's payload. Unlike `servicesPost` it does NOT set
 * Content-Type — the browser must set the multipart boundary itself.
 */
export async function servicesUpload<T>(
  path: string,
  form: FormData,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetchWithAuthRaw(buildUrl(path), {
    method: "POST",
    headers: new Headers(headers ?? {}),
    body: form,
  })
  if (!res.ok) throw await failed(path, res)
  const json = (await res.json()) as { data: T }
  return json.data
}


/**
 * POST a JSON body and stream the NDJSON response as typed lines (the `/ai/llm/
 * stream` shape). Not wrapped in a `{ data }` envelope — each line is a frame.
 */
export async function* servicesStream<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): AsyncGenerator<T> {
  const res = await fetchWithAuthRaw(buildUrl(path), {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await failed(path, res)
  yield* handleStreamingResponse<T>(res)
}
