import type { Mode } from "./tokens"


/**
 * Module-level current theme mode. Set by `useBoardTheme` on every
 * render; read by the convert layer (note-to-node / link-to-edge) and
 * any helper that needs to know whether to project stored colors to
 * dark-mode display values.
 *
 * Lives outside React state so synchronous code paths (mindmap drain,
 * AI tool-output apply, file drop, etc.) can pick it up without prop-
 * drilling. The render hook is the only writer.
 */
let _themeMode: Mode = "light"


export const setBoardThemeMode = (mode: Mode): void => {
  _themeMode = mode
}


export const getBoardThemeMode = (): Mode => _themeMode


export const isBoardDarkMode = (): boolean => _themeMode === "dark"
