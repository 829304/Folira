import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const emit = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ emit: (...args: unknown[]) => emit(...args) }))
type Bag = Record<string, unknown>
let disk: Bag
let writes: Bag[]
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  // The tie rule compares the sender's id with this window's, so pin the draw:
  // (0.5).toString(36) gives '0.i', which makes this window 'i'.
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  disk = { fontSize: 16, treePathExcludePatterns: [] }
  writes = []
  emit.mockReset().mockResolvedValue(undefined)
  invoke.mockReset().mockImplementation(async(command: string, args: { patch?: Bag }) => {
    if (command === 'path_exists') return true
    if (command === 'read_file') return JSON.stringify(disk)
    if (command === 'merge_json_file') {
      const patch = clone(args.patch ?? {})
      writes.push(patch)
      Object.assign(disk, patch)
    }
  })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
async function context() {
  const store = await import('@/tauri-bridge/preferences')
  store.initPreferenceStores('/data')
  return store
}

// Decode the real wire payload at the OS boundary. Legacy broadcasts were bare
// patches; stamped broadcasts carry { patch, at }. Never treat the envelope as a preference.
function echoAt(index: number): { patch: Bag; at?: number } {
  const wire = clone(emit.mock.calls[index][1]) as Bag
  if (wire.patch && typeof wire.patch === 'object') return { patch: wire.patch as Bag, at: wire.at as number }
  return { patch: wire }
}
describe('serialized preference echoes must not discard local writes', () => {
  it('a scalar own echo still persists exactly once (control)', async() => {
    const store = await context()
    const at = await store.setStoredPreferences({ fontSize: 24 })
    store.announcePreferences({ fontSize: 24 }, at)
    const echo = echoAt(0)
    store.rememberStoredPreferences(echo.patch, echo.at)
    await store.flushStoredPreferences()
    expect(disk.fontSize).toBe(24)
    expect(writes).toEqual([{ fontSize: 24 }])
  })

  it.each(['debounce', 'close flush'])('a serialized array own echo survives %s', async(completion) => {
    const store = await context()
    const patch = { treePathExcludePatterns: ['node_modules'] }
    const at = await store.setStoredPreferences(patch)
    store.announcePreferences(patch, at)
    const echo = echoAt(0)
    expect(echo.patch.treePathExcludePatterns).not.toBe(patch.treePathExcludePatterns)
    store.rememberStoredPreferences(echo.patch, echo.at)
    expect(await store.getStoredPreference('treePathExcludePatterns')).toEqual(['node_modules'])
    if (completion === 'debounce') await vi.advanceTimersByTimeAsync(300)
    else await store.flushStoredPreferences()
    expect(disk.treePathExcludePatterns).toEqual(['node_modules'])
    expect(writes).toEqual([{ treePathExcludePatterns: ['node_modules'] }])
  })

  it('an older echo after two edits during slow loading cannot erase the newest pending patch', async() => {
    const store = await context()
    let release!: (value: string) => void
    const read = new Promise<string>((resolve) => { release = resolve })
    const boundary = invoke.getMockImplementation()
    if (!boundary) throw new Error('missing filesystem boundary')
    invoke.mockImplementation((command: string, args: { patch?: Bag }) => command === 'read_file'
      ? read
      : boundary(command, args))

    // Same sequence as handleSend: merge immediately, announce after initial read.
    const first = store.setStoredPreferences({ fontSize: 18 }).then(at => store.announcePreferences({ fontSize: 18 }, at))
    vi.setSystemTime(Date.now() + 1)
    const second = store.setStoredPreferences({ fontSize: 24 }).then(at => store.announcePreferences({ fontSize: 24 }, at))
    expect(emit).not.toHaveBeenCalled()
    release(JSON.stringify(disk))
    await Promise.all([first, second])
    expect([echoAt(0).patch, echoAt(1).patch]).toEqual([{ fontSize: 18 }, { fontSize: 24 }])
    for (const index of [0, 1]) {
      const echo = echoAt(index)
      store.rememberStoredPreferences(echo.patch, echo.at)
    }
    await store.flushStoredPreferences()
    expect(await store.getStoredPreference('fontSize')).toBe(24)
    expect(disk.fontSize).toBe(24)
    expect(writes).toEqual([{ fontSize: 24 }])
  })
})

describe('ordering ties and the data channel', () => {
  it('treats a same-millisecond announcement from the larger id as later', async() => {
    const store = await context()
    const at = await store.setStoredPreferences({ fontSize: 24 })
    // This window is 'i', so 'j' is the side that wins a tie.
    store.rememberStoredPreferences({ fontSize: 18 }, at, 'j')
    await store.flushStoredPreferences()
    // The other window won the tie, so this one must not write its own value.
    expect(writes).toEqual([])
    expect(await store.getStoredPreference('fontSize')).toBe(18)
  })

  it('keeps its own copy of a same-millisecond tie when it has the larger id', async() => {
    const store = await context()
    const at = await store.setStoredPreferences({ fontSize: 24 })
    // Exactly one side may yield, or both windows would drop their queued value
    // and the file would keep the older one.
    store.rememberStoredPreferences({ fontSize: 18 }, at, 'h')
    await store.flushStoredPreferences()
    expect(await store.getStoredPreference('fontSize')).toBe(24)
    expect(writes).toEqual([{ fontSize: 24 }])
    expect(disk.fontSize).toBe(24)
  })

  it('keeps the local value when an older announcement arrives', async() => {
    const store = await context()
    const at = await store.setStoredPreferences({ fontSize: 24 })
    store.rememberStoredPreferences({ fontSize: 18 }, at - 5, 'another-window')
    // Disk and the visible copy both come from the newer local edit.
    expect(await store.getStoredPreference('fontSize')).toBe(24)
    await store.flushStoredPreferences()
    expect(disk.fontSize).toBe(24)
    expect(writes).toEqual([{ fontSize: 24 }])
  })

  it('does not adopt its own echo after losing the tie', async() => {
    const store = await context()
    const at = await store.setStoredPreferences({ fontSize: 24 })
    // 'j' wins the same-stamp tie, so its value is the one on disk.
    store.rememberStoredPreferences({ fontSize: 18 }, at, 'j')
    // Our own echo still says 24 under the same stamp; adopting it would put the
    // losing value back on screen while the file keeps 18.
    const accepted = store.rememberStoredPreferences({ fontSize: 24 }, at, 'i')
    expect(accepted).toEqual({})
    expect(await store.getStoredPreference('fontSize')).toBe(18)
  })

  it('adopts the echo of the write that follows a lost tie', async() => {
    // Losing a tie must not leave the key permanently deaf to its own echoes: a
    // later local write takes a new stamp and its echo has to reach the store
    // again, or every menu toggle after one tie would go unseen.
    const store = await context()
    const lost = await store.setStoredPreferences({ fontSize: 24 })
    store.rememberStoredPreferences({ fontSize: 18 }, lost, 'j')
    const next = await store.setStoredPreferences({ fontSize: 20 })
    const accepted = store.rememberStoredPreferences({ fontSize: 20 }, next, 'i')
    expect(accepted).toEqual({ fontSize: 20 })
    expect(await store.getStoredPreference('fontSize')).toBe(20)
  })

  it('adopts its own echo so the sender sees the change', async() => {
    const store = await context()
    const at = await store.setStoredPreferences({ autoSave: true })
    // Menu toggles and folder pickers write through the bridge and never
    // dispatch locally, so the sender learns the new value only from this echo.
    // A same-stamp echo from this very window must therefore reach the store,
    // even though it is not "newer" than what the queue already carried.
    const accepted = store.rememberStoredPreferences({ autoSave: true }, at, 'i')
    expect(accepted).toEqual({ autoSave: true })
    await store.flushStoredPreferences()
    expect(writes).toEqual([{ autoSave: true }])
  })

  it('announces a data change on its own channel', async() => {
    const store = await context()
    store.announceUserData({ cliScript: '/bin/up' }, Date.now())
    expect(emit).toHaveBeenCalledTimes(1)
    const [channel, message] = emit.mock.calls[0] as [string, Bag]
    expect(channel).toBe('mt::user-data')
    expect(message.patch).toEqual({ cliScript: '/bin/up' })
  })
})
