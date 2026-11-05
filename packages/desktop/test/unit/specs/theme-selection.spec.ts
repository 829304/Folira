import { resolve } from 'path'
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

import {
  fallbackTheme,
  markdownAppearance,
  resolveThemePair,
  type ThemePreferences
} from '@/util/themeSelection'
import { THEMES, getTheme } from '@/util/themeColor'

const prefs = (overrides: Partial<ThemePreferences> = {}): ThemePreferences => ({
  theme: 'light',
  uiTheme: '',
  mdTheme: '',
  followSystemTheme: false,
  lightModeTheme: 'light',
  darkModeTheme: 'dark',
  lightUiTheme: '',
  lightMdTheme: '',
  darkUiTheme: '',
  darkMdTheme: '',
  ...overrides
})

describe('theme selection', () => {
  it('keeps the pre-split single theme on both axes', () => {
    expect(resolveThemePair(prefs({ theme: 'graphite' }), 'light')).toEqual({
      ui: 'graphite',
      md: 'graphite'
    })
  })

  it('lets each axis override the single theme', () => {
    expect(resolveThemePair(prefs({ theme: 'light', uiTheme: 'dark', mdTheme: 'ulysses' }), 'dark')).toEqual({
      ui: 'dark',
      md: 'ulysses'
    })
  })

  it('resolves one pair per appearance while following the system', () => {
    const following = prefs({
      followSystemTheme: true,
      lightModeTheme: 'light',
      darkModeTheme: 'one-dark',
      lightUiTheme: 'ayu-light',
      lightMdTheme: 'ulysses',
      darkUiTheme: 'graphite',
      darkMdTheme: 'dracula'
    })

    expect(resolveThemePair(following, 'light')).toEqual({ ui: 'ayu-light', md: 'ulysses' })
    expect(resolveThemePair(following, 'dark')).toEqual({ ui: 'graphite', md: 'dracula' })
  })

  it('falls back to the mode theme for an axis left empty', () => {
    const following = prefs({
      followSystemTheme: true,
      lightModeTheme: 'light',
      darkModeTheme: 'one-dark',
      lightUiTheme: 'ayu-light'
    })

    expect(resolveThemePair(following, 'light')).toEqual({ ui: 'ayu-light', md: 'light' })
    expect(resolveThemePair(following, 'dark')).toEqual({ ui: 'one-dark', md: 'one-dark' })
  })

  it('replaces an id that no longer exists', () => {
    expect(resolveThemePair(prefs({ theme: 'gone' }), 'light')).toEqual({
      ui: 'light',
      md: 'light'
    })
  })

  it('falls back to a theme of the requested appearance', () => {
    for (const appearance of ['light', 'dark'] as const) {
      expect(getTheme(fallbackTheme(appearance))?.appearance).toBe(appearance)
    }
  })

  it('reports the appearance Muya should be told about', () => {
    expect(markdownAppearance('light')).toBe('light')
    expect(markdownAppearance('one-dark')).toBe('dark')
    expect(markdownAppearance('gone')).toBeUndefined()
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
})
