type WidgetThemeTokenName =
  | "--background"
  | "--foreground"
  | "--card"
  | "--card-foreground"
  | "--muted"
  | "--muted-foreground"
  | "--primary"
  | "--primary-foreground"
  | "--secondary"
  | "--secondary-foreground"
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
  "--secondary",
  "--secondary-foreground",
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
  "--secondary": "#e4e4e7",
  "--secondary-foreground": "#18181b",
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
    :root {
      ${renderThemeTokenBlock(DEFAULT_WIDGET_TOKENS)}
      color-scheme: light dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
    return html
  }

  const bodyMarkup = extractBodyMarkup(html)
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
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    ${WIDGET_BASE_STYLE.replace(
      renderThemeTokenBlock(DEFAULT_WIDGET_TOKENS),
      tokenStyle
    )}
  </head>
  <body>
    ${bodyMarkup}
    ${resizeScript}
  </body>
</html>`
}
