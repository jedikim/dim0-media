import { afterEach, describe, expect, it, vi } from "vitest"


// The managed factories' DEFAULT transports route through the shared services
// transport (→ fetchWithAuthRaw). Mock it so we can assert the per-run X-Run-Id
// header is attached (metering) across every client + the streaming path.
const fetchWithAuthRaw = vi.hoisted(() => vi.fn())
vi.mock("@/api", () => ({ fetchWithAuthRaw }))

import { managedLlmClient } from "./managed-client"
import { managedSearchClient } from "./web-search"
import { managedCodeClient } from "./code-interpreter"
import { managedFetchClient } from "./fetch-url"
import type { LlmMessage } from "./types"


const jsonResponse = <T,>(data: T): Response =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as unknown as Response


// Run-id header on the last transport call (all clients send a Headers object).
const lastRunIdHeader = (): string | null => {
  const init = fetchWithAuthRaw.mock.calls.at(-1)?.[1] as { headers: Headers } | undefined
  return init ? init.headers.get("X-Run-Id") : null
}


afterEach(() => vi.clearAllMocks())


describe("managed default transports attach X-Run-Id", () => {
  it("LLM /ai/llm sends the run id", async () => {
    fetchWithAuthRaw.mockResolvedValue(
      jsonResponse({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    )
    const messages: LlmMessage[] = [{ role: "user", content: "hi" }]
    await managedLlmClient("auto", { runId: "run-42" }).complete(messages, [])
    expect(lastRunIdHeader()).toBe("run-42")
  })

  it("search /ai/search sends the run id", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ answer: "", results: [] }))
    await managedSearchClient({ runId: "run-42" }).search("cats")
    expect(lastRunIdHeader()).toBe("run-42")
  })

  it("code /ai/code sends the run id", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ status: "success", stdout: "", stderr: "", duration_ms: 1 }))
    await managedCodeClient({ runId: "run-42" }).run("1+1", "python")
    expect(lastRunIdHeader()).toBe("run-42")
  })

  it("fetch /ai/fetch sends the run id", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ url: "https://a.com", title: null, text: "" }))
    await managedFetchClient({ runId: "run-42" }).fetch("https://a.com")
    expect(lastRunIdHeader()).toBe("run-42")
  })

  it("omits the run-id header entirely when no run id is given", async () => {
    fetchWithAuthRaw.mockResolvedValue(jsonResponse({ answer: "", results: [] }))
    await managedSearchClient({}).search("q")
    expect(lastRunIdHeader()).toBeNull()
  })

  it("streaming /ai/llm/stream sets the run id + JSON content-type", async () => {
    const ndjson = JSON.stringify({ type: "final", message: { role: "assistant", content: "done", refusal: null } }) + "\n"
    fetchWithAuthRaw.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(ndjson))
          c.close()
        },
      }),
    } as unknown as Response)

    const messages: LlmMessage[] = [{ role: "user", content: "hi" }]
    for await (const _ev of managedLlmClient("auto", { runId: "run-99" }).completeStream!(messages, [])) void _ev

    const init = fetchWithAuthRaw.mock.calls.at(-1)?.[1] as { headers: Headers }
    expect(init.headers.get("X-Run-Id")).toBe("run-99")
    expect(init.headers.get("Content-Type")).toBe("application/json")
  })
})
