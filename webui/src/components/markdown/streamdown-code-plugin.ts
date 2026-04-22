import { createHighlighter, type Highlighter, type BundledLanguage, type BundledTheme } from "shiki"
import type { CodeHighlighterPlugin, HighlightOptions } from "streamdown"


type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin["highlight"]>>


/**
 * Replacement for @streamdown/code that avoids the static `bundledLanguages`
 * import (which forces Rollup to include every Shiki grammar — ~10MB).
 * Grammars are fetched on demand via `loadLanguage()`, so each language
 * becomes its own async chunk.
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


export function createCodePlugin(
  themes: [BundledTheme, BundledTheme],
): CodeHighlighterPlugin {
  let hlPromise: Promise<Highlighter> | null = null
  const loadedLangs = new Set<string>(["plaintext"])
  const cache = new Map<string, HighlightResult>()
  const pending = new Map<string, Set<(r: HighlightResult) => void>>()

  function getHl(): Promise<Highlighter> {
    if (!hlPromise) {
      hlPromise = createHighlighter({ themes, langs: ["plaintext"] })
    }
    return hlPromise
  }

  function cacheKey(code: string, lang: string): string {
    const head = code.slice(0, 80)
    const tail = code.length > 80 ? code.slice(-80) : ""
    return `${lang}:${code.length}:${head}:${tail}`
  }

  return {
    name: "shiki",
    type: "code-highlighter",
    getThemes: () => themes,
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
      const k = cacheKey(code, safeLang)

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
          const hl = await getHl()
          if (!loadedLangs.has(safeLang)) {
            await hl.loadLanguage(safeLang as BundledLanguage)
            loadedLangs.add(safeLang)
          }
          const result = hl.codeToTokens(code, {
            lang: safeLang as BundledLanguage,
            themes: { light: reqThemes[0], dark: reqThemes[1] },
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
