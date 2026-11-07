import { resolve } from 'path'
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_THEME_ID,
  firstPaintTheme,
  resolveThemeId
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

  // Themes that are still missing their highlighting. The list is short lived:
  // the GitHub Light theme is being landed in two steps, and its palette comes
  // with the interface half. A theme that gains one must leave this list, so a
  // forgotten entry fails here.
  const PALETTES_PENDING = new Set(['github-light'])

  it('gives every theme the syntax palette it promises', () => {
    // `loadPrismCss` returns '' without one, and the Light theme ships no
    // highlighting of its own, so it borrows Prism's default palette.
    for (const theme of THEMES) {
      if (PALETTES_PENDING.has(theme.id)) {
        expect(theme.prism, `${theme.id} now has a Prism theme, drop it from PALETTES_PENDING`).toBeNull()
        continue
      }
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

  it('highlights the theme the window paints, not the one it asked for', () => {
    // The settings page must not label a theme the editor is not showing: a
    // failed load keeps the previous look, and another window's broadcast is
    // only a target here. `usePaintedThemeSelection` is the seam that reads the
    // committed theme; a component that reads the preference instead would
    // regress the behaviour without any unit to catch it, so this checks the
    // page's only selection source.
    const page = readFileSync(
      resolve(renderer, 'prefComponents/theme/index.vue'),
      'utf8'
    )

    expect(page).toContain('usePaintedThemeSelection()')
    expect(page).not.toContain('paintedTheme()')
    expect(page).not.toMatch(/selectedTheme[^\n]*preferenceStore\.theme/)
  })
})
