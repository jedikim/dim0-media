import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { setActiveShikiThemes } from "@/components/markdown/streamdown-code-plugin"
import {
  THEMES,
  THEME_SHIKI_MAP,
  type Mode,
  type ShikiThemePair,
  type ThemeId,
  type ThemeMeta,
} from "@/components/theme-constants"


const DEFAULT_THEME_ID: ThemeId = "matcha"

const DEFAULT_MODE: Mode = "system"

const STORAGE_KEY = "topix-ui-theme"

const VALID_THEME_IDS = new Set<ThemeId>(THEMES.map((t) => t.id))


type StoredPrefs = {
  themeId: ThemeId
  mode: Mode
}


/**
 * Reads stored prefs from localStorage, migrating the legacy `vite-ui-theme`
 * single-string format (mode-only) into the new `{ themeId, mode }` shape.
 */
const readStoredPrefs = (storageKey: string): StoredPrefs => {
  const fallback: StoredPrefs = { themeId: DEFAULT_THEME_ID, mode: DEFAULT_MODE }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      const legacy = localStorage.getItem("vite-ui-theme")
      if (legacy === "light" || legacy === "dark" || legacy === "system") {
        return { themeId: DEFAULT_THEME_ID, mode: legacy }
      }
      return fallback
    }
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>
    const themeId = parsed.themeId && VALID_THEME_IDS.has(parsed.themeId)
      ? parsed.themeId
      : DEFAULT_THEME_ID
    const mode = parsed.mode === "light" || parsed.mode === "dark" || parsed.mode === "system"
      ? parsed.mode
      : DEFAULT_MODE
    return { themeId, mode }
  } catch {
    return fallback
  }
}


const resolveMode = (mode: Mode): "light" | "dark" => {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  return mode
}


type ThemeProviderProps = {
  children: React.ReactNode
  defaultThemeId?: ThemeId
  defaultMode?: Mode
  storageKey?: string
}


type ThemeProviderState = {
  themeId: ThemeId
  mode: Mode
  /** Always concrete ("light" | "dark") — "system" is resolved against the media query. */
  resolvedTheme: "light" | "dark"
  /** Shiki theme pair `[light, dark]` matched to the current app theme. */
  shikiThemes: ShikiThemePair
  setThemeId: (id: ThemeId) => void
  setMode: (mode: Mode) => void
  themes: ThemeMeta[]
}


const initialState: ThemeProviderState = {
  themeId: DEFAULT_THEME_ID,
  mode: DEFAULT_MODE,
  resolvedTheme: "light",
  shikiThemes: THEME_SHIKI_MAP[DEFAULT_THEME_ID],
  setThemeId: () => null,
  setMode: () => null,
  themes: THEMES,
}


const ThemeProviderContext = createContext<ThemeProviderState>(initialState)


/**
 * Theme orchestrator. Persists `{ themeId, mode }` to localStorage, applies
 * `data-theme` and `data-mode` attributes to `<html>`, and resolves system
 * preference when `mode === "system"`. `resolvedTheme` stays mode-only so
 * downstream components branching on `resolvedTheme === 'dark'` keep working.
 */
export function ThemeProvider({
  children,
  defaultThemeId = DEFAULT_THEME_ID,
  defaultMode = DEFAULT_MODE,
  storageKey = STORAGE_KEY,
  ...props
}: ThemeProviderProps) {
  const [{ themeId, mode }, setPrefs] = useState<StoredPrefs>(() => {
    if (typeof window === "undefined") return { themeId: defaultThemeId, mode: defaultMode }
    return readStoredPrefs(storageKey)
  })
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light"
    return resolveMode(mode)
  })

  useEffect(() => {
    const root = window.document.documentElement
    const resolved = resolveMode(mode)
    root.dataset.theme = themeId
    root.dataset.mode = resolved
    setResolvedTheme(resolved)
    setActiveShikiThemes(THEME_SHIKI_MAP[themeId])
  }, [themeId, mode])

  useEffect(() => {
    if (mode !== "system") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      const next = mql.matches ? "dark" : "light"
      window.document.documentElement.dataset.mode = next
      setResolvedTheme(next)
    }
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [mode])

  const value = useMemo<ThemeProviderState>(() => {
    const persist = (next: StoredPrefs) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* localStorage may be unavailable (private mode, quota) — proceed without persistence */
      }
    }
    return {
      themeId,
      mode,
      resolvedTheme,
      shikiThemes: THEME_SHIKI_MAP[themeId],
      themes: THEMES,
      setThemeId: (id) => {
        setPrefs((prev) => {
          const next = { ...prev, themeId: id }
          persist(next)
          return next
        })
      },
      setMode: (m) => {
        setPrefs((prev) => {
          const next = { ...prev, mode: m }
          persist(next)
          return next
        })
      },
    }
  }, [themeId, mode, resolvedTheme, storageKey])

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}


// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
