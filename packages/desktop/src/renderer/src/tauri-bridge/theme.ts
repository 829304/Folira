// First-paint cache for the theme.
//
// The durable copy lives in the preferences file, but first paint happens before
// that file has been read, so the applied id is mirrored here where it can be
// read synchronously. Every successful commit ends up in `applyThemeSet`, which
// calls `rememberTheme`, so the mirror can never name a theme the window is not
// showing. It is a cache for one frame: it never turns into a stored preference.

import { DEFAULT_THEME_ID, resolveThemeId } from '@/util/themeSelection'

const THEME_KEY = 'mt-tauri-theme'

/** Record the theme this window is showing, for the next first paint. */
export function rememberTheme(theme: string): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* localStorage unavailable — the preferences file still has it */
  }
}

/**
 * The theme to paint before the preferences file is read.
 *
 * A cache written by a build whose themes have since been renamed can name an id
 * that no longer exists, so it is validated here and falls back to the default.
 */
export function resolveInitialTheme(): string {
  try {
    return resolveThemeId(localStorage.getItem(THEME_KEY))
  } catch {
    return DEFAULT_THEME_ID
  }
}
