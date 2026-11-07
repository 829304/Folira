import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as WindowBridge from '../../../src/renderer/src/tauri-bridge/window'

// `requestClose` keeps the close handshake from stacking questions. It also has
// to survive a question nobody answers — the window would be unclosable for the
// rest of the session.
const spies = vi.hoisted(() => ({
  invoke: vi.fn(async() => undefined),
  listeners: new Map<string, unknown>(),
  onCloseRequested: vi.fn(async() => () => undefined),
  destroy: vi.fn(async() => undefined)
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: spies.invoke }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: spies.onCloseRequested, destroy: spies.destroy })
}))
vi.mock('../../../src/renderer/src/tauri-bridge/preferences', () => ({
  flushStoredPreferences: vi.fn(async() => undefined)
}))
vi.mock('../../../src/renderer/src/tauri-bridge/save', () => ({
  askAboutUnsavedFiles: vi.fn(async() => 'cancel'),
  saveDocument: vi.fn(async() => '/note.md')
}))

const loadWindow = async(): Promise<typeof WindowBridge> =>
  await import('../../../src/renderer/src/tauri-bridge/window')

describe('requestClose', () => {
  beforeEach(() => {
    // `asking` and `closeConfirmed` are module state: re-import for each case so
    // a latched flag from the previous scenario cannot mask the next one.
    vi.resetModules()
    vi.clearAllMocks()
    spies.invoke.mockImplementation(async() => undefined)
    spies.listeners.clear()
  })

  it('asks again after a question nobody answered', async() => {
    const { requestClose } = await loadWindow()
    const dispatch = vi.fn(() => 0)

    requestClose(dispatch)
    requestClose(dispatch)

    // The first question had no listener; the latch has to come off, or the
    // second request is swallowed and the window can never be closed.
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(spies.invoke).toHaveBeenCalledWith('cancel_quit')
  })

  it('lowers the latch when a handler throws', async() => {
    const { requestClose } = await loadWindow()
    const failing = vi.fn(() => {
      throw new Error('editor store is not listening yet')
    })
    const dispatch = vi.fn(() => 1)

    expect(() => requestClose(failing)).toThrow('editor store is not listening yet')
    requestClose(dispatch)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(spies.invoke).toHaveBeenCalledWith('cancel_quit')
  })

  it('lets the editor give the question back', async() => {
    const { abandonCloseRequest, requestClose } = await loadWindow()
    const dispatch = vi.fn(() => 1)

    requestClose(dispatch)
    requestClose(dispatch)
    expect(dispatch).toHaveBeenCalledTimes(1)

    // The editor could not work out what to ask about and says so on its own
    // channel; the next close request has to ask again rather than be vetoed
    // for the rest of the session.
    abandonCloseRequest()
    requestClose(dispatch)

    expect(dispatch).toHaveBeenCalledTimes(2)
  })
  it('keeps the latch while the question is still open', async() => {
    const { requestClose } = await loadWindow()
    const dispatch = vi.fn(() => 1)

    requestClose(dispatch)
    requestClose(dispatch)

    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
