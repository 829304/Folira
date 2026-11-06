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
const calls: string[] = []

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  disk = {}
  calls.length = 0
  emit.mockReset().mockResolvedValue(undefined)
  invoke.mockReset().mockImplementation(async(command: string, args: Bag) => {
    calls.push(command)
    if (command === 'path_exists') return true
    if (command === 'read_file') return JSON.stringify(disk)
    if (command === 'merge_json_file') {
      Object.assign(disk, clone(args.patch ?? {}))
      return
    }
    if (command === 'prune_json_file') {
      for (const key of args.keys as string[]) delete disk[key]
    }
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function context(data: Bag) {
  disk = data
  const store = await import('@/tauri-bridge/preferences')
  store.initPreferenceStores('/data')
  return store
}

describe('cleaning preferences a previous build wrote', () => {
  it('removes the old theme pair from the file', async() => {
    const store = await context({
      theme: 'nord',
      uiTheme: 'graphite',
      mdTheme: 'light',
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
    const store = await context({ theme: 'nord', uiTheme: 'graphite' })

    await store.setStoredPreferences({ fontSize: 18 })
    await store.flushStoredPreferences()
    await vi.waitFor(() => expect(calls).toContain('prune_json_file'))

    expect(calls.indexOf('merge_json_file')).toBeLessThan(calls.indexOf('prune_json_file'))
    expect(disk).toEqual({ theme: 'nord', fontSize: 18 })
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
    invoke.mockImplementation(async(command: string, args: Bag) => {
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
