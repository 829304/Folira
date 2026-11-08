import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFileDrop, installWindowEvents } from '@/tauri-bridge/window-events'

type DropPayload = { type: 'enter' | 'drop'; paths: string[] } | { type: 'leave' }
const listeners = {
  resize: () => {},
  focus: (_event: { payload: boolean }) => {},
  drop: (_event: { payload: DropPayload }) => {}
}
const native = {
  isMaximized: vi.fn(),
  isFullscreen: vi.fn(),
  onResized: async(handler: typeof listeners.resize) => { listeners.resize = handler },
  onFocusChanged: async(handler: typeof listeners.focus) => { listeners.focus = handler },
  onDragDropEvent: async(handler: typeof listeners.drop) => { listeners.drop = handler }
}
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }))

beforeEach(() => {
  vi.useFakeTimers()
  native.isMaximized.mockReset().mockResolvedValue(false)
  native.isFullscreen.mockReset().mockResolvedValue(false)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('native window notifications', () => {
  it('reports the initial maximized and fullscreen flags before the first resize', async() => {
    native.isMaximized.mockResolvedValue(true)
    const dispatch = vi.fn()
    installWindowEvents(dispatch)
    await vi.advanceTimersByTimeAsync(0)
    expect(dispatch.mock.calls).toEqual([['mt::window-maximize', []], ['mt::window-leave-full-screen', []]])
  })

  it('coalesces a resize burst and dispatches only changed flags', async() => {
    const dispatch = vi.fn()
    installWindowEvents(dispatch)
    await vi.advanceTimersByTimeAsync(0)
    dispatch.mockClear()
    native.isFullscreen.mockResolvedValue(true)
    listeners.resize()
    await vi.advanceTimersByTimeAsync(100)
    listeners.resize()
    await vi.advanceTimersByTimeAsync(119)
    expect(native.isFullscreen).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(native.isFullscreen).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::window-enter-full-screen', [])
    listeners.resize()
    await vi.advanceTimersByTimeAsync(120)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('recovers on the next resize if an initial native flag query fails', async() => {
    native.isMaximized.mockRejectedValueOnce(new Error('window not ready')).mockResolvedValue(true)
    const dispatch = vi.fn()
    installWindowEvents(dispatch)
    await vi.advanceTimersByTimeAsync(0)
    expect(dispatch).not.toHaveBeenCalled()
    listeners.resize()
    await vi.advanceTimersByTimeAsync(120)
    expect(dispatch.mock.calls).toEqual([['mt::window-maximize', []], ['mt::window-leave-full-screen', []]])
  })

  it('sends both focus transitions with the payload shape consumed by the editor', () => {
    const dispatch = vi.fn()
    installWindowEvents(dispatch)
    listeners.focus({ payload: false })
    listeners.focus({ payload: true })
    expect(dispatch.mock.calls).toEqual([
      ['mt::window-active-status', [{ status: false }]], ['mt::window-active-status', [{ status: true }]]
    ])
  })

  it('accepts files only on drop and attempts the whole batch even if one path rejects', async() => {
    const accept = vi.fn().mockRejectedValueOnce(new Error('cannot open first')).mockResolvedValue(undefined)
    installFileDrop(accept)
    const paths = ['/docs/missing.md', '/docs/中文.md']
    listeners.drop({ payload: { type: 'enter', paths } })
    listeners.drop({ payload: { type: 'leave' } })
    expect(accept).not.toHaveBeenCalled()
    listeners.drop({ payload: { type: 'drop', paths } })
    await vi.advanceTimersByTimeAsync(0)
    expect(accept.mock.calls).toEqual(paths.map(path => [path]))
  })
})
