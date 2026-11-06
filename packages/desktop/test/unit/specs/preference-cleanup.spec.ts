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

const USER_DATA = '/data/dataCenter.json'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  disk = {}
  userData = {}
  exists = true
  calls.length = 0
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
    // leftover default the pair-era builds no longer updated.
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

    expect(disk).toEqual({ theme: 'nord', autoSave: true })
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
    expect(disk).toEqual({ theme: 'graphite', fontSize: 18 })
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

describe('migrating a file that asked to follow the system', () => {
  const original = window.matchMedia

  afterEach(() => {
    Object.assign(window, { matchMedia: original })
  })

  it('writes the theme the old file was showing before dropping its keys', async() => {
    Object.assign(window, {
      matchMedia: (query: string) => ({ matches: query.includes('dark'), media: query })
    })
    const store = await context({
      theme: 'light',
      followSystemTheme: true,
      lightModeTheme: 'light',
      darkModeTheme: 'one-dark'
    })

    // Reading the file is what notices the legacy keys on a real launch.
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(calls).toContain('prune_json_file'))

    expect(disk).toEqual({ theme: 'one-dark' })
    await expect(store.getStoredPreference('theme')).resolves.toBe('one-dark')
  })
})

describe('upgrading a profile written before the single theme', () => {
  const original = window.matchMedia

  afterEach(() => {
    Object.assign(window, { matchMedia: original })
  })

  const systemAppearance = (dark: boolean) => ({
    matchMedia: (query: string) => ({ matches: dark && query.includes('dark'), media: query })
  })

  it('keeps the theme the old menu remembered when the file has none', async() => {
    Object.assign(window, systemAppearance(false))
    localStorage.setItem('mt-tauri-theme-choice', 'nord')

    const store = await context({ autoSave: true })
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(disk.theme).toBe('nord'))

    await expect(store.getStoredPreference('theme')).resolves.toBe('nord')
  })

  it('reads a recorded follow-the-system choice as the system appearance', async() => {
    Object.assign(window, systemAppearance(true))
    localStorage.setItem('mt-tauri-theme-choice', 'system')

    const store = await context({ autoSave: true })
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(disk.theme).toBe('dark'))
  })

  it('does not invent a theme for a fresh install', async() => {
    exists = false

    const store = await context({})
    await store.getStoredPreference('autoSave')
    await vi.waitFor(() => expect(calls).toContain('path_exists'))

    expect(disk.theme).toBeUndefined()
  })

  it('restores the remembered choice when the file is missing', async() => {
    exists = false
    localStorage.setItem('mt-tauri-theme-choice', 'dracula')

    const store = await context({})
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(disk.theme).toBe('dracula'))

    await expect(store.getStoredPreference('theme')).resolves.toBe('dracula')
  })

  it('never writes the theme into the user-data file', async() => {
    Object.assign(window, systemAppearance(false))
    localStorage.setItem('mt-tauri-theme-choice', 'nord')

    const store = await context({ autoSave: true }, { recent: [] })
    await store.sendStoredUserData(() => undefined)
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(disk.theme).toBe('nord'))

    expect(userData).toEqual({ recent: [] })
  })

  it('migrates a residue that only asked to follow the system', async() => {
    Object.assign(window, systemAppearance(true))

    const store = await context({ theme: 'system', autoSave: true })
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()

    await expect(store.getStoredPreference('theme')).resolves.toBe('dark')
    await vi.waitFor(() => expect(disk.theme).toBe('dark'))
  })

  it('falls back to the remembered choice when the old keys name no theme', async() => {
    localStorage.setItem('mt-tauri-theme-choice', 'dracula')

    const store = await context({ preferencesVersion: 2, autoSave: true })
    await store.getStoredPreference('autoSave')
    await store.flushStoredPreferences()

    await expect(store.getStoredPreference('theme')).resolves.toBe('dracula')
    await vi.waitFor(() => expect(disk.theme).toBe('dracula'))
  })
})
