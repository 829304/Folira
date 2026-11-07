import { describe, expect, it } from 'vitest'

import { THEMES } from '@/util/themeColor'
import {
  appearanceOf,
  hoverAfterFocus,
  matchThemes,
  previewIdOf,
  prunePreviewCandidates,
  themesOf
} from '@/util/themeCatalog'

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

describe('theme preview candidate', () => {
  const visible = [{ id: 'light' }, { id: 'dracula' }]

  it('previews the hovered card while it is in the list', () => {
    expect(
      previewIdOf({ hovered: 'dracula', focused: 'light', visible, fallback: 'light' })
    ).toBe('dracula')
  })

  it('keeps the focused card previewed when the pointer leaves another card', () => {
    // Hover is null because the pointer left a different card; focus stays.
    expect(
      previewIdOf({ hovered: null, focused: 'dracula', visible, fallback: 'light' })
    ).toBe('dracula')
  })

  it('falls back when the candidate was filtered out of the list', () => {
    // Typing in the focused search box unmounts the hovered card before it can
    // fire mouseleave; the preview must not stick to a theme no longer listed.
    expect(
      previewIdOf({ hovered: 'ayu-light', focused: null, visible, fallback: 'light' })
    ).toBe('light')
  })

  it('keeps the focused card when the hovered one was filtered out', () => {
    // Tab moved focus to Dracula, then the query removed the card the pointer
    // still rests on. The stale hover must not win over the visible focus.
    expect(
      previewIdOf({ hovered: 'ayu-light', focused: 'dracula', visible, fallback: 'light' })
    ).toBe('dracula')
  })

  it('falls back when both candidates were filtered out', () => {
    expect(
      previewIdOf({ hovered: 'ayu-light', focused: 'nord', visible, fallback: 'light' })
    ).toBe('light')
  })

  it('drops the pointer when the keyboard moves focus', () => {
    // Tab reached a card while the pointer still rested on another one; the
    // keyboard is the newer input, so its card is the one to preview.
    expect(hoverAfterFocus(true, 'dracula')).toBeNull()
    expect(hoverAfterFocus(true, null)).toBeNull()
  })

  it('keeps the hover when the card was clicked', () => {
    // A click means the pointer really is over that card, so hover keeps its
    // claim and a move within the grid cannot clear what focus set.
    expect(hoverAfterFocus(false, 'dracula')).toBe('dracula')
    expect(hoverAfterFocus(false, null)).toBeNull()
  })

  it('drops only the candidates whose card left the list', () => {
    // Narrowing the query around the card the pointer rests on must not stop the
    // preview; only a card that is gone from the list loses its claim.
    expect(
      prunePreviewCandidates(visible, { hovered: 'dracula', focused: 'light' })
    ).toEqual({ hovered: 'dracula', focused: 'light' })

    expect(
      prunePreviewCandidates(visible, { hovered: 'ayu-light', focused: 'dracula' })
    ).toEqual({ hovered: null, focused: 'dracula' })

    expect(prunePreviewCandidates([], { hovered: 'light', focused: 'dracula' })).toEqual({
      hovered: null,
      focused: null
    })
  })

  it('falls back when neither hover nor focus points at a card', () => {
    expect(previewIdOf({ hovered: null, focused: null, visible, fallback: 'nord' })).toBe('nord')
  })
})
