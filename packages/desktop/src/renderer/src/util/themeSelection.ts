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

/** Whether the system asks for a dark interface right now. */
export const systemPrefersDark = (): boolean => window.matchMedia?.('(prefers-color-scheme: dark)').matches === true

/**
 * The theme a profile from before the single-theme switch was showing.
 *
 * Those builds never wrote the follow-the-system default to the file: only a
 * user override landed there, and the native Theme menu recorded its answer in
 * `localStorage`. An explicit id therefore wins, `'system'` means "whatever the
 * OS said", and an upgrade with no recorded choice keeps the OS appearance the
 * old build painted — which is also what the defaults produced.
 */
export function upgradeThemeId(remembered: string | null): string {
  const known = remembered && getTheme(remembered) ? remembered : null

  if (known) return known

  const appearance = systemPrefersDark() ? 'dark' : 'light'

  return getTheme(appearance) ? appearance : DEFAULT_THEME_ID
}

/**
 * The theme a preferences file from an older build asked for, or `null` when the
 * file already speaks the single-theme format.
 *
 * Files written before the themes were merged carry the pair fields (`uiTheme`,
 * `mdTheme`) or the older "follow the system" trio (`followSystemTheme`,
 * `lightModeTheme`, `darkModeTheme`). The old renderer decided the look from
 * those fields — following the system meant picking one of the two pairs at
 * load time — so reading them here, once, keeps the upgrade from silently
 * brightening a dark desktop. The caller writes the result as `theme` before
 * the deprecated keys are pruned: after the prune the information is gone.
 */
export function migrateLegacyThemeId(bag: Record<string, unknown>): string | null {
  const legacyKeys = ['followSystemTheme', 'lightModeTheme', 'darkModeTheme', 'uiTheme', 'mdTheme']
  const speaksLegacy = legacyKeys.some(key => key in bag) || bag.theme === 'system'

  if (!speaksLegacy) return null

  const known = (id: unknown): string | null => (typeof id === 'string' && getTheme(id) ? id : null)
  const pick = (id: unknown, appearance: 'light' | 'dark'): string => known(id) ?? (getTheme(appearance) ? appearance : DEFAULT_THEME_ID)
  const follows = bag.followSystemTheme === true || bag.theme === 'system'

  if (follows) {
    const appearance = systemPrefersDark() ? 'dark' : 'light'

    return pick(appearance === 'dark' ? bag.darkModeTheme : bag.lightModeTheme, appearance)
  }

  // Files from the short-lived two-axis builds carry `theme` as a leftover
  // default next to the pair they really used, so the pair decides first. Files
  // from the older single-theme builds have no pair and store the real choice in
  // `theme`.
  const pair = known(bag.mdTheme) ?? known(bag.uiTheme)

  if (pair) return pick(pair, getTheme(pair)?.appearance ?? 'light')

  const explicit = known(bag.theme)

  if (explicit) return explicit

  if ('followSystemTheme' in bag) return pick(bag.theme, 'light')

  return null
}
