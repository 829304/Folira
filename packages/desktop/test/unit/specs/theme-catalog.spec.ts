import { describe, expect, it } from 'vitest'

import { THEMES } from '@/util/themeColor'
import { appearanceOf, matchThemes, themesOf } from '@/util/themeCatalog'

const ids = (themes: { id: string }[]): string[] => themes.map(theme => theme.id)

describe('theme catalog', () => {
  it('splits the manifest into the two appearances without losing an entry', () => {
    const light = themesOf(THEMES, 'light')
    const dark = themesOf(THEMES, 'dark')

    expect(light.length).toBeGreaterThan(0)
    expect(dark.length).toBeGreaterThan(0)
    expect(light.length + dark.length).toBe(THEMES.length)
    expect(light.every(theme => theme.appearance === 'light')).toBe(true)
    expect(dark.every(theme => theme.appearance === 'dark')).toBe(true)
  })

  it('treats an id the manifest no longer ships as light', () => {
    // `resolveThemeId` paints the light default for an unknown id, so the tab
    // that lists what the window is actually showing has to be the light one.
    expect(appearanceOf('light')).toBe('light')
    expect(appearanceOf('dracula')).toBe('dark')
    expect(appearanceOf('gone')).toBe('light')
  })

  it('matches ids and labels, ignoring case and surrounding spaces', () => {
    const light = themesOf(THEMES, 'light')

    expect(ids(matchThemes(light, 'github'))).toContain('github-light')
    expect(ids(matchThemes(light, 'GitHub Light'))).toContain('github-light')
    expect(ids(matchThemes(THEMES, '  DRACULA  '))).toEqual(['dracula'])
  })

  it('does not filter when the query is empty', () => {
    expect(matchThemes(THEMES, '')).toEqual(THEMES)
    expect(matchThemes(THEMES, '   ')).toEqual(THEMES)
  })

  it('returns nothing when neither an id nor a label matches', () => {
    expect(matchThemes(THEMES, 'no-such-theme')).toEqual([])
  })
})
