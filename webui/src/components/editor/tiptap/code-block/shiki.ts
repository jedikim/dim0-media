import { createHighlighter, type Highlighter, type BundledTheme } from "shiki"


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

type ThemePair = readonly [BundledTheme, BundledTheme]


let _hlPromise: Promise<Highlighter> | null = null
let _hl: Highlighter | null = null
const _loadedLangs = new Set<string>(["plaintext"])
const _loadedThemes = new Set<string>()
const _loadingLangs = new Map<string, Promise<void>>()
const _loadingThemes = new Map<string, Promise<void>>()


/**
 * Lazily creates the singleton Shiki highlighter, seeding it with the first
 * theme pair requested. Subsequent themes are added via `loadTheme()`.
 */
function getHighlighter(seed: ThemePair): Promise<Highlighter> {
  if (!_hlPromise) {
    _hlPromise = createHighlighter({
      themes: Array.from(new Set(seed)),
      langs: ["plaintext"],
    }).then((hl) => {
      _hl = hl
      for (const t of seed) _loadedThemes.add(t)
      return hl
    })
  }
  return _hlPromise
}


function safeLang(lang: string): LangValue {
  return LANGUAGE_OPTIONS.some((o) => o.value === lang) ? (lang as LangValue) : "plaintext"
}


function bothLoaded(themes: ThemePair, lang: LangValue): boolean {
  return _loadedThemes.has(themes[0]) && _loadedThemes.has(themes[1]) && _loadedLangs.has(lang)
}


/**
 * Synchronously highlight `code` against `themes` if both the grammar and the
 * theme pair are already loaded. Returns null when anything is missing — the
 * caller should fall back to plain text and call `ensureLanguage()` to trigger
 * async loading + a ready callback.
 */
export function highlightCodeSync(
  code: string,
  lang: string,
  themes: ThemePair,
): string | null {
  if (!_hl) return null
  const sl = safeLang(lang)
  if (!bothLoaded(themes, sl)) return null
  return _hl.codeToHtml(code, {
    lang: sl,
    themes: { light: themes[0], dark: themes[1] },
    defaultColor: false,
  })
}


/**
 * Ensure the highlighter, the requested language, and the requested theme pair
 * are all loaded. Calls `onReady` once everything is available (immediately if
 * already loaded, otherwise after the async work finishes).
 */
export function ensureLanguage(
  lang: string,
  themes: ThemePair,
  onReady: () => void,
): void {
  const sl = safeLang(lang)
  if (_hl && bothLoaded(themes, sl)) {
    onReady()
    return
  }

  const run = async () => {
    const hl = await getHighlighter(themes)

    for (const t of themes) {
      if (_loadedThemes.has(t)) continue
      let pending = _loadingThemes.get(t)
      if (!pending) {
        pending = hl.loadTheme(t).then(() => {
          _loadedThemes.add(t)
          _loadingThemes.delete(t)
        })
        _loadingThemes.set(t, pending)
      }
      await pending
    }

    if (!_loadedLangs.has(sl)) {
      let pending = _loadingLangs.get(sl)
      if (!pending) {
        pending = hl.loadLanguage(sl).then(() => {
          _loadedLangs.add(sl)
          _loadingLangs.delete(sl)
        })
        _loadingLangs.set(sl, pending)
      }
      await pending
    }

    onReady()
  }
  void run()
}
