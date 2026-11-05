// Theme control for the Tauri build.
//
// The durable copy of the pair lives in the preferences file, but first paint
// happens before that file has been read, so the resolved pair is mirrored here
// where it can be read synchronously. Every writer of the theme preferences
// ends up in `applyTheme`, which calls `rememberThemePair`, so the mirror can
// never describe a pair the window is not showing.
//
// The native Theme menu (src-tauri/src/menu) emits `mt::set-theme` with
// 'system', 'light', 'dark', or a specific theme id; the renderer decides what
// that means for its two axes.

export interface ThemePair {
  ui: string
  md: string
}

const PAIR_KEY = 'mt-tauri-theme-pair'
// Written by versions that only had one theme. Read once, then superseded by
// the pair the next `applyTheme` records.
const LEGACY_KEY = 'mt-tauri-theme-choice'

const LIGHT = 'light'
const DARK = 'dark'

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function readStoredPair(): ThemePair | null {
  try {
    const raw = localStorage.getItem(PAIR_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<ThemePair>
    if (typeof parsed.ui !== 'string' || typeof parsed.md !== 'string') return null

    return { ui: parsed.ui, md: parsed.md }
  } catch {
    return null
  }
}

function readLegacyChoice(): string {
  try {
    return localStorage.getItem(LEGACY_KEY) || 'system'
  } catch {
    return 'system'
  }
}

/** Record the pair this window is showing, for the next first paint. */
export function rememberThemePair(pair: ThemePair): void {
  try {
    localStorage.setItem(PAIR_KEY, JSON.stringify(pair))
  } catch {
    /* localStorage unavailable — the preferences file still has it */
  }
}

/** The theme a legacy single choice stood for. */
function themeForChoice(choice: string): string {
  if (choice === 'system') return systemPrefersDark() ? DARK : LIGHT
  return choice
}

/** The pair to paint before the preferences file is read. */
export function resolveInitialPair(): ThemePair {
  const stored = readStoredPair()
  if (stored) return stored

  const legacy = themeForChoice(readLegacyChoice())

  return { ui: legacy, md: legacy }
}

/**
 * Wire ongoing theme changes from the native Theme menu.
 *
 * The OS appearance is not handled here: the renderer reads `matchMedia` while
 * following the system, so an OS switch repaints without any event plumbing.
 */
export function initThemeController(onMenuChoice: (choice: string) => void): void {
  window.electron.ipcRenderer.on('mt::set-theme', (_e, choice) => {
    onMenuChoice(String(choice))
  })
}
