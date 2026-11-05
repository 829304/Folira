// Writing a preference while the stored ones are still being read.
//
// This is not a rare interleaving: the editor asks for its preferences and then
// writes `sideBarVisibility` from the layout bootstrap microseconds later, so
// every launch runs it. A `loaded` flag set before the `await` let the second
// caller see an empty bag — and the debounced write that followed replaced the
// file with just that one key.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const STORED = { theme: 'dracula', autoSave: true, fontSize: 18 }

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

/** Resolves only when released, so a read can be held open on purpose. */
const deferred = <T>(): { promise: Promise<T>; release: (value: T) => void } => {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const loadModule = async() => {
  vi.resetModules()
  const module = await import('../../../src/renderer/src/tauri-bridge/preferences')
  module.initPreferenceStores('/user-data')
  return module
}

describe('preference store', () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.useFakeTimers()
  })

  it('keeps stored preferences when one is written mid-read', async() => {
    const readRelease = deferred<string>()
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return readRelease.promise
      if (command === 'merge_json_file') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })

    const { sendStoredPreferences, setStoredPreferences } = await loadModule()

    // The read starts and is held open.
    const dispatch = vi.fn()
    const asking = sendStoredPreferences(dispatch)
    // The layout bootstrap writes while it is still in flight.
    const writing = setStoredPreferences({ sideBarVisibility: true })

    readRelease.release(JSON.stringify(STORED))
    await asking
    await writing

    await vi.runAllTimersAsync()

    const writes = invoke.mock.calls.filter(([command]) => command === 'merge_json_file')
    expect(writes, 'the patch should have been written').toHaveLength(1)
    expect(writes[0][1]).toEqual({
      path: '/user-data/preferences.json',
      patch: { preferencesVersion: 2, sideBarVisibility: true }
    })
  })

  it('reads the file once however many callers ask', async() => {
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      return Promise.resolve(undefined)
    })

    const { sendStoredPreferences, getStoredPreference } = await loadModule()
    const dispatch = vi.fn()

    await Promise.all([
      sendStoredPreferences(dispatch),
      sendStoredPreferences(dispatch),
      getStoredPreference('theme')
    ])

    expect(invoke.mock.calls.filter(([command]) => command === 'read_file')).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledWith('mt::stored-user-preference', [STORED])
  })

  it('sends a patch to merge instead of replacing the shared file', async() => {
    // Every window keeps its own copy of the stored bag, so writing that bag
    // back would drop whatever another window saved since this one read it.
    const source = readFileSync(
      resolve(__dirname, '../../../src/renderer/src/tauri-bridge/preferences.ts'),
      'utf-8'
    )
    expect(source).toContain("invoke('merge_json_file'")
    expect(source).not.toContain("invoke('output_file'")
  })

  it('keeps a patch whose write failed, and sends it with the next edit', async() => {
    const merge = vi.fn()
    invoke.mockImplementation((command: string, args: unknown) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      if (command === 'merge_json_file') return merge(command, args)
      return Promise.resolve(undefined)
    })
    merge.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)

    const { setStoredPreferences } = await loadModule()

    await setStoredPreferences({ autoSave: false })
    await vi.runAllTimersAsync()

    await setStoredPreferences({ fontSize: 20 })
    await vi.runAllTimersAsync()

    // The dropped write is retried, not lost: a second window's keys would
    // otherwise be gone for good.
    expect(merge).toHaveBeenCalledTimes(2)
    expect((merge.mock.calls[1][1] as { patch: object }).patch).toEqual({
      autoSave: false,
      preferencesVersion: 2,
      fontSize: 20
    })
  })

  it('counts a patch as pending before the stored file has been read', async() => {
    // Closing the window runs `flushStoredPreferences`, which can only write
    // what is already in `pending`. Registering the patch after `await read`
    // left it in flight, so the close saw an empty bag and the edit was lost.
    const readRelease = deferred<string>()
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return readRelease.promise
      if (command === 'merge_json_file') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })

    const { setStoredPreferences, flushStoredPreferences } = await loadModule()

    // The read never resolves during the close: the write must not need it.
    const editing = setStoredPreferences({ followSystemTheme: false })
    await flushStoredPreferences()

    const writes = invoke.mock.calls.filter(([command]) => command === 'merge_json_file')
    expect(writes, 'the close should have written the edit').toHaveLength(1)
    expect((writes[0][1] as { patch: object }).patch).toEqual({
      followSystemTheme: false,
      preferencesVersion: 2
    })

    readRelease.release(JSON.stringify(STORED))
    await editing
  })

  it('waits for the write already on the wire before closing', async() => {
    const writeRelease = deferred<undefined>()
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      if (command === 'merge_json_file') return writeRelease.promise
      return Promise.resolve(undefined)
    })

    const { setStoredPreferences, flushStoredPreferences } = await loadModule()

    await setStoredPreferences({ autoSave: false })
    await vi.runAllTimersAsync()

    let closed = false
    const closing = flushStoredPreferences().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed, 'the close waits for the debounced write').toBe(false)

    writeRelease.release(undefined)
    await closing
    expect(closed).toBe(true)
  })

  it('sees a value another window announced', async() => {
    // A menu toggle reads the stored value and flips it. The copy kept here
    // knows only what this window wrote, so a change from the settings window
    // has to reach it or the first click writes the old value back.
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(false)
      return Promise.resolve(undefined)
    })

    const { rememberStoredPreferences, getStoredPreference } = await loadModule()
    rememberStoredPreferences({ autoSave: true })

    await expect(getStoredPreference('autoSave')).resolves.toBe(true)
  })
})
