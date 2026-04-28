import { createHighlighter, type Highlighter } from "shiki"

export const LANGUAGE_OPTIONS = [
  { value: "plaintext", label: "Plain text" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "tsx", label: "TSX" },
  { value: "jsx", label: "JSX" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "toml", label: "TOML" },
  { value: "markdown", label: "Markdown" },
  { value: "bash", label: "Bash" },
  { value: "sql", label: "SQL" },
  { value: "graphql", label: "GraphQL" },
  { value: "diff", label: "Diff" },
] as const

export type LangValue = (typeof LANGUAGE_OPTIONS)[number]["value"]

let _promise: Promise<Highlighter> | null = null
let _hl: Highlighter | null = null
const _loadedLangs = new Set<string>(["plaintext"])
const _loadingLangs = new Map<string, Promise<void>>()

function getHighlighter(): Promise<Highlighter> {
  if (!_promise) {
    // Start minimal: grammars are fetched on demand via loadLanguage() so each
    // language becomes its own async chunk instead of bundling all 23 upfront.
    _promise = createHighlighter({
      themes: ["rose-pine", "rose-pine-dawn"],
      langs: ["plaintext"],
    }).then((hl) => {
      _hl = hl
      return hl
    })
  }
  return _promise
}


function safeLang(lang: string): LangValue {
  return LANGUAGE_OPTIONS.some((o) => o.value === lang) ? (lang as LangValue) : "plaintext"
}


/**
 * Synchronously highlight `code` if the requested language is already loaded.
 * Returns null when the highlighter or the language grammar isn't ready yet —
 * the caller should fall back to plain text and call `ensureLanguage()` to
 * trigger async loading + a ready callback.
 */
export function highlightCodeSync(code: string, lang: string): string | null {
  if (!_hl) return null
  const sl = safeLang(lang)
  if (!_loadedLangs.has(sl)) return null
  return _hl.codeToHtml(code, {
    lang: sl,
    themes: { light: "rose-pine-dawn", dark: "rose-pine" },
    defaultColor: false,
  })
}


/**
 * Ensure the highlighter and the requested language are loaded. Calls `onReady`
 * once both are available (immediately if already loaded, otherwise after the
 * async work finishes).
 */
export function ensureLanguage(lang: string, onReady: () => void): void {
  const sl = safeLang(lang)
  if (_hl && _loadedLangs.has(sl)) {
    onReady()
    return
  }

  const run = async () => {
    const hl = await getHighlighter()
    if (_loadedLangs.has(sl)) {
      onReady()
      return
    }
    let pending = _loadingLangs.get(sl)
    if (!pending) {
      pending = hl.loadLanguage(sl).then(() => {
        _loadedLangs.add(sl)
        _loadingLangs.delete(sl)
      })
      _loadingLangs.set(sl, pending)
    }
    await pending
    onReady()
  }
  void run()
}
