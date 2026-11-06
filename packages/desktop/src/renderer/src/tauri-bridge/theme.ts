// First-paint cache for the theme.
//
// The durable copy lives in the preferences file, but first paint happens before
// that file has been read, so the applied id is mirrored here where it can be
// read synchronously. Every successful commit ends up in `applyThemeSet`, which
// calls `rememberTheme`, so the mirror can never name a theme the window is not
// showing.

import { DEFAULT_THEME_ID } from '@/util/themeSelection'

const THEME_KEY = 'mt-tauri-theme'
// Written by versions that split the chrome from the body. Read once, then
// superseded by the single id the next commit records.
const LEGACY_PAIR_KEY = 'mt-tauri-theme-pair'
// Written by versions that only had one theme, possibly "system".
const LEGACY_CHOICE_KEY = 'mt-tauri-theme-choice'

/** Record the theme this window is showing, for the next first paint. */
export function rememberTheme(theme: string): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* localStorage unavailable — the preferences file still has it */
  }
}

function legacyFromPair(): string | null {
  try {
    const raw = localStorage.getItem(LEGACY_PAIR_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as { md?: unknown }
    return typeof parsed?.md === 'string' ? parsed.md : null
  } catch {
    return null
  }
}

function legacyFromChoice(): string | null {
  try {
    const choice = localStorage.getItem(LEGACY_CHOICE_KEY)
    // "system" named a follow-the-OS mode that no longer exists; the default is
    // a better guess than the OS reading, which the user never chose.
    return choice && choice !== 'system' ? choice : null
  } catch {
    return null
  }
}

/**
 * The theme to paint before the preferences file is read.
 *
 * The caller validates the id: a stale cache may name a theme that has since
 * been renamed, and `firstPaintTheme` falls back to the resolved one then.
 */
export function resolveInitialTheme(): string {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_KEY)
  } catch {
    /* treat as empty */
  }

  return stored || legacyFromPair() || legacyFromChoice() || DEFAULT_THEME_ID
}
