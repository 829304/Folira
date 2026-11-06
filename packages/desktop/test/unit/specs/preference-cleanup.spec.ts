import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const emit = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ emit: (...args: unknown[]) => emit(...args) }))

type Bag = Record<string, unknown>

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

let disk: Bag
let userData: Bag
let exists: boolean
const calls: string[] = []
/** Paths the cleanup was pointed at, so a gate that stops working shows up. */
const pruned: string[] = []

const USER_DATA = '/data/dataCenter.json'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  disk = {}
  userData = {}
  exists = true
  calls.length = 0
  pruned.length = 0
  localStorage.clear()
  emit.mockReset().mockResolvedValue(undefined)
  invoke.mockReset().mockImplementation(async(command: string, args: Bag) => {
    calls.push(command)
    const bag = args.path === USER_DATA ? userData : disk
    if (command === 'path_exists') return exists
    if (command === 'read_file') return JSON.stringify(bag)
    if (command === 'merge_json_file') {
      Object.assign(bag, clone(args.patch ?? {}))
      return
    }
    if (command === 'prune_json_file') {
      pruned.push(String(args.path))
      for (const key of args.keys as string[]) delete bag[key]
    }
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function context(data: Bag, dataCenter: Bag = {}) {
  disk = data
  userData = dataCenter
  const store = await import('@/tauri-bridge/preferences')
  store.initPreferenceStores('/data')
  return store
}

describe('cleaning preferences a previous build wrote', () => {
  it('removes the old theme pair from the file', async() => {
    // A two-axis file kept the pair in `uiTheme`/`mdTheme`; `theme` was a
    // leftover default the pair-era builds no longer updated. Nothing is
    // inferred from the pair: the default stays, only the keys go.
    const store = await context({
      theme: 'light',
      uiTheme: 'graphite',
      mdTheme: 'nord',
      followSystemTheme: false,
      lightModeTheme: 'light',
      preferencesVersion: 2
    })

    await store.setStoredPreferences({ autoSave: true })
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(calls).toContain('prune_json_file'))

    expect(disk).toEqual({ theme: 'light', autoSave: true })
    await expect(store.getStoredPreference('uiTheme')).resolves.toBeUndefined()
  })

  it('leaves a file with nothing to clean untouched', async() => {
    const store = await context({ theme: 'nord', autoSave: false })

    await store.setStoredPreferences({ fontSize: 18 })
    await store.flushStoredPreferences()

    expect(calls).not.toContain('prune_json_file')
    expect(disk).toEqual({ theme: 'nord', autoSave: false, fontSize: 18 })
  })

  it('writes the queued keys before rewriting the file', async() => {
    const store = await context({ theme: 'light', uiTheme: 'graphite' })

    await store.setStoredPreferences({ fontSize: 18 })
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(calls).toContain('prune_json_file'))

    expect(calls.indexOf('merge_json_file')).toBeLessThan(calls.indexOf('prune_json_file'))
    expect(disk).toEqual({ theme: 'light', fontSize: 18 })
  })

  it('keeps saving preferences when the cleanup fails', async() => {
    const store = await context({ theme: 'nord', uiTheme: 'graphite' })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    invoke.mockImplementation(async(command: string, args: Bag) => {
      calls.push(command)
      if (command === 'path_exists') return true
      if (command === 'read_file') return JSON.stringify(disk)
      if (command === 'merge_json_file') {
        Object.assign(disk, clone(args.patch ?? {}))
        return
      }
      if (command === 'prune_json_file') throw new Error('locked')
    })

    await store.setStoredPreferences({ autoSave: true })
    await store.flushStoredPreferences()

    await expect(store.setStoredPreferences({ fontSize: 20 })).resolves.toBeTypeOf('number')
    await store.flushStoredPreferences()
    expect(disk.autoSave).toBe(true)
    expect(disk.fontSize).toBe(20)
    expect(logged).toHaveBeenCalledWith(
      '[tauri-bridge] cannot prune /data/preferences.json:',
      expect.any(Error)
    )
  })

  it('waits for the cleanup before letting the window close', async() => {
    const pending = deferred()
    invoke.mockImplementation(async(command: string, _args: Bag) => {
      calls.push(command)
      if (command === 'path_exists') return true
      if (command === 'read_file') return JSON.stringify(disk)
      if (command === 'merge_json_file') return
      if (command === 'prune_json_file') return pending.promise
    })
    const store = await context({ theme: 'nord', uiTheme: 'graphite' })

    await store.setStoredPreferences({ autoSave: true })
    let closed = false
    const closing = store.flushStoredPreferences().then(() => { closed = true })
    await vi.advanceTimersByTimeAsync(400)
    expect(closed).toBe(false)

    pending.release()
    await closing
    expect(closed).toBe(true)
  })
})

describe('cleaning a file written before the single theme', () => {
  it('drops the old keys without inventing a theme', async() => {
    const store = await context({
      uiTheme: 'graphite',
      mdTheme: 'nord',
      followSystemTheme: true,
      lightModeTheme: 'light',
      darkModeTheme: 'one-dark',
      autoSave: true
    })

    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(calls).toContain('prune_json_file'))

    expect(disk).toEqual({ autoSave: true })
    await expect(store.getStoredPreference('theme')).resolves.toBeUndefined()
  })

  it('keeps the theme the file already stores', async() => {
    const store = await context({ theme: 'dracula', uiTheme: 'graphite', autoSave: true })
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()

    expect(disk).toEqual({ theme: 'dracula', autoSave: true })
    await expect(store.getStoredPreference('theme')).resolves.toBe('dracula')
  })

  it('ignores what an older build left in localStorage', async() => {
    localStorage.setItem('mt-tauri-theme-choice', 'nord')
    localStorage.setItem('mt-tauri-theme-pair', JSON.stringify({ ui: 'graphite', md: 'nord' }))

    const store = await context({ autoSave: true })
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()

    expect(disk).toEqual({ autoSave: true })
    await expect(store.getStoredPreference('theme')).resolves.toBeUndefined()
  })

  it('never touches the user-data file', async() => {
    const store = await context({ uiTheme: 'graphite', autoSave: true }, { recent: [] })
    await store.sendStoredUserData(() => undefined)
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(calls).toContain('prune_json_file'))

    expect(userData).toEqual({ recent: [] })
    expect(pruned).toEqual(['/data/preferences.json'])
  })
})
