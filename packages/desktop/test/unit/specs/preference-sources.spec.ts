// Which of the three preference sources may reach the stored copy.
//
// A window keeps its own copy of `preferences.json` to answer menu toggles
// without a round trip. Three things feed the store: the launch URL (throwaway
// values), the file read at startup (the disk's truth), and a broadcast patch
// (a real edit made in another window). Only the last one describes a change
// the user just made, so only it may update that copy — the others would let a
// launch default or a stale read win over what is on disk.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

describe('applying preferences from the three sources', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../src/renderer/src/store/preferences.ts'),
    'utf8'
  )

  const actionBody = (name: string, until: string): string =>
    source.slice(source.indexOf(`${name}(`), source.indexOf(`${until}(`))

  it('syncs the stored copy only for a change a user made', () => {
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
