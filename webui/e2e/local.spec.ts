import { test, expect } from "@playwright/test"
import type { Page, Route } from "@playwright/test"


// --- Mocked OpenAI-compatible provider (BYOK) ---------------------------------
// The client agent streams turns via the OpenAI SDK (Server-Sent Events), so the
// mock must answer `stream: true` requests with SSE chunks — a plain JSON body
// would be silently dropped by the stream parser. Turn 1 streams a write_note
// tool call; the follow-up turn streams the final answer. The non-streaming call
// is the board auto-label.

const sse = (chunks: object[]): string =>
  chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n"


const chunk = (delta: object, finish: string | null = null) => ({
  id: "x", object: "chat.completion.chunk", created: 0, model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
})


const toolCallStream = (): string => sse([
  chunk({
    role: "assistant", content: null,
    tool_calls: [{
      index: 0, id: "c1", type: "function",
      function: { name: "write_note", arguments: JSON.stringify({ content: "a note body", label: "From agent" }) },
    }],
  }),
  chunk({}, "tool_calls"),
])


const textStream = (text: string): string => sse([chunk({ role: "assistant", content: text }), chunk({}, "stop")])


const jsonCompletion = (text: string): string => JSON.stringify({
  id: "x", object: "chat.completion", created: 0, model: "m",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
})


// The unified dashboard groups boards under "On this device" (a labelled list);
// the create tile is a "New Board" card inside it. Scope to the list so we never
// collide with the sidebar's own "New Board" entries.
const deviceGroup = (page: Page) => page.getByRole("list", { name: "On this device" })


/** Create a local board from the dashboard and land on it. */
const createLocalBoard = async (page: Page): Promise<void> => {
  await deviceGroup(page).getByText("New Board").click()
  await expect(page).toHaveURL(/\/local\/.+/)
}


test.describe("local-only boards (no account, frontend-only)", () => {
  test("create a board with no account; it persists across reload", async ({ page }) => {
    await page.goto("/local")
    await expect(page.getByRole("heading", { name: "On this device" })).toBeVisible()

    await createLocalBoard(page)

    await page.goto("/local")
    await expect(deviceGroup(page).getByText("Untitled board")).toBeVisible()

    await page.reload()
    await expect(deviceGroup(page).getByText("Untitled board")).toBeVisible() // survived (IndexedDB)
  })


  test("a local session never calls the board/chat backend", async ({ page }) => {
    const backendHits: string[] = []
    page.on("request", (req) => {
      const { host, pathname } = new URL(req.url())
      const isLocal = host.startsWith("localhost") || host.startsWith("127.")
      if (!isLocal && /\/(chats|boards|messages|sync|graphs)\b/.test(pathname)) {
        backendHits.push(req.url())
      }
    })

    await page.goto("/local")
    await createLocalBoard(page)
    await page.waitForTimeout(800)

    expect(backendHits).toEqual([])
  })


  test("agent builds a note via a mocked provider (BYOK)", async ({ page }) => {
    let toolCallEmitted = false
    let toolResultSent = false
    await page.route("**/chat/completions", async (route: Route) => {
      const body = route.request().postDataJSON()
      const isStream = body?.stream === true
      const nTools = Array.isArray(body?.tools) ? body.tools.length : 0
      // The follow-up turn carries the executed tool's result back to the model.
      const msgs = (body?.messages ?? []) as { role?: string }[]
      if (msgs.some((m) => m.role === "tool")) toolResultSent = true

      if (isStream && nTools > 0 && !toolCallEmitted) {
        toolCallEmitted = true
        await route.fulfill({ status: 200, contentType: "text/event-stream", body: toolCallStream() })
      } else if (isStream) {
        await route.fulfill({ status: 200, contentType: "text/event-stream", body: textStream("Note created.") })
      } else {
        // Non-streaming call — the board auto-label. Keep it innocuous.
        await route.fulfill({ status: 200, contentType: "application/json", body: jsonCompletion("Board") })
      }
    })

    await page.goto("/local")
    await createLocalBoard(page)

    // No model key yet → island is grayed; open the Settings dialog from the key
    // icon, go to Model providers, set a key, save, then close the dialog.
    await page.getByRole("button", { name: "Agent settings" }).click()
    await page.getByRole("button", { name: "Model providers" }).click()
    await page.getByPlaceholder(/sk-/).fill("sk-test-123")
    await page.getByRole("button", { name: "Save" }).click()
    await page.keyboard.press("Escape")

    // Island ungrays → ask the agent (the floating island submits on Enter).
    await page.getByPlaceholder(/Ask about this board/).fill("create a note")
    await page.getByPlaceholder(/Ask about this board/).press("Enter")

    // The agent streamed a tool call, ran write_note in the real browser, fed the
    // result back, and streamed its final answer — proven end to end.
    await expect(page.getByText("Note created.")).toBeVisible()
    expect(toolResultSent).toBe(true)
  })
})
