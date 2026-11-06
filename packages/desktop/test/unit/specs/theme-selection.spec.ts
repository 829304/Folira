import { resolve } from 'path'
import { readFileSync } from 'fs'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_THEME_ID,
  firstPaintTheme,
  migrateLegacyThemeId,
  resolveThemeId,
  upgradeThemeId
} from '@/util/themeSelection'
import { THEMES, getTheme } from '@/util/themeColor'

describe('theme selection', () => {
  it('keeps an id the manifest ships', () => {
    expect(resolveThemeId('graphite')).toBe('graphite')
  })

  it('replaces an id that no longer exists', () => {
    expect(resolveThemeId('gone')).toBe(DEFAULT_THEME_ID)
  })

  it('falls back for an absent or empty id', () => {
    expect(resolveThemeId(null)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemeId(undefined)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemeId('')).toBe(DEFAULT_THEME_ID)
  })

  it('never resolves to an id outside the manifest', () => {
    for (const id of ['graphite', 'gone', '', null, undefined]) {
      expect(getTheme(resolveThemeId(id)), `${String(id)} resolved off-manifest`).toBeDefined()
    }
  })

  it('generates a swatch for every theme and axis', () => {
    for (const theme of THEMES) {
      expect(theme.swatches.ui.editorBgColor).toBeTruthy()
      expect(theme.swatches.md.editorBgColor).toBeTruthy()
    }
  })

  it('only names themes the manifest ships', () => {
    // Fixtures below spell ids out; a rename must fail here rather than turn
    // those tests into fallback tests that pass for the wrong reason.
    const fixtures = ['graphite', 'ulysses', 'one-dark', 'ayu-light', 'dracula']

    for (const id of fixtures) {
      expect(getTheme(id), `${id} is missing from manifest.json`).toBeDefined()
    }
    expect(getTheme('gone'), 'the unknown-id case needs an id that stays unknown').toBeUndefined()
  })
})

describe('theme assets on disk', () => {
  const themesDir = resolve(__dirname, '../../../src/renderer/src/assets/themes')

  it('keeps one stylesheet per theme and axis', () => {
    for (const theme of THEMES) {
      for (const axis of ['ui', 'md']) {
        const file = resolve(themesDir, axis, `${theme.id}.css`)
        expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0)
      }
    }
  })

  it('does not make the interface stylesheet carry the body palette', () => {
    const css = readFileSync(resolve(themesDir, 'ui', 'light.css'), 'utf8')
    expect(css).toContain('--fui-')
    expect(css).not.toContain('--fmd-h1Color')
  })

  it('gives every theme a syntax palette', () => {
    // `loadPrismCss` returns '' without one, and the Light theme ships no
    // highlighting of its own, so it borrows Prism's default palette.
    for (const theme of THEMES) {
      expect(theme.prism, `${theme.id} has no Prism theme`).toBeTruthy()
      const file = resolve(themesDir, 'prismjs', `${String(theme.prism)}.theme.css`)
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0)
    }
  })
})

describe('first frame', () => {
  const renderer = resolve(__dirname, '../../../src/renderer/src')

  it('keeps the cached theme out of the state the store receives', async() => {
    // The URL theme is the last painted frame, not a choice. `main.ts` hands
    // `initialState` to the preferences store before mount, so a theme folded in
    // there would read as "the user picked this" and pin the first frame.
    window.history.replaceState({}, '', '/index.html?wid=2&th=dracula&theme=graphite')

    const { parseUrlArgs } = await import('@/util/urlArgs')
    const args = parseUrlArgs()

    expect(args.initialTheme).toBe('dracula')
    expect(Object.keys(args.initialState)).not.toContain('theme')
  })

  it('paints the resolved theme once the preferences have loaded', () => {
    // Same answer on both sides: the stored file decides even when it resolves
    // to the default, so the cached id cannot outlive the first frame.
    expect(firstPaintTheme('light', false, 'dark')).toBe('dark')
    expect(firstPaintTheme('light', true, 'dark')).toBe('light')
    expect(firstPaintTheme('light', false, undefined)).toBe('light')
  })

  it('ignores a cached id the manifest no longer ships', () => {
    expect(firstPaintTheme('light', false, 'gone')).toBe('light')
  })

  it('feeds the store only the initial state', () => {
    // Seeded, not applied: the URL bag holds launch defaults that must not
    // reach the bridge's copy of the stored values, or reading the file would
    // merge those defaults over what is on disk. This is the one wiring check
    // that stays a source read — `main.ts` mounts the app, so there is no
    // smaller unit to drive — and its behaviour is covered by
    // preference-store-race.spec.ts.
    const main = readFileSync(resolve(renderer, 'main.ts'), 'utf8')

    expect(main).toContain('SEED_USER_PREFERENCE(window.marktext.initialState)')
    expect(main).not.toContain('SET_USER_PREFERENCE(window.marktext.initialState)')
    expect(main).not.toContain('initialThemePair')
  })

  // Preference-arrival behavior is exercised by theme-loading.spec.ts.

  it('keeps the theme setting reachable from the settings search', () => {
    const schema = JSON.parse(
      readFileSync(resolve(__dirname, '../../../src/shared/preferences-schema.json'), 'utf8')
    ) as Record<string, { description: string }>

    expect(schema.theme?.description, 'theme is hidden from the search index').not.toMatch(
      /--internal$/
    )
  })
})

describe('migrating the theme an older build stored', () => {
  const original = window.matchMedia

  const prefersDark = (dark: boolean): void => {
    Object.assign(window, {
      matchMedia: (query: string) => ({ matches: dark && query.includes('dark'), media: query })
    })
  }

  afterEach(() => {
    Object.assign(window, { matchMedia: original })
  })

  it('keeps the look of a file that followed the system', () => {
    prefersDark(true)
    expect(migrateLegacyThemeId({
      theme: 'light',
      followSystemTheme: true,
      lightModeTheme: 'light',
      darkModeTheme: 'one-dark'
    })).toBe('one-dark')
  })

  it('reads the light half when the system asks for a light interface', () => {
    prefersDark(false)
    expect(migrateLegacyThemeId({
      theme: 'light',
      followSystemTheme: true,
      lightModeTheme: 'graphite',
      darkModeTheme: 'one-dark'
    })).toBe('graphite')
  })

  it('keeps an explicit choice older builds stored in theme', () => {
    expect(migrateLegacyThemeId({
      theme: 'dracula',
      followSystemTheme: false,
      lightModeTheme: 'light',
      darkModeTheme: 'dark'
    })).toBe('dracula')
  })

  it('reads the Markdown half of a file from the two-axis builds', () => {
    expect(migrateLegacyThemeId({ uiTheme: 'graphite', mdTheme: 'nord' })).toBe('nord')
  })

  it('leaves a file that already speaks the single-theme format alone', () => {
    expect(migrateLegacyThemeId({ theme: 'nord', autoSave: true })).toBeNull()
  })

  it('keeps the recorded menu answer over the stale theme of a two-axis file', () => {
    // Dev builds wrote `theme` as a leftover default next to the pair; the pair's
    // Markdown half is what the window was actually showing.
    expect(migrateLegacyThemeId({ theme: 'light', uiTheme: 'graphite', mdTheme: 'nord' })).toBe('nord')
  })

  it('does not migrate a pair the manifest no longer ships', () => {
    prefersDark(false)
    expect(migrateLegacyThemeId({ uiTheme: 'gone', mdTheme: 'alsogone' })).toBeNull()
  })

  it('falls back to the light theme when the system cannot be asked', () => {
    Object.assign(window, { matchMedia: undefined })
    expect(upgradeThemeId(null)).toBe('light')
  })
})
