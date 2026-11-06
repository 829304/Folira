import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const invoke = vi.fn()
const ask = vi.fn()
const save = vi.fn()
const open = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask, save, open }))
const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  Object.assign(window, { path: { sep: '/' }, electron: { ipcRenderer: { send: vi.fn(), on: vi.fn() } } })
  invoke.mockReset().mockResolvedValue(false)
  ask.mockReset().mockResolvedValue(false)
  save.mockReset().mockResolvedValue(null)
  open.mockReset().mockResolvedValue(null)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
async function load() {
  const files = await import('@/tauri-bridge/files')
  const watches = await import('@/tauri-bridge/open-files')
  watches.trackOpenFile('/docs/old.md')
  await vi.advanceTimersByTimeAsync(200)
  return { ...files, ...watches }
}
const watched = () => invoke.mock.calls.filter(([command]) => command === 'watch_open_files').at(-1)?.[1].paths
const rename = { id: 'a', pathname: '/docs/old.md', newPathname: '/docs/new.md' }

describe('rename and move preserve tab and watch identity', () => {
  it('cancelling replacement leaves the original file and watch intact', async() => {
    const files = await load()
    invoke.mockResolvedValue(true)
    const dispatch = vi.fn()
    await files.renameOpenFile(rename, dispatch)
    expect(ask).toHaveBeenCalledOnce()
    expect(invoke.mock.calls.some(([command]) => command === 'move_path')).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    expect(watched()).toEqual(['/docs/old.md'])
  })

  it('replaces only after explicit confirmation and follows the new path', async() => {
    const files = await load()
    invoke.mockResolvedValue(true)
    ask.mockResolvedValue(true)
    const dispatch = vi.fn()
    await files.renameOpenFile(rename, dispatch)
    await vi.advanceTimersByTimeAsync(200)
    expect(invoke).toHaveBeenCalledWith('move_path', { src: rename.pathname, dest: rename.newPathname })
    expect(dispatch).toHaveBeenCalledWith('mt::set-pathname', [{ id: 'a', pathname: '/docs/new.md', filename: 'new.md' }])
    expect(watched()).toEqual(['/docs/new.md'])
  })

  it.each(['rename', 'move'] as const)('%s failure keeps the old watch and reports an error', async(action) => {
    const files = await load()
    save.mockResolvedValue('/docs/new.md')
    invoke.mockImplementation((command: string) => command === 'move_path'
      ? Promise.reject(new Error('permission denied'))
      : Promise.resolve(false))
    const dispatch = vi.fn()
    if (action === 'rename') await files.renameOpenFile(rename, dispatch)
    else await files.moveOpenFileTo(rename, dispatch)
    await vi.advanceTimersByTimeAsync(200)
    expect(watched()).toEqual(['/docs/old.md'])
    expect(dispatch).not.toHaveBeenCalledWith('mt::set-pathname', expect.anything())
    expect(dispatch).toHaveBeenCalledWith('mt::show-notification', [expect.objectContaining({ type: 'error', message: expect.stringContaining('permission denied') })])
  })

  it.each(['rename', 'move'] as const)('%s updates identity only after the filesystem operation completes', async(action) => {
    const files = await load()
    save.mockResolvedValue('/docs/new.md')
    const move = deferred()
    let started!: () => void
    const moving = new Promise<void>((resolve) => { started = resolve })
    invoke.mockImplementation((command: string) => {
      if (command === 'move_path') { started(); return move.promise }
      return Promise.resolve(false)
    })
    const dispatch = vi.fn()
    const task = action === 'rename' ? files.renameOpenFile(rename, dispatch) : files.moveOpenFileTo(rename, dispatch)
    await moving
    expect(dispatch).not.toHaveBeenCalled()
    expect(watched()).toEqual(['/docs/old.md'])
    move.release()
    await task
    await vi.advanceTimersByTimeAsync(200)
    expect(watched()).toEqual(['/docs/new.md'])
    expect(dispatch).toHaveBeenCalledWith('mt::set-pathname', expect.anything())
  })

  it.each([null, '/docs/old.md'])('moving to %j does not touch the filesystem or tab', async(destination) => {
    const files = await load()
    save.mockResolvedValue(destination)
    const dispatch = vi.fn()
    await files.moveOpenFileTo(rename, dispatch)
    expect(invoke.mock.calls.some(([command]) => command === 'move_path')).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('renaming to the existing name avoids both confirmation and IO', async() => {
    const files = await load()
    const dispatch = vi.fn()
    invoke.mockClear()
    await files.renameOpenFile({ ...rename, newPathname: rename.pathname }, dispatch)
    expect(invoke).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('moving a draft without a path never opens a native save dialog', async() => {
    const files = await load()
    await files.moveOpenFileTo({ id: 'a', pathname: '' }, vi.fn())
    expect(save).not.toHaveBeenCalled()
  })

  it('image selection returns the original Unicode path', async() => {
    const files = await load()
    open.mockResolvedValue('/图片/截图 1.png')
    await expect(files.askForImagePath()).resolves.toBe('/图片/截图 1.png')
    expect(open).toHaveBeenCalledWith({ filters: [expect.objectContaining({ extensions: expect.arrayContaining(['png', 'svg', 'webp']) })] })
  })

  it('cancelled image selection produces no image URL', async() => {
    const files = await load()
    await expect(files.askForImagePath()).resolves.toBe('')
  })
})
