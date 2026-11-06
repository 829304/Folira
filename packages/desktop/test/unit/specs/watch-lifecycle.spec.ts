import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedMarkdown } from '@/tauri-bridge/markdown-file'
const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
const document = (markdown: string): LoadedMarkdown => ({
  markdown,
  pathname: '/docs/a.md',
  filename: 'a.md',
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 0,
  isMixedLineEndings: false
})
const deferred = <T>() => {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => { release = resolve })
  return { promise, release }
}
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  invoke.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})
const load = () => import('@/tauri-bridge/open-files')
const watchCalls = () => invoke.mock.calls.filter(([command]) => command === 'watch_open_files')

describe('watch lifecycle and queued open transport', () => {
  it('tracking the same path twice registers just one watch', async() => {
    const files = await load()
    files.trackOpenFile('/docs/a.md')
    files.trackOpenFile('/docs/a.md')
    await vi.advanceTimersByTimeAsync(200)
    expect(watchCalls()).toEqual([['watch_open_files', { paths: ['/docs/a.md'] }]])
  })

  it('ignores empty paths and removing a path that was never tracked', async() => {
    const files = await load()
    files.trackOpenFile(null)
    files.trackOpenFile(undefined)
    files.trackOpenFile('')
    files.untrackOpenFile('/docs/missing.md')
    await vi.advanceTimersByTimeAsync(200)
    expect(watchCalls()).toEqual([])
  })

  it('closing the last tab before the debounce leaves no file watched', async() => {
    const files = await load()
    files.trackOpenFile('/docs/a.md')
    files.untrackOpenFile('/docs/a.md')
    await vi.advanceTimersByTimeAsync(200)
    expect(watchCalls()).toEqual([['watch_open_files', { paths: [] }]])
  })

  it('clearing a burst of tabs sends only the final empty watch set', async() => {
    const files = await load()
    files.trackOpenFile('/docs/a.md')
    files.trackOpenFile('/docs/b.md')
    files.clearTrackedOpenFiles()
    files.clearTrackedOpenFiles()
    await vi.advanceTimersByTimeAsync(200)
    expect(watchCalls()).toEqual([['watch_open_files', { paths: [] }]])
  })

  it('can rearm after a native watch registration failure', async() => {
    const files = await load()
    invoke.mockRejectedValueOnce(new Error('watch unavailable')).mockResolvedValue(undefined)
    files.trackOpenFile('/docs/a.md')
    await vi.advanceTimersByTimeAsync(200)
    files.trackOpenFile('/docs/b.md')
    await vi.advanceTimersByTimeAsync(200)
    expect(watchCalls().at(-1)).toEqual(['watch_open_files', { paths: ['/docs/a.md', '/docs/b.md'] }])
  })

  it('ignores subsequent disk events for a closed path', async() => {
    const files = await load()
    files.trackOpenFile('/docs/a.md')
    files.untrackOpenFile('/docs/a.md')
    const dispatch = vi.fn()
    await files.handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch, 'win32')
    expect(invoke.mock.calls.some(([name]) => name === 'read_markdown_file')).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not ask the native queue outside Tauri', async() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    const files = await load()
    await expect(files.takePendingOpenFiles()).resolves.toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('filters non-string entries from a queue response', async() => {
    const files = await load()
    invoke.mockResolvedValue(['/docs/中文.md', null, 42, '/docs/b.md'])
    await expect(files.takePendingOpenFiles()).resolves.toEqual(['/docs/中文.md', '/docs/b.md'])
  })

  it.each([null, { paths: ['a.md'] }])('treats malformed queue payload %j as empty', async(payload) => {
    const files = await load()
    invoke.mockResolvedValue(payload)
    await expect(files.takePendingOpenFiles()).resolves.toEqual([])
  })

  it('a failed queue request can be retried on the next notification', async() => {
    const files = await load()
    invoke.mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValueOnce(['/docs/a.md'])
    await expect(files.takePendingOpenFiles()).resolves.toEqual([])
    await expect(files.takePendingOpenFiles()).resolves.toEqual(['/docs/a.md'])
  })

  it('does not re-deliver files once the native queue has drained', async() => {
    const files = await load()
    invoke.mockResolvedValueOnce(['/docs/a.md', '/docs/b.md']).mockResolvedValueOnce([])
    await expect(files.takePendingOpenFiles()).resolves.toEqual(['/docs/a.md', '/docs/b.md'])
    await expect(files.takePendingOpenFiles()).resolves.toEqual([])
  })
})

// A read takes a round trip; these cover what happens when the world moves on
// during it. Both used to publish stale content into the editor.
describe('disk reads that become obsolete while pending', () => {
  it('does not publish a pending read after its tab has closed', async() => {
    const files = await load()
    const read = deferred<LoadedMarkdown>()
    let started!: () => void
    const reading = new Promise<void>((resolve) => { started = resolve })
    invoke.mockImplementation((name: string) => {
      if (name === 'read_markdown_file') { started(); return read.promise }
      return Promise.resolve(undefined)
    })
    files.trackOpenFile('/docs/a.md')
    const dispatch = vi.fn()
    const update = files.handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch, 'win32')
    await reading
    files.untrackOpenFile('/docs/a.md')
    read.release(document('obsolete'))
    await update
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not publish an older read after a newer disk change has completed', async() => {
    const files = await load()
    const read = deferred<LoadedMarkdown>()
    let started!: () => void
    const reading = new Promise<void>((resolve) => { started = resolve })
    let count = 0
    invoke.mockImplementation((name: string) => {
      if (name === 'read_markdown_file') {
        if (++count === 1) { started(); return read.promise }
        return Promise.resolve(document('newest'))
      }
      return Promise.resolve(undefined)
    })
    files.trackOpenFile('/docs/a.md')
    const dispatch = vi.fn()
    const old = files.handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch, 'win32')
    await reading
    await files.handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch, 'win32')
    read.release(document('obsolete'))
    await old
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::update-file', [{ type: 'change', change: { pathname: '/docs/a.md', data: document('newest') } }])
  })

  it('does not let a read that outlived its tab publish after the tab reopens', async() => {
    const files = await load()
    const read = deferred<LoadedMarkdown>()
    let started!: () => void
    const reading = new Promise<void>((resolve) => { started = resolve })
    let count = 0
    invoke.mockImplementation((name: string) => {
      if (name === 'read_markdown_file') {
        if (++count === 1) { started(); return read.promise }
        return Promise.resolve(document('newest'))
      }
      return Promise.resolve(undefined)
    })
    files.trackOpenFile('/docs/a.md')
    const dispatch = vi.fn()
    const pending = files.handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch, 'win32')
    await reading
    files.untrackOpenFile('/docs/a.md')
    files.trackOpenFile('/docs/a.md')
    // A change after the reopen takes a ticket of its own; the read from before
    // it must not be mistaken for that one.
    await files.handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch, 'win32')
    read.release(document('obsolete'))
    await pending
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::update-file', [{ type: 'change', change: { pathname: '/docs/a.md', data: document('newest') } }])
  })

  it('does not publish a read that was in flight when the file was unlinked', async() => {
    const files = await load()
    const read = deferred<LoadedMarkdown>()
    let started!: () => void
    const reading = new Promise<void>((resolve) => { started = resolve })
    invoke.mockImplementation((name: string) => {
      if (name === 'read_markdown_file') { started(); return read.promise }
      return Promise.resolve(undefined)
    })
    files.trackOpenFile('/docs/a.md')
    const dispatch = vi.fn()
    const pending = files.handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch, 'win32')
    await reading
    await files.handleDiskChange({ pathname: '/docs/a.md', kind: 'unlink' }, dispatch, 'win32')
    read.release(document('obsolete'))
    await pending
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::update-file', [{ type: 'unlink', change: { pathname: '/docs/a.md' } }])
  })
})
