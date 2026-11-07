import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

import { railscastsThemes } from 'common/theme'
import {
  DEFAULT_THEME_ID,
  firstPaintTheme,
  resolveThemeId
} from '@/util/themeSelection'
import { THEMES, getTheme } from '@/util/themeColor'

/** Themes removed in the 34 → 30 cleanup; no path may still ship one. */
const RETIRED_DARK_THEMES = ['tokyo-night-storm', 'rose-pine-moon', 'cyberdream', 'nightfox']

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

  it('no longer ships the retired dark themes', () => {
    // The 34 → 30 cleanup removed the themes everywhere they were named: the
    // manifest, the id resolver and the legacy dark-theme list. A stale entry in
    // any one of them would keep a retired id alive on a different path.
    for (const id of RETIRED_DARK_THEMES) {
      expect(THEMES.some(theme => theme.id === id), `${id} is still in manifest.json`).toBe(false)
      expect(resolveThemeId(id), `${id} still resolves to itself`).toBe(DEFAULT_THEME_ID)
      expect(railscastsThemes, `${id} is still listed as a dark theme`).not.toContain(id)
    }
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

  it('leaves no files behind for the retired themes', () => {
    for (const id of RETIRED_DARK_THEMES) {
      for (const axis of ['ui', 'md']) {
        const file = resolve(themesDir, axis, `${id}.css`)
        expect(existsSync(file), `${axis}/${id}.css still exists`).toBe(false)
      }
      const prism = resolve(themesDir, 'prismjs', `${id}.theme.css`)
      expect(existsSync(prism), `prismjs/${id}.theme.css still exists`).toBe(false)
    }
  })

  it('does not make the interface stylesheet carry the body palette', () => {
    const css = readFileSync(resolve(themesDir, 'ui', 'light.css'), 'utf8')
    expect(css).toContain('--fui-')
    expect(css).not.toContain('--fmd-h1Color')
  })

  it('gives every theme the syntax palette it promises', () => {
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

  it('browses the catalog by appearance without a second selection source', () => {
    // The two tabs split the manifest by appearance; they must only move the
    // list, never the selection. These source reads pin the wiring that has no
    // smaller unit (the page mounts a store and loads stylesheets).
    const page = readFileSync(
      resolve(renderer, 'prefComponents/theme/index.vue'),
      'utf8'
    )

    // The tab opens on the painted theme's appearance, not the preference
    // target — otherwise a failed commit would list the wrong tab.
    expect(page).toContain('appearanceOf(selectedTheme.value)')
    // A commit made after mount keeps the tab in step until the user picks one.
    expect(page).toMatch(/watch\(selectedTheme,[\s\S]{0,400}if \(tabTouched\.value\) return/)
    // Hover and focus are separate candidates: the pointer leaving one card
    // must not clear the preview of the card that still has keyboard focus.
    expect(page).toContain('const hoveredTheme = ref<string | null>(null)')
    expect(page).toContain('const focusedTheme = ref<string | null>(null)')
    expect(page).toContain('@mouseenter="hoveredTheme = entry.id"')
    expect(page).toContain('@mouseleave="hoveredTheme = null"')
    // Keyboard focus releases a pointer that never moved, so Tab still previews
    // the card it lands on; a click keeps the card the pointer is over.
    expect(page).toContain('@focus="focusTheme(entry.id, $event)"')
    expect(page).toMatch(/const focusTheme = \([\s\S]{0,300}matches\(':focus-visible'\)[\s\S]{0,120}hoveredTheme\.value = null/)
    expect(page).toContain('@blur="focusedTheme = null"')
    // The preview resolves through the pure helper, and it falls back whenever
    // the candidate is no longer in the visible list.
    expect(page).toContain('previewIdOf({')
    expect(page).toMatch(
      /visible: visibleThemes\.value,[\s\S]{0,120}fallback: selectedTheme\.value/
    )
    // Changing the filter or the tab removes the cards that carried the hover
    // and the focus, so both candidates are released there.
    expect(page).toMatch(
      /watch\(\[tab, query\],[\s\S]{0,300}hoveredTheme\.value = null[\s\S]{0,200}focusedTheme\.value = null/
    )
    // Selecting a card pins the tab, so a late commit cannot jump the list.
    expect(page).toMatch(/const selectTheme = async[\s\S]{0,300}tabTouched\.value = true/)
    // The grid is one tab's themes filtered by the shared query.
    expect(page).toContain('matchThemes(themesOf(THEMES, tab.value), query.value)')
    // Tabs control the result panel they filter, for assistive tech.
    expect(page).toContain('role="tabpanel"')
    expect(page).toContain('aria-controls="theme-panel"')
    expect(page).toContain(':id="`theme-tab-')
    expect(page).toContain(':aria-labelledby="`theme-tab-')
  })
})
