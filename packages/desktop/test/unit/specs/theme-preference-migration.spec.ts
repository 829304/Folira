// Preferences files written before the theme axes split.
//
// They only know `theme`. The new default is "follow the system", so a naive
// read would flip those users to the dark pair on a dark OS the first time the
// new build started — an appearance change nobody asked for, on a setting they
// never saw. The migration keeps the single theme until a file proves it was
// written by the two-axis page.

import { describe, expect, it } from 'vitest'

import { migrateLegacyThemeFields } from '@/store/preferences'

describe('migrating a pre-split preferences file', () => {
  it('keeps the single theme instead of following the system', () => {
    const stored = { theme: 'graphite', followSystemTheme: true, fontSize: 15 }

    expect(migrateLegacyThemeFields(stored)).toEqual({
      theme: 'graphite',
      followSystemTheme: false,
      fontSize: 15
    })
  })

  it('leaves a two-axis file untouched', () => {
    const stored = { theme: 'light', followSystemTheme: true, lightUiTheme: '' }

    expect(migrateLegacyThemeFields(stored)).toBe(stored)
  })

  it('does not mutate what it was handed', () => {
    const stored = { theme: 'dark' }
    migrateLegacyThemeFields(stored)

    expect(stored).toEqual({ theme: 'dark' })
  })
})
