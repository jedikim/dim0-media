import { createHighlighter, type Highlighter, type BundledLanguage, type BundledTheme } from "shiki"
import type { CodeHighlighterPlugin, HighlightOptions } from "streamdown"


type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin["highlight"]>>

type ThemePair = readonly [BundledTheme, BundledTheme]


/**
 * Replacement for @streamdown/code that avoids the static `bundledLanguages`
 * import (which forces Rollup to include every Shiki grammar — ~10MB).
 * Grammars are fetched on demand via `loadLanguage()`, so each language
 * becomes its own async chunk. Themes are also loaded lazily, so switching
 * the app theme only fetches the new pair the first time.
 */

const SUPPORTED: BundledLanguage[] = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "html",
  "css",
  "scss",
  "json",
  "yaml",
  "toml",
  "markdown",
  "bash",
  "sql",
  "graphql",
  "diff",
]


/**
 * Creates a Streamdown-compatible code-highlighter plugin. `getThemes` is
 * called on every highlight request, so the plugin instance stays stable
 * across theme switches while still picking up the active theme pair.
 */
export function createCodePlugin(
  getThemes: () => ThemePair,
): CodeHighlighterPlugin {
  let hlPromise: Promise<Highlighter> | null = null
  const loadedLangs = new Set<string>(["plaintext"])
  const loadedThemes = new Set<string>()
  const loadingThemes = new Map<string, Promise<void>>()
  const cache = new Map<string, HighlightResult>()
  const pending = new Map<string, Set<(r: HighlightResult) => void>>()

  function getHl(seed: ThemePair): Promise<Highlighter> {
    if (!hlPromise) {
      hlPromise = createHighlighter({
        themes: Array.from(new Set(seed)),
        langs: ["plaintext"],
      }).then((hl) => {
        for (const t of seed) loadedThemes.add(t)
        return hl
      })
    }
    return hlPromise
  }

  async function ensureThemes(hl: Highlighter, themes: ThemePair) {
    for (const t of themes) {
      if (loadedThemes.has(t)) continue
      let p = loadingThemes.get(t)
      if (!p) {
        p = hl.loadTheme(t).then(() => {
          loadedThemes.add(t)
          loadingThemes.delete(t)
        })
        loadingThemes.set(t, p)
      }
      await p
    }
  }

  function cacheKey(code: string, lang: string, themes: ThemePair): string {
    const head = code.slice(0, 80)
    const tail = code.length > 80 ? code.slice(-80) : ""
    return `${themes[0]}:${themes[1]}:${lang}:${code.length}:${head}:${tail}`
  }

  return {
    name: "shiki",
    type: "code-highlighter",
    getThemes: () => [...getThemes()] as [BundledTheme, BundledTheme],
    getSupportedLanguages: () => SUPPORTED,
    supportsLanguage: (lang) =>
      (SUPPORTED as readonly string[]).includes(lang as string) ||
      (lang as string) === "plaintext",
    highlight(
      { code, language, themes: reqThemes }: HighlightOptions,
      callback,
    ): HighlightResult | null {
      const safeLang = (SUPPORTED as readonly string[]).includes(language)
        ? language
        : "plaintext"
      const themePair = reqThemes as ThemePair
      const k = cacheKey(code, safeLang, themePair)

      const cached = cache.get(k)
      if (cached) return cached

      if (callback) {
        let cbs = pending.get(k)
        if (!cbs) {
          cbs = new Set()
          pending.set(k, cbs)
        }
        cbs.add(callback)
      }

      void (async () => {
        try {
          const hl = await getHl(themePair)
          await ensureThemes(hl, themePair)
          if (!loadedLangs.has(safeLang)) {
            await hl.loadLanguage(safeLang as BundledLanguage)
            loadedLangs.add(safeLang)
          }
          const result = hl.codeToTokens(code, {
            lang: safeLang as BundledLanguage,
            themes: { light: themePair[0], dark: themePair[1] },
          }) as unknown as HighlightResult
          cache.set(k, result)
          const cbs = pending.get(k)
          if (cbs) {
            for (const f of cbs) f(result)
            pending.delete(k)
          }
        } catch (err) {
          console.error("[code-plugin] highlight failed:", err)
          pending.delete(k)
        }
      })()

      return null
    },
  }
}


/**
 * Singleton plugin shared across every `MarkdownView`. Each `createCodePlugin`
 * call allocates its own Shiki highlighter + WASM grammar registry, so per-
 * mount instantiation would multiply WASM workers by message count. Theme
 * switching is handled by the mutable `_activeThemes` cell below — the
 * plugin's `getThemes` reads it on every highlight request.
 */
let _activeThemes: ThemePair = ["rose-pine-dawn", "rose-pine"]

export function setActiveShikiThemes(themes: ThemePair): void {
  _activeThemes = themes
}

export const codePlugin: CodeHighlighterPlugin = createCodePlugin(() => _activeThemes)
