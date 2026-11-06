import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const emit = vi.fn()
const destroy = vi.fn()
let closeRequested: () => Promise<void>
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ emit: (...args: unknown[]) => emit(...args), listen: () => Promise.resolve(() => {}) }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy,
    onCloseRequested: (handler: (event: unknown) => Promise<void>) => {
      closeRequested = () => handler({ preventDefault: vi.fn() })
      return Promise.resolve(() => {})
    }
  })
}))
const deferred = <T>() => {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => { release = resolve })
  return { promise, release }
}
type Bag = Record<string, unknown>
let disk: Record<string, Bag>
async function context() {
  vi.resetModules()
  const preferences = await import('@/tauri-bridge/preferences')
  preferences.initPreferenceStores('/data')
  return preferences
}
beforeEach(() => {
  vi.useFakeTimers()
  disk = { '/data/preferences.json': { preferencesVersion: 2, autoSave: false, fontSize: 16 }, '/data/dataCenter.json': {} }
  destroy.mockReset().mockResolvedValue(undefined)
  emit.mockReset().mockResolvedValue(undefined)
  invoke.mockReset().mockImplementation(async(command: string, args: { path: string; patch?: Bag }) => {
    if (command === 'path_exists') return true
    if (command === 'read_file') return JSON.stringify(disk[args.path])
    if (command === 'merge_json_file') Object.assign(disk[args.path], args.patch)
  })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('independent preference contexts and actual close guard', () => {
  it('merges disjoint edits from two contexts without replacing the shared file', async() => {
    const editor = await context()
    const settings = await context()
    await Promise.all([editor.getStoredPreference('theme'), settings.getStoredPreference('theme')])
    await editor.setStoredPreferences({ sideBarVisibility: true })
    await settings.setStoredPreferences({ theme: 'dracula' })
    await Promise.all([editor.flushStoredPreferences(), settings.flushStoredPreferences()])
    expect(disk['/data/preferences.json']).toEqual({ preferencesVersion: 2, autoSave: false, fontSize: 16, sideBarVisibility: true, theme: 'dracula' })
  })

  it('updates both independently loaded caches through a global announcement without echo writes', async() => {
    const editor = await context()
    const settings = await context()
    await Promise.all([editor.getStoredPreference('autoSave'), settings.getStoredPreference('autoSave')])
    // The OS event bus fans out; receipt and cache mutation use production functions.
    emit.mockImplementation(async(_channel: string, patch: Bag) => {
      editor.rememberStoredPreferences(patch)
      settings.rememberStoredPreferences(patch)
    })
    await settings.setStoredPreferences({ autoSave: true })
    settings.announcePreferences({ autoSave: true })
    await settings.flushStoredPreferences()
    expect(await editor.getStoredPreference('autoSave')).toBe(true)
    expect(await settings.getStoredPreference('autoSave')).toBe(true)
    expect(disk['/data/preferences.json'].autoSave).toBe(true)
    expect(invoke.mock.calls.filter(([name]) => name === 'merge_json_file')).toHaveLength(1)
  })

  it('does not let an older disk read overwrite an announced cache value', async() => {
    const store = await context()
    const read = deferred<string>()
    invoke.mockImplementation((command: string) => command === 'path_exists' ? Promise.resolve(true) : read.promise)
    const loading = store.getStoredPreference('autoSave')
    store.rememberStoredPreferences({ autoSave: true })
    read.release(JSON.stringify({ autoSave: false }))
    expect(await loading).toBe(true)
  })

  it('drains both preference files before the auxiliary window is destroyed', async() => {
    const store = await context()
    const windowBridge = await import('@/tauri-bridge/window')
    await store.setStoredPreferences({ fontSize: 20 })
    await store.setStoredUserData({ recentFiles: ['a.md'] })
    const writes = [deferred<void>(), deferred<void>()]
    const base = invoke.getMockImplementation()
    if (!base) throw new Error('missing IPC boundary')
    invoke.mockImplementation((command: string, args: { path: string; patch?: Bag }) => {
      if (command === 'merge_json_file') {
        const index = args.path.endsWith('preferences.json') ? 0 : 1
        return writes[index].promise.then(() => base(command, args))
      }
      return base(command, args)
    })
    windowBridge.installCloseGuard(vi.fn(), 'settings')
    const closing = closeRequested()
    expect(destroy).not.toHaveBeenCalled()
    writes[0].release()
    await Promise.resolve()
    expect(destroy).not.toHaveBeenCalled()
    writes[1].release()
    await closing
    expect(disk['/data/preferences.json'].fontSize).toBe(20)
    expect(disk['/data/dataCenter.json'].recentFiles).toEqual(['a.md'])
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('persists edits arriving while the close is waiting for an earlier write', async() => {
    const store = await context()
    const windowBridge = await import('@/tauri-bridge/window')
    const first = deferred<void>()
    const base = invoke.getMockImplementation()
    if (!base) throw new Error('missing IPC boundary')
    let count = 0
    invoke.mockImplementation((command: string, args: { path: string; patch?: Bag }) => {
      if (command === 'merge_json_file' && ++count === 1) return first.promise.then(() => base(command, args))
      return base(command, args)
    })
    await store.setStoredPreferences({ fontSize: 18 })
    const writing = store.flushStoredPreferences()
    windowBridge.installCloseGuard(vi.fn(), 'settings')
    const closing = closeRequested()
    await store.setStoredPreferences({ fontSize: 24 })
    first.release()
    await Promise.all([writing, closing])
    expect(disk['/data/preferences.json'].fontSize).toBe(24)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('the real menu command toggles the latest preference announced by another context', async() => {
    const store = await context()
    await store.getStoredPreference('autoSave')
    store.rememberStoredPreferences({ autoSave: true })
    const { installTauriBridgeSync } = await import('@/tauri-bridge')
    installTauriBridgeSync()
    window.electron.ipcRenderer.send('mt::cmd-toggle-autosave')
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('mt::user-preference', { autoSave: false }))
    await store.flushStoredPreferences()
    expect(disk['/data/preferences.json'].autoSave).toBe(false)
  })
})
