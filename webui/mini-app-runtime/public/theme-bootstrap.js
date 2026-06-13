// Theme bootstrap — runs synchronously in <head> before any CSS paints
// or React mounts. Reads theme + mode from URL query params
// (`?theme=parchment&mode=dark`) and writes them to <html> dataset
// attributes so the shared src/index.css theme selectors apply
// immediately. Without this, the iframe would paint with the
// hardcoded `<html data-theme="parchment" data-mode="light">` default
// for a few frames before main.tsx's `mini-app:render` message lands
// with the host's actual palette — visible flash when the host is in
// a different theme.
//
// Externalized (not inline) because the production CSP from Caddy is
// `script-src 'self' 'unsafe-eval'` — no `'unsafe-inline'` allowance.
// An inline <script> would be blocked silently and the flash-prevention
// silently regresses to the default. Living in /public/ means vite
// copies this file verbatim to the build output, served from `/self`
// which the CSP allows.
(function () {
  try {
    var p = new URLSearchParams(location.search)
    var t = p.get("theme")
    var m = p.get("mode")
    if (t) document.documentElement.dataset.theme = t
    if (m === "light" || m === "dark") document.documentElement.dataset.mode = m
  } catch (_) {
    // No URL or bad params → fall back to the hardcoded defaults on
    // <html>. Not worth bailing out of the iframe over.
  }
})()
