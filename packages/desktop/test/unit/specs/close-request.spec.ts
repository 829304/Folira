// What happens when the window is asked to close.
//
// The store, not the dialog, decides whether to prompt at all: if it sends
// `mt::close-window` straight away there is no dialog to answer, and whatever
// was unsaved is gone. That decision used to consult `startUpAction` — skipping
// the prompt for `restoreAll` on the assumption that the tabs would come back —
// but this build drops `update-buffer-state`, so they do not. The cases below
// drive the whole action (`mt::ask-for-close` → `flush` → `sendBufferedState` →
// send) rather than only the dialog that follows it.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const sent: [string, ...unknown[]][] = []
const handlers = new Map<string, (...args: unknown[]) => void>()

// `@/store/editor` reads `window.path.sep` at module load (normally injected by
// the preload bridge) and calls into `window.electron.ipcRenderer` at runtime.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
        }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

// The snapshot write is not what these cases are about; resolving at once keeps
// the promise chain in `LISTEN_FOR_CLOSE` observable with `flushPromises`.
vi.mock('@/store/bufferedState', () => ({
  sendBufferedState: () => Promise.resolve(),
  debouncedSendBufferedState: () => {}
}))

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

const UTF8 = { encoding: 'utf8', isBom: false }

const tab = (isSaved: boolean, pathname = '') => ({
  id: 'draft',
  filename: pathname ? 'note.md' : 'draft.md',
  pathname,
  markdown: '# draft\n',
  isSaved,
  encoding: UTF8,
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 3,
  history: {},
  cursor: null,
  scrollTop: 0,
  muyaIndexCursor: 0,
  selected: true,
  notifications: [],
  disableInlineRenderer: false,
  disableHtml: false
})

const closeWith = async(isSaved: boolean, startUpAction?: string, pathname = '') => {
  sent.length = 0
  const store = useEditorStore()
  store.tabs = [tab(isSaved, pathname)] as unknown as typeof store.tabs
  const preferences = usePreferencesStore()
  if (startUpAction) preferences.startUpAction = startUpAction as never

  store.LISTEN_FOR_CLOSE()
  const handler = handlers.get('mt::ask-for-close')
  expect(handler, 'the store never registered the close handler').toBeTypeOf('function')
  handler?.()
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))
  return sent.map(([channel]) => channel)
}

describe('closing the window with the default startup settings', () => {
  beforeEach(() => {
    sent.length = 0
    handlers.clear()
    setActivePinia(createPinia())
    ;(window.electron.ipcRenderer as unknown as {
      send: (channel: string, ...a: unknown[]) => void
      on: (channel: string, fn: (...a: unknown[]) => void) => void
    }).send = (channel: string, ...args: unknown[]) => {
      sent.push([channel, ...args])
    }
    ;(window.electron.ipcRenderer as unknown as {
      on: (channel: string, fn: (...a: unknown[]) => void) => void
    }).on = (channel: string, fn: (...a: unknown[]) => void) => handlers.set(channel, fn)
  })

  it('asks about an unsaved draft even though restoreAll is the default', async() => {
    // The default really is `restoreAll`; the case would pass trivially if the
    // store were left on something else.
    expect(usePreferencesStore().startUpAction).toBe('restoreAll')

    const channels = await closeWith(false, 'restoreAll')

    expect(channels).toContain('mt::close-window-confirm')
    expect(channels, 'a close without a prompt loses the draft').not.toContain('mt::close-window')
  })

  it('asks about an unsaved file that already has a path', async() => {
    const channels = await closeWith(false, 'restoreAll', '/docs/note.md')
    expect(channels).toContain('mt::close-window-confirm')
  })

  it('closes straight away when every tab is saved', async() => {
    const channels = await closeWith(true, 'restoreAll')

    expect(channels).toContain('mt::close-window')
    expect(channels).not.toContain('mt::close-window-confirm')
  })
})
