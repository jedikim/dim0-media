import { test, expect } from "@playwright/test"


/**
 * Offline service-worker test. The SW is NOT active under `vite dev`, so this
 * needs a production build + preview:
 *
 *   npm run build && npm run preview   (point baseURL at the preview server)
 *
 * Skipped by default so the dev-server run stays green; un-skip in a CI job
 * that builds first.
 */
test.describe("offline (service worker)", () => {
  test.skip(true, "needs prod build + preview — SW is inactive under vite dev")

  test("app boots offline after first visit", async ({ page, context }) => {
    await page.goto("/local") // first visit: SW precaches the shell
    await page.waitForTimeout(1000)

    await context.setOffline(true)
    await page.goto("/local") // navigateFallback serves the shell offline
    await expect(page.getByRole("heading", { name: "Local boards" })).toBeVisible()
  })
})
