// Which theme a window renders.
//
// One id covers the chrome, the body and the syntax palette: `ui/<id>.css`,
// `md/<id>.css` and the Prism sheet named by the manifest are three files of the
// same theme, and no user choice can separate them. Everything that needs a
// theme — the editor window, the settings window and the first paint path —
// resolves through here, so two windows can never disagree.

import { THEMES, getTheme } from './themeColor'

/** The theme a fresh install starts with, and the one an unknown id falls back to. */
export const DEFAULT_THEME_ID = 'light'

/** A theme id that certainly exists. */
export function resolveThemeId(theme: string | null | undefined): string {
  if (theme && getTheme(theme)) return theme

  return getTheme(DEFAULT_THEME_ID) ? DEFAULT_THEME_ID : (THEMES[0]?.id ?? DEFAULT_THEME_ID)
}

/**
 * The theme to paint before the stored preferences have been read.
 *
 * The window URL carries the id the previous session painted with, so the first
 * frame matches what was on screen. That id is a cache for one frame only: once
 * the file has arrived its resolution wins, even when it names the same theme,
 * because the cache is a guess and the file is the user's choice.
 */
export function firstPaintTheme(resolved: string, loaded: boolean, cached?: string | null): string {
  if (loaded) return resolved

  return cached && getTheme(cached) ? cached : resolved
}
