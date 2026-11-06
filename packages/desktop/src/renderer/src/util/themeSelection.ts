// Which pair of themes a window renders.
//
// Two axes, one resolver. The editor, the settings window and the first paint
// path all come through here, so the pair can never disagree between windows,
// and a preferences file written before the axes split still resolves to the
// single theme it saved.
//
// Following the system needs its own fields per axis (`lightUiTheme` and
// friends): with one field per axis, an OS switch would have to re-derive the
// pair and would lose whichever axis the user had picked separately.

import { THEMES, getTheme } from './themeColor'

export type Appearance = 'light' | 'dark'

export interface ThemePreferences {
  theme: string
  uiTheme: string
  mdTheme: string
  followSystemTheme: boolean
  lightModeTheme: string
  darkModeTheme: string
  lightUiTheme: string
  lightMdTheme: string
  darkUiTheme: string
  darkMdTheme: string
}

export interface ThemePair {
  ui: string
  md: string
}

/** A theme that certainly exists, preferring the one matching an appearance. */
export function fallbackTheme(appearance: Appearance): string {
  const named = THEMES.find(theme => theme.id === appearance)
  if (named) return named.id

  const matching = THEMES.find(theme => theme.appearance === appearance)
  if (matching) return matching.id

  return THEMES[0]?.id ?? 'light'
}

const validOr = (id: string, fallback: string): string => (getTheme(id) ? id : fallback)

/**
 * Resolve the pair a window should display.
 *
 * `appearance` only matters while following the system; callers pass the OS
 * preference from `useSystemAppearance`.
 */
export function resolveThemePair(preferences: ThemePreferences, appearance: Appearance): ThemePair {
  if (preferences.followSystemTheme) {
    const fallback = fallbackTheme(appearance)
    const isLight = appearance === 'light'
    const ui = isLight
      ? preferences.lightUiTheme || preferences.lightModeTheme
      : preferences.darkUiTheme || preferences.darkModeTheme
    const md = isLight
      ? preferences.lightMdTheme || preferences.lightModeTheme
      : preferences.darkMdTheme || preferences.darkModeTheme

    return { ui: validOr(ui, fallback), md: validOr(md, fallback) }
  }

  // Not following the system: `theme` is the single choice the pre-split
  // preferences page wrote, and each axis may override it.
  const base = validOr(preferences.theme, fallbackTheme('light'))

  return {
    ui: validOr(preferences.uiTheme || base, base),
    md: validOr(preferences.mdTheme || base, base)
  }
}

/**
 * The pair to paint before the stored preferences have been read.
 *
 * The window URL carries the pair the previous session painted with, so the
 * first frame matches what was on screen. That pair is a cache for one frame
 * only: once the file has arrived its resolution wins, even when it names the
 * same ids, because a following-system user would otherwise keep the cached
 * appearance forever. An axis missing from the cache falls back on its own,
 * which is what a URL written before both axes existed looks like.
 */
export function firstPaintPair(
  resolved: ThemePair,
  loaded: boolean,
  cached?: { ui?: string | null; md?: string | null } | null
): ThemePair {
  if (loaded) return resolved

  return { ui: cached?.ui || resolved.ui, md: cached?.md || resolved.md }
}

/**
 * The appearance the Markdown axis asks for.
 *
 * Muya's own dark styles (GitHub alerts, for one) are driven by `body.dark`,
 * so they have to follow the body palette, not the chrome's. `undefined` means
 * the id is unknown and the caller should keep whatever class is there.
 */
export function markdownAppearance(id: string): Appearance | undefined {
  const theme = getTheme(id)
  if (!theme) return undefined

  return theme.appearance
}
