// Browsing the theme catalog by appearance.
//
// The settings page lists one appearance at a time and filters it by name. Both
// operations are pure and take the list as an argument, so they are unit-tested
// against a manifest-shaped array without mounting the page or a store.

import { getTheme, type ThemeEntry } from './themeColor'

/** Manifest appearance values; the catalog groups by exactly these. */
export type ThemeAppearance = ThemeEntry['appearance']

/**
 * The appearance of a known id; an unknown one counts as light.
 *
 * This mirrors `resolveThemeId`: an id the manifest does not ship paints the
 * light default, so the tab that lists what is actually on screen has to be the
 * light one as well.
 */
export const appearanceOf = (id: string): ThemeAppearance =>
  getTheme(id)?.appearance ?? 'light'

/** The themes of one appearance, in manifest order. */
export const themesOf = (themes: ThemeEntry[], appearance: ThemeAppearance): ThemeEntry[] =>
  themes.filter(theme => theme.appearance === appearance)

/**
 * The themes whose id or label contains `query`, case-insensitively.
 *
 * An empty (or whitespace-only) query is not a filter and returns the list
 * unchanged, which is what lets the page keep one query across both tabs.
 */
export const matchThemes = (themes: ThemeEntry[], query: string): ThemeEntry[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) return themes

  return themes.filter(
    theme => theme.id.toLowerCase().includes(needle) || theme.label.toLowerCase().includes(needle)
  )
}

/**
 * The id the preview should paint: the hovered card, then the focused one, but
 * only while that card is still in the visible list.
 *
 * A filtered-out card unmounts before it can fire `mouseleave`/`blur`, so a
 * candidate that left `visible` would otherwise pin the preview to a theme the
 * list no longer offers. Both candidates are kept separate by the caller: a
 * pointer leaving one card must not clear the preview of the card that still
 * has keyboard focus.
 */
export const previewIdOf = (options: {
  hovered: string | null
  focused: string | null
  visible: ReadonlyArray<Pick<ThemeEntry, 'id'>>
  fallback: string
}): string => {
  const candidate = options.hovered ?? options.focused
  if (candidate !== null && options.visible.some(theme => theme.id === candidate)) {
    return candidate
  }

  return options.fallback
}
