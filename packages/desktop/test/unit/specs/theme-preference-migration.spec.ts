// Preferences files written before the theme axes split.
//
// They only know `theme`. The new default is "follow the system", so a naive
// read would flip those users to the dark pair on a dark OS the first time the
// new build started — an appearance change nobody asked for, on a setting they
// never saw. The migration keeps the single theme until a file says it was
// written by this shape.
//
// The marker is the file version, not a theme field: a user who never opened the
// theme page stores no theme fields at all, so their absence says "untouched",
// not "old file".

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

  it('leaves a file this build wrote untouched', () => {
    const stored = {
      preferencesVersion: 2,
      theme: 'light',
      followSystemTheme: true,
      lightUiTheme: ''
    }

    expect(migrateLegacyThemeFields(stored)).toBe(stored)
  })

  it('does not mistake a theme-less file for a pre-split one', () => {
    // Only `fontSize` was ever changed, so the file carries no theme field at
    // all. It is current, and must keep the default "follow the system".
    const stored = { preferencesVersion: 2, fontSize: 17 }

    expect(migrateLegacyThemeFields(stored)).toBe(stored)
  })

  it('does not mutate what it was handed', () => {
    const stored = { theme: 'dark' }
    migrateLegacyThemeFields(stored)

    expect(stored).toEqual({ theme: 'dark' })
  })

  it('leaves a first run alone', () => {
    // No file yet: the bridge hands over an empty bag. Migrating it would turn
    // the system theme off for someone who never stored a theme at all.
    expect(migrateLegacyThemeFields({})).toEqual({})
  })
})

// A migration the file never hears about runs again on every start: the store
// and the disk keep disagreeing until the user happens to change something.
describe('storing the migrated bag', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../src/renderer/src/store/preferences.ts'),
    'utf8'
  )
  const load = source.slice(
    source.indexOf('LOAD_STORED_PREFERENCES('),
    source.indexOf('LOAD_STORED_USER_DATA(')
  )

  it('writes the migrated file back', () => {
    expect(load).toContain("send('mt::set-user-preference'")
  })

  it('writes only when the migration changed something', () => {
    expect(load).toContain('migrated !== raw')
  })
})

// Only the file read at startup can predate the split. A patch carries the one
// field the user just changed, so migrating it would write `followSystemTheme:
// false` behind their back every time they touched anything.
describe('applying preferences from the three sources', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../src/renderer/src/store/preferences.ts'),
    'utf8'
  )

  const actionBody = (name: string, until: string): string =>
    source.slice(source.indexOf(`${name}(`), source.indexOf(`${until}(`))

  it('migrates the stored preferences file', () => {
    expect(actionBody('LOAD_STORED_PREFERENCES', 'LOAD_STORED_USER_DATA')).toContain(
      'migrateLegacyThemeFields('
    )
  })

  it('leaves the stored user data alone', () => {
    expect(actionBody('LOAD_STORED_USER_DATA', 'SET_USER_PREFERENCE')).not.toContain(
      'migrateLegacyThemeFields('
    )
  })

  it('leaves a broadcast patch alone', () => {
    expect(actionBody('SET_USER_PREFERENCE', 'SET_MODE')).not.toContain(
      'migrateLegacyThemeFields('
    )
  })

  it('syncs the stored copy only for a change a user made', () => {
    // The launch URL carries throwaway values and the stored files are the
    // disk's own truth; letting either into the bridge's copy makes the merge
    // that follows read the launch defaults over what is on disk.
    expect(actionBody('SET_USER_PREFERENCE', 'SET_MODE')).toContain(
      'rememberStoredPreferences('
    )
    expect(actionBody('SEED_USER_PREFERENCE', 'SET_USER_PREFERENCE')).not.toContain(
      'rememberStoredPreferences('
    )
    expect(actionBody('APPLY_PREFERENCE', 'SEED_USER_PREFERENCE')).not.toContain(
      'rememberStoredPreferences('
    )
    const stored = source.slice(
      source.indexOf('LOAD_STORED_PREFERENCES'),
      source.indexOf('SEED_USER_PREFERENCE')
    )
    expect(stored).not.toContain('rememberStoredPreferences(')
  })
})
