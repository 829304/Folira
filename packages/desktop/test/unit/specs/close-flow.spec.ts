import type { UnsavedFilesRequest } from '@/tauri-bridge/save'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const destroy = vi.fn()
const saveDialog = vi.fn()
let nativeClose: (event: { preventDefault: () => void }) => unknown
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy,
    onCloseRequested: (handler: typeof nativeClose) => { nativeClose = handler; return Promise.resolve(() => {}) }
  })
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: (...args: unknown[]) => saveDialog(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ emit: () => Promise.resolve() }))
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))

const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

async function boot(saved = false, pathname = '') {
  vi.resetModules()
  Object.assign(window, { path: { sep: '/', dirname: (path: string) => path } })
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const jobs: Promise<void>[] = []
  const bridge = await import('@/tauri-bridge/window')
  const bus = (await import('@/bus')).default
  const snapshots = vi.fn().mockResolvedValue(undefined)
  Object.assign(window, {
    electron: {
      clipboard: { writeText: vi.fn() },
      ipcRenderer: {
        on: (name: string, handler: (...args: unknown[]) => void) => handlers.set(name, handler),
        invoke: snapshots,
        send: (name: string, ...args: unknown[]) => {
          if (name === 'mt::close-window') jobs.push(bridge.closeWindow())
          if (name === 'mt::close-window-confirm') jobs.push(bridge.closeWindowConfirm(args[0] as Parameters<typeof bridge.closeWindowConfirm>[0], dispatch))
        }
      }
    }
  })
  const dispatch = (name: string, args: unknown[]) => handlers.get(name)?.({}, ...args)
  const store = (await import('@/store/editor')).useEditorStore()
  const preferences = (await import('@/store/preferences')).usePreferencesStore()
  const file = {
    id: 'a',
    filename: 'a.md',
    pathname,
    markdown: '# draft\n',
    isSaved: saved,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 1,
    history: { stack: [], lastEditIndex: -1 },
    cursor: null,
    scrollTop: 0,
    muyaIndexCursor: 0,
    selected: true,
    notifications: []
  }
  store.tabs = [file] as unknown as typeof store.tabs
  store.currentFile = store.tabs[0]
  store.LISTEN_FOR_CLOSE()
  bridge.installCloseGuard(dispatch, 'editor')
  const preventDefault = vi.fn()
  const close = async() => {
    nativeClose({ preventDefault })
    await vi.waitFor(() => expect(jobs).toHaveLength(1))
    await jobs[0]
  }
  return { store, preferences, bus, close, preventDefault, snapshots }
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined)
  destroy.mockReset().mockResolvedValue(undefined)
  saveDialog.mockReset().mockResolvedValue('/docs/new.md')
})
afterEach(() => { vi.useRealTimers() })

describe('native close through the editor store and real close bridge', () => {
  it.each(['', '/docs/a.md'])('asks about unsaved content at path %j under restoreAll', async(pathname) => {
    const app = await boot(false, pathname)
    expect(app.preferences.startUpAction).toBe('restoreAll')
    const ask = vi.fn((request: unknown) => (request as UnsavedFilesRequest).respond('cancel'))
    app.bus.on('unsaved-files::ask', ask)
    await app.close()
    expect(app.preventDefault).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledOnce()
    expect((ask.mock.calls[0][0] as UnsavedFilesRequest).files).toMatchObject([{ markdown: '# draft\n', pathname }])
    expect(destroy).not.toHaveBeenCalled()
  })

  it('keeps the native window after a real save failure', async() => {
    const app = await boot(false, '/docs/a.md')
    app.bus.on('unsaved-files::ask', (request) => (request as UnsavedFilesRequest).respond('save'))
    invoke.mockImplementation((command: string) => command === 'write_file' ? Promise.reject(new Error('disk full')) : Promise.resolve())
    await app.close()
    expect(invoke).toHaveBeenCalledWith('write_file', expect.objectContaining({ path: '/docs/a.md' }))
    expect(destroy).not.toHaveBeenCalled()
  })

  it('keeps the window when the draft save dialog is cancelled', async() => {
    const app = await boot()
    app.bus.on('unsaved-files::ask', (request) => (request as UnsavedFilesRequest).respond('save'))
    saveDialog.mockResolvedValue(null)
    await app.close()
    expect(destroy).not.toHaveBeenCalled()
    expect(invoke.mock.calls.some(([command]) => command === 'write_file')).toBe(false)
  })

  it('waits for saving before destroying the native window', async() => {
    const app = await boot(false, '/docs/a.md')
    app.bus.on('unsaved-files::ask', (request) => (request as UnsavedFilesRequest).respond('save'))
    const write = deferred()
    invoke.mockImplementation((command: string) => command === 'write_file' ? write.promise : Promise.resolve())
    const closing = app.close()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('write_file', expect.anything()))
    expect(destroy).not.toHaveBeenCalled()
    write.release()
    await closing
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('commits a pending edit before deciding that all tabs are saved', async() => {
    const app = await boot(true)
    app.bus.on('flush-active-editor', () => {
      app.store.tabs[0].markdown = 'last keystroke'
      app.store.tabs[0].isSaved = false
    })
    const ask = vi.fn((request: unknown) => (request as UnsavedFilesRequest).respond('cancel'))
    app.bus.on('unsaved-files::ask', ask)
    await app.close()
    expect(ask).toHaveBeenCalledOnce()
    expect(destroy).not.toHaveBeenCalled()
  })

  it('closes clean documents without asking', async() => {
    const app = await boot(true, '/docs/a.md')
    const ask = vi.fn()
    app.bus.on('unsaved-files::ask', ask)
    await app.close()
    expect(ask).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
    expect(app.snapshots).toHaveBeenCalledWith('update-buffer-state', expect.anything())
  })
})
