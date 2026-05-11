import type { BundledTheme } from "shiki"


export type ThemeId = "parchment" | "catppuccin" | "tokyo-night" | "gruvbox" | "monokai-pro" | "rose-pine"


export type ShikiThemePair = readonly [BundledTheme, BundledTheme]


/**
 * Maps each app theme to a Shiki theme pair `[light, dark]` for syntax
 * highlighting. Picks are best-effort matches — Shiki doesn't bundle every
 * theme's light variant, so a few entries borrow a stylistically-similar
 * theme (Tokyo Night → github-light; Monokai Pro → vitesse-light / monokai).
 */
export const THEME_SHIKI_MAP: Record<ThemeId, ShikiThemePair> = {
  parchment:     ["rose-pine-dawn",       "rose-pine"],
  catppuccin:    ["catppuccin-latte",     "catppuccin-mocha"],
  "tokyo-night": ["github-light",         "tokyo-night"],
  gruvbox:       ["gruvbox-light-medium", "gruvbox-dark-medium"],
  "monokai-pro": ["vitesse-light",        "monokai"],
  "rose-pine":   ["rose-pine-dawn",       "rose-pine"],
}


export type Mode = "light" | "dark" | "system"


export type ThemeMeta = {
  id: ThemeId
  label: string
  /** Swatch trio shown in the picker: [background, primary, accent]. */
  swatchLight: [string, string, string]
  swatchDark: [string, string, string]
}


export const THEMES: ThemeMeta[] = [
  {
    id: "parchment",
    label: "Parchment",
    swatchLight: ["#f7f1e4", "#33312c", "#e4c9a8"],
    swatchDark:  ["#26221e", "#d49a78", "#3a2e26"],
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    swatchLight: ["#eff1f5", "#8839ef", "#ccd0da"],
    swatchDark:  ["#1e1e2e", "#cba6f7", "#313244"],
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    swatchLight: ["#e1e2e7", "#2e7de9", "#cbcdd5"],
    swatchDark:  ["#1a1b26", "#7aa2f7", "#292e42"],
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    swatchLight: ["#fbf1c7", "#d65d0e", "#d5c4a1"],
    swatchDark:  ["#282828", "#fe8019", "#504945"],
  },
  {
    id: "monokai-pro",
    label: "Monokai Pro",
    swatchLight: ["#faf4f2", "#cc486f", "#f0e8e3"],
    swatchDark:  ["#282a3a", "#ff657a", "#363a4d"],
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    swatchLight: ["#faf4ed", "#b4637a", "#dfdad9"],
    swatchDark:  ["#191724", "#eb6f92", "#26233a"],
  },
]
