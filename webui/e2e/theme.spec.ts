import { test, expect } from "@playwright/test"


/** Sample one canvas pixel (empty board area) + the resolved --background. */
const sample = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const de = document.documentElement
    const cssBg = getComputedStyle(de).getPropertyValue("--background").trim()
    const c = document.querySelector("canvas") as HTMLCanvasElement
    const off = document.createElement("canvas")
    off.width = 1
    off.height = 1
    const ctx = off.getContext("2d")!
    ctx.drawImage(c, 8, 240, 1, 1, 0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return { theme: de.dataset.theme, cssBg, sampled: `${r},${g},${b}` }
  })


// Regression: the canvas background must follow a live theme change. The theme
// provider applies the theme by writing `data-theme` on <html> in an effect
// (a themeId-only switch triggers no follow-up React render), so the board's
// theme memo has to react to that attribute landing — otherwise the canvas
// stays painted in the previous theme (noir looked like parchment on local
// boards, which are quiet enough that no incidental re-render masked it).
test("canvas background follows a live data-theme change (local board)", async ({ page }) => {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, JSON.stringify({ themeId: "parchment", mode: "dark" })),
    ["topix-ui-theme"],
  )
  await page.goto("/local")
  await page.getByRole("list", { name: "On this device" }).getByText("New Board").click()
  await page.waitForURL(/\/local\/.+/)
  await page.waitForTimeout(2000)

  const before = await sample(page)
  expect(before.sampled).toBe("34,33,33") // parchment dark #222121

  // Flip only the attribute — exactly what a themeId switch does after render.
  await page.evaluate(() => { document.documentElement.dataset.theme = "noir" })
  await page.waitForTimeout(1200)

  const after = await sample(page)
  expect(after.sampled).not.toBe(before.sampled)
  expect(after.sampled).toBe("32,34,36") // noir dark #202224
})
