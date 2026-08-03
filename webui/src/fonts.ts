/**
 * Self-hosted web fonts, bundled via `@fontsource` — replaces the Google Fonts
 * CDN `@import` that used to sit at the top of `index.css`. The main app now
 * carries no third-party font dependency: it renders correctly fully offline
 * (the point of the desktop build), with no cold network fetch and no IP leak
 * to Google on launch. (The sandboxed HTML-widget iframe in
 * `board/components/flow/widget-document.ts` still uses the CDN — separate
 * document, tracked separately.)
 *
 * IMPORTANT: use the STATIC `@fontsource/*` packages, not `@fontsource-variable/*`.
 * The variable packages register families with a ` Variable` suffix
 * (`"Lora Variable"`), but every reference — `index.css` `--font-*`,
 * `canvas-lite-markdown.tsx`, and canvas-harness's internal `FONT_FAMILY_MAP`
 * (which we can't change) — uses the plain names. Static packages register the
 * plain family name, so the bundled faces actually match.
 *
 * The board canvas (canvas-harness) paints text with these families. In WebKit
 * (Safari and the Tauri WKWebView) drawing to a `<canvas>` does NOT trigger a
 * web font to load — only DOM usage does — so a canvas-only font silently falls
 * back to `cursive` (macOS Snell Roundhand) until something forces the load.
 * `preloadCanvasFonts` forces it; the harness repaints on the resulting
 * `document.fonts` `loadingdone`.
 */

// sans — Atkinson Hyperlegible Next
import "@fontsource/atkinson-hyperlegible-next/400.css"
import "@fontsource/atkinson-hyperlegible-next/500.css"
import "@fontsource/atkinson-hyperlegible-next/600.css"
import "@fontsource/atkinson-hyperlegible-next/700.css"
import "@fontsource/atkinson-hyperlegible-next/400-italic.css"
import "@fontsource/atkinson-hyperlegible-next/700-italic.css"
// serif — Lora
import "@fontsource/lora/400.css"
import "@fontsource/lora/500.css"
import "@fontsource/lora/600.css"
import "@fontsource/lora/700.css"
import "@fontsource/lora/400-italic.css"
import "@fontsource/lora/700-italic.css"
// mono — Inconsolata
import "@fontsource/inconsolata/400.css"
import "@fontsource/inconsolata/700.css"
// handwriting — Architects Daughter (single 400)
import "@fontsource/architects-daughter/400.css"
// informal — Shantell Sans
import "@fontsource/shantell-sans/400.css"
import "@fontsource/shantell-sans/700.css"
import "@fontsource/shantell-sans/400-italic.css"
import "@fontsource/shantell-sans/700-italic.css"


/** Families canvas-harness paints on the board (its `FONT_FAMILY_MAP`). */
const CANVAS_FONT_FAMILIES = [
  "Architects Daughter",
  "Atkinson Hyperlegible Next",
  "Lora",
  "Inconsolata",
  "Shantell Sans",
] as const


/**
 * Force WebKit to actually download the canvas fonts. Canvas draws don't request
 * web fonts in WebKit, so without this the board keeps the `cursive` fallback
 * (the dark-vs-light discrepancy was really "which mode painted before the font
 * arrived"). Fire-and-forget — the harness repaints when `loadingdone` fires.
 */
export function preloadCanvasFonts(): void {
  if (typeof document === "undefined" || !("fonts" in document)) return
  for (const family of CANVAS_FONT_FAMILIES) {
    // normal + bold so styled nodes don't fall back either (a family without a
    // matching face simply resolves to nothing — harmless)
    document.fonts.load(`400 16px "${family}"`).catch(() => {})
    document.fonts.load(`700 16px "${family}"`).catch(() => {})
  }
}
