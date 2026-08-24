import { expect, test, type Page, type Route } from "@playwright/test"


const API_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "private, no-store",
}


const metrics = {
  attempt_count: 2,
  priced_attempt_count: 1,
  cost_unreported_attempt_count: 1,
  known_cost_usd: "0.0500000000",
  usage: {
    input_units: 5,
    output_units: 7,
    total_units: 12,
    generated_images: 1,
  },
}


const users = {
  alice: { uid: "alice-user-uid", username: "alice", name: "Alice" },
  bob: { uid: "bob-user-uid", username: "bob", name: null },
}


const summary = {
  overall: {
    ...metrics,
    generation_count: 2,
    succeeded_count: 2,
    failed_count: 0,
    active_count: 0,
  },
  users: Object.values(users).map((user) => ({
    user,
    ...metrics,
    attempt_count: 1,
    generation_count: 1,
    succeeded_count: 1,
    failed_count: 0,
    active_count: 0,
  })),
}


const historyItem = (generationUid: string, user: typeof users.alice, prompt: string) => ({
  generation_uid: generationUid,
  user,
  board: { uid: `${user.username}-private-board`, name: `${user.username} private`, deleted: false },
  provider: "openrouter",
  model_id: "x-ai/grok-imagine-image-2.0",
  prompt,
  parameters: { aspect_ratio: "1:1", resolution: "1K", quality: "low", output_count: 1 },
  status: "succeeded",
  started_at: "2026-08-23T01:00:00Z",
  completed_at: "2026-08-23T01:00:01Z",
  error_code: null,
  error_message: null,
  output: {
    asset_uid: `${user.username}-output`,
    mime_type: "image/png",
    width: 1,
    height: 1,
    content_url: `/image-history/${generationUid}/assets/${user.username}-output/content`,
  },
  references: [0, 1].map((ordinal) => ({
    ordinal,
    asset_uid: `${user.username}-reference`,
    mime_type: "image/png",
    width: 1,
    height: 1,
    content_url: `/image-history/${generationUid}/assets/${user.username}-reference/content`,
  })),
  ...metrics,
})


const first = historyItem("a".repeat(32), users.alice, "Alice complete private prompt")
const second = historyItem("b".repeat(32), users.bob, "Bob complete private prompt")
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrGQAAAAASUVORK5CYII=", "base64")


/** Fulfill one JSON API response with browser-safe CORS headers. */
async function fulfillJson(route: Route, body: object): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: API_CORS_HEADERS,
    body: JSON.stringify(body),
  })
}


/** Seed a syntactically valid future-dated app token without any real credential. */
async function seedTestToken(page: Page): Promise<void> {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url")
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "history-viewer", email: "viewer@example.test", exp: 4_102_444_800 })}.test`
  await page.addInitScript((accessToken) => localStorage.setItem("access_token", accessToken), token)
}


test("authenticated global history shows two creators, thumbnails, filters, and explicit pagination read-only", async ({ page }) => {
  test.setTimeout(60_000)
  await seedTestToken(page)
  await page.setViewportSize({ width: 1440, height: 2400 })
  const historyRequests: URL[] = []
  const mutations: string[] = []
  const providerRequests: string[] = []

  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() !== "GET" && url.pathname !== "/@vite/client") mutations.push(`${request.method()} ${url.pathname}`)
    if (/openrouter|grok-imagine|chat\/completions|\/api\/v1\/images/i.test(request.url())) providerRequests.push(request.url())
  })

  await page.route("**/users/email-verification-status", (route) => fulfillJson(route, {
    data: { enabled: false, verified: true },
  }))
  await page.route("**/billing/public-config", (route) => fulfillJson(route, {
    status: "success",
    data: { billing_enabled: false },
  }))
  await page.route(/\/boards(?:\?.*)?$/, (route) => fulfillJson(route, { data: { graphs: [] } }))
  await page.route(/\/chats(?:\?.*)?$/, (route) => fulfillJson(route, { data: { chats: [] } }))
  await page.route("**/utils/ping", (route) => route.fulfill({ status: 204, headers: API_CORS_HEADERS }))
  await page.route("**/image-history/summary", (route) => fulfillJson(route, summary))
  await page.route("**/image-history/*/assets/*/content", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    headers: { ...API_CORS_HEADERS, "x-content-type-options": "nosniff" },
    body: png,
  }))
  await page.route("**/image-history?*", async (route) => {
    const url = new URL(route.request().url())
    historyRequests.push(url)
    const userUid = url.searchParams.get("user_uid")
    const cursor = url.searchParams.get("cursor")
    if (userUid === users.bob.uid) {
      await fulfillJson(route, { items: [second], next_cursor: null })
      return
    }
    if (cursor === "next-page") {
      await fulfillJson(route, { items: [second], next_cursor: null })
      return
    }
    await fulfillJson(route, { items: [first], next_cursor: "next-page" })
  })

  await page.goto("/image-history")
  await expect(page.getByRole("heading", { name: "AI image history" })).toBeVisible()
  await expect(page.getByText("Alice · @alice", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("@bob", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Alice complete private prompt", { exact: true }).first()).toBeVisible()

  await expect(page.getByRole("img", { name: "Generated result" })).toBeVisible()
  await expect(page.getByRole("img", { name: /Reference image/ })).toHaveCount(2)

  await page.getByRole("button", { name: "Load more" }).click()
  await expect(page.getByText("Bob complete private prompt", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0)

  await page.getByLabel("User filter").selectOption(users.bob.uid)
  await expect.poll(() => historyRequests.some((url) => url.searchParams.get("user_uid") === users.bob.uid)).toBe(true)
  await page.getByLabel("Status filter").selectOption("succeeded")
  await expect.poll(() => historyRequests.some((url) => url.searchParams.get("status") === "succeeded")).toBe(true)

  expect(historyRequests[0].searchParams.get("limit")).toBe("25")
  expect(historyRequests.some((url) => url.searchParams.get("cursor") === "next-page")).toBe(true)
  expect(mutations).toEqual([])
  expect(providerRequests).toEqual([])
})
