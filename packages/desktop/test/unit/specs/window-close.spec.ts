// Closing a window, and what has to survive it.
//
// Two things the close path used to lose: a preference written in the last few
// hundred milliseconds before the settings window closed (the write is
// debounced, and the webview dies with its timer), and the editor itself, which
// could be gone while the settings window kept the process alive — a second
// launch then had nothing to focus.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const desktopDir = resolve(__dirname, '../../..')
const read = (relative: string): string => readFileSync(resolve(desktopDir, relative), 'utf-8')

const bridgeWindow = read('src/renderer/src/tauri-bridge/window.ts')
const bridgePreferences = read('src/renderer/src/tauri-bridge/preferences.ts')
const lib = read('src-tauri/src/lib.rs')
const rustWindow = read('src-tauri/src/window.rs')
const boot = read('src-tauri/src/commands/boot.rs')
const editorStore = read('src/renderer/src/store/editor.ts')

describe('closing a window', () => {
  it('writes the pending preferences before an auxiliary window goes away', () => {
    expect(bridgeWindow).toContain('flushStoredPreferences')
    const flush = bridgeWindow.indexOf('await writePendingPreferences()')
    const destroy = bridgeWindow.indexOf('await getCurrentWindow().destroy()')
    expect(flush).toBeGreaterThan(-1)
    expect(destroy).toBeGreaterThan(flush)
  })

  it('still asks the editor about unsaved files before closing it', () => {
    expect(bridgeWindow).toContain("windowType !== 'editor'")
    expect(bridgeWindow).toContain("dispatchLocal('mt::ask-for-close', [])")
  })

  it('flushes both stores, not just the preferences one', () => {
    expect(bridgePreferences).toContain('export const flushStoredPreferences')
    expect(bridgePreferences).toContain('drain(preferences)')
    expect(bridgePreferences).toContain('drain(userData)')
    // A second pass covers an edit that arrived while the first write was on
    // the wire; the close cannot be the moment the edit is lost.
    const drain = bridgePreferences.slice(bridgePreferences.indexOf('const drain ='))
    expect(drain).toContain('await flush(store)')
    expect(drain).toContain('if (Object.keys(store.pending).length > 0)')
  })

  it('stores the window rectangle before destroying the editor', () => {
    // `destroy()` raises no close request, so the Rust hook that saves on the
    // way out never runs: the flags and the rectangle have to be read while the
    // window still exists.
    const save = bridgeWindow.indexOf('await rememberWindowState()')
    const destroy = bridgeWindow.indexOf('await getCurrentWindow().destroy()', save)
    expect(save).toBeGreaterThan(-1)
    expect(destroy).toBeGreaterThan(save)
    expect(bridgeWindow).toContain("invoke('remember_window_state')")
  })

  it('rebuilds the editor when a second launch finds it closed', () => {
    expect(rustWindow).toContain('pub fn focus_or_create_editor')
    expect(rustWindow).toContain('app.get_webview_window("main")')
    // Rebuilding must not try to manage the geometry state a second time.
    expect(rustWindow).toContain('app.try_state::<Geometry>()')
    expect(lib).toContain('window::focus_or_create_editor(app)')
  })

  it('queues the new launch files instead of pushing them', () => {
    // The running process cannot answer for argv it never saw, and the rebuilt
    // window has no listener yet: the queue is what survives both, because the
    // renderer pulls it once it has registered.
    expect(lib).toContain('commands::boot::queue_open_files(paths)')
    expect(lib).toContain('commands::boot::take_pending_open_files')
    expect(boot).toContain('pub fn queue_open_files')
    expect(boot).toContain('pub fn take_pending_open_files')
    expect(boot).toContain('std::mem::take(&mut *pending)')
  })

  it('pulls the queue only after every listener is registered', () => {
    // A pull before `mt::open-new-tab` is registered would dispatch into
    // nothing and drop the documents the queue was holding, so the pull sits
    // next to the startup mark that says exactly that.
    const app = read('src/renderer/src/pages/app.vue')
    const marked = app.indexOf("markStartup('listeners registered')")
    const pull = app.indexOf('editorStore.OPEN_QUEUED_FILES()', marked)
    expect(marked).toBeGreaterThan(-1)
    expect(pull).toBeGreaterThan(marked)
    expect(editorStore).toContain('takePendingOpenFiles')
    expect(editorStore).toContain("on('mt::pending-open'")
  })
})
