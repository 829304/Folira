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
      patch: { sideBarVisibility: true }
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

  it('retries a failed write on its own, then carries on', async() => {
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

    // The dropped write is retried, not lost: the announcement already took
    // these keys away from the other windows, so nothing else would send them.
    expect(merge).toHaveBeenCalledTimes(3)
    expect((merge.mock.calls[1][1] as { patch: object }).patch).toEqual({
      autoSave: false
    })
    expect((merge.mock.calls[2][1] as { patch: object }).patch).toEqual({ fontSize: 20 })
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
    expect((writes[0][1] as { patch: object }).patch).toEqual({ followSystemTheme: false })

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

  it('does not let the launch values reach the stored copy', async() => {
    // `main.ts` seeds the store from the window URL before mount: nulls for the
    // theme fields and a default `hideScrollbar`. Those are throwaway values,
    // and letting them into this copy would merge them over the file on read.
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      return Promise.resolve(undefined)
    })

    const bridge = await loadModule()
    // The store subscribes to the preference channels on import; the shell this
    // test lacks only has to swallow that.
    ;(window as unknown as {
      electron: { ipcRenderer: { send: () => void; on: () => void } }
    }).electron = {
      ipcRenderer: { send: () => undefined, on: () => undefined }
    }
    // After `resetModules`, the store and this test must share one Pinia
    // instance, so it is imported fresh rather than at the top of the file.
    const pinia = await import('pinia')
    pinia.setActivePinia(pinia.createPinia())
    const { usePreferencesStore } = await import('../../../src/renderer/src/store/preferences')
    const store = usePreferencesStore()

    store.SEED_USER_PREFERENCE({ theme: null, hideScrollbar: false })
    await bridge.sendStoredPreferences((channel: string, args: unknown[]) => {
      if (channel === 'mt::stored-user-preference') {
        store.LOAD_STORED_PREFERENCES(args[0] as Record<string, unknown>)
      }
    })

    expect(store.theme).toBe('dracula')
    expect(store.fontSize).toBe(18)
  })

  it('keeps the defaults when the window URL carries no font', async() => {
    // A missing parameter is a `null`, not a request to clear the field, and a
    // first run has no file to restore it from. The URL also hands numbers over
    // as text, which would leave `codeFontSize` a string for every comparison
    // downstream.
    vi.useRealTimers()
    const pinia = await import('pinia')
    pinia.setActivePinia(pinia.createPinia())
    const { usePreferencesStore } = await import('../../../src/renderer/src/store/preferences')
    const store = usePreferencesStore()

    store.SEED_USER_PREFERENCE({
      theme: null,
      codeFontFamily: null,
      codeFontSize: null,
      hideScrollbar: false
    })
    store.LOAD_STORED_PREFERENCES({})

    expect(store.codeFontFamily).toBe('DejaVu Sans Mono')
    expect(store.codeFontSize).toBe(14)

    store.SEED_USER_PREFERENCE({ codeFontSize: '17', codeFontFamily: 'Consolas' })

    expect(store.codeFontSize).toBe(17)
    expect(store.codeFontFamily).toBe('Consolas')
  })

  it('drops a queued value another window has since changed', async() => {
    // The settings window queues `autoSave: true`, the editor turns it off and
    // writes `false` first. The queued `true` must not land on top of it.
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      if (command === 'merge_json_file') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })

    const { setStoredPreferences, rememberStoredPreferences, flushStoredPreferences } =
      await loadModule()

    // Queued but not yet written: the debounce is what the second window beats.
    const queued = setStoredPreferences({ autoSave: true })
    rememberStoredPreferences({ autoSave: false }, Date.now() + 1000)
    await flushStoredPreferences()
    await queued

    const writes = invoke.mock.calls.filter(([command]) => command === 'merge_json_file')
    expect(writes).toHaveLength(0)
  })

  it('keeps its own echo of an array preference', async() => {
    // `sideBarExcludeFiles` is an array, and IPC hands it back as a fresh object
    // with equal content. Comparing values dropped the window's own queued write.
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      if (command === 'merge_json_file') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })

    const { setStoredPreferences, rememberStoredPreferences, flushStoredPreferences } =
      await loadModule()

    const queued = setStoredPreferences({ sideBarExcludeFiles: ['node_modules'] })
    const at = await queued
    rememberStoredPreferences({ sideBarExcludeFiles: ['node_modules'] }, at)
    await flushStoredPreferences()

    const writes = invoke.mock.calls.filter(([command]) => command === 'merge_json_file')
    expect(writes).toHaveLength(1)
    expect(writes[0][1]).toEqual({
      path: '/user-data/preferences.json',
      patch: { sideBarExcludeFiles: ['node_modules'] }
    })
  })

  it('ignores an echo that arrives after a newer edit', async() => {
    // Two quick edits to the font size, then the first announcement comes back:
    // the older stamp must not cancel the newer patch.
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      if (command === 'merge_json_file') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })

    const { setStoredPreferences, rememberStoredPreferences, flushStoredPreferences } =
      await loadModule()

    const older = setStoredPreferences({ codeFontSize: 18 })
    const olderAt = await older
    await setStoredPreferences({ codeFontSize: 24 })
    rememberStoredPreferences({ codeFontSize: 18 }, olderAt)
    await flushStoredPreferences()

    const writes = invoke.mock.calls.filter(([command]) => command === 'merge_json_file')
    expect(writes).toHaveLength(1)
    expect(writes[0][1]).toEqual({
      path: '/user-data/preferences.json',
      patch: { codeFontSize: 24 }
    })
  })
})
