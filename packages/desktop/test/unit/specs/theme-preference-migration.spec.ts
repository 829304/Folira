// Preferences files written before the theme axes split.
//
// They only know `theme`. The new default is "follow the system", so a naive
// read would flip those users to the dark pair on a dark OS the first time the
// new build started — an appearance change nobody asked for, on a setting they
// never saw. The migration keeps the single theme until a file proves it was
// written by the two-axis page.

import { readFileSync } from 'fs'
import { resolve } from 'path'
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

// Only the file read at startup can predate the split. A patch carries the one
// field the user just changed, so migrating it would write `followSystemTheme:
// false` behind their back every time they touched anything.
describe('applying preferences from the two sources', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../src/renderer/src/store/preferences.ts'),
    'utf8'
  )

  const actionBody = (name: string, until: string): string =>
    source.slice(source.indexOf(`${name}(`), source.indexOf(`${until}(`))

  it('migrates the stored file', () => {
    expect(actionBody('LOAD_STORED_PREFERENCES', 'SET_USER_PREFERENCE')).toContain(
      'migrateLegacyThemeFields('
    )
  })

  it('leaves a broadcast patch alone', () => {
    expect(actionBody('SET_USER_PREFERENCE', 'SET_MODE')).not.toContain(
      'migrateLegacyThemeFields('
    )
  })
})
