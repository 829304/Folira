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
const bridgeIndex = read('src/renderer/src/tauri-bridge/index.ts')
const bridgePreferences = read('src/renderer/src/tauri-bridge/preferences.ts')
const lib = read('src-tauri/src/lib.rs')
const rustWindow = read('src-tauri/src/window.rs')
const menu = read('src-tauri/src/menu/mod.rs')
const dispatch = read('src-tauri/src/menu/dispatch.rs')
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

  it('vetoes every close request until the last one actually destroys', () => {
    // The first request starts the close and then waits on the write; a second
    // request in that window must still be vetoed. Returning without
    // `preventDefault()` let Tauri destroy the webview with the patch unsent.
    expect(bridgeWindow).toContain('closing ??=')
    const flush = bridgeWindow.indexOf('await writePendingPreferences()')
    const confirmed = bridgeWindow.indexOf('closeConfirmed = true')
    const destroy = bridgeWindow.indexOf('await getCurrentWindow().destroy()')
    expect(confirmed).toBeGreaterThan(flush)
    expect(destroy).toBeGreaterThan(confirmed)
  })

  it('still asks the editor about unsaved files before closing it', () => {
    expect(bridgeWindow).toContain("windowType !== 'editor'")
    expect(bridgeWindow).toContain("dispatchLocal('mt::ask-for-close', [])")
  })

  it('asks once at a time, so a double close cannot stack dialogs', () => {
    // Two close requests before the first answer used to dispatch the question
    // twice, and the editor stacked a second save dialog over the unanswered
    // one. Every entry point goes through one guard now.
    expect(bridgeWindow).toContain('export const requestClose')
    const guard = bridgeWindow.slice(bridgeWindow.indexOf('export const requestClose'))
    expect(guard).toContain('if (closeConfirmed || closing || asking) return')
    expect(guard.indexOf('asking = true')).toBeLessThan(
      guard.indexOf("dispatchLocal('mt::ask-for-close', [])")
    )
    // The menu and the command palette used to dispatch straight to the
    // renderer, which bypassed the flag entirely.
    expect(bridgeIndex).toContain("case 'mt::app-try-quit':")
    expect(bridgeIndex).toContain("case 'mt::cmd-close-window':")
    expect(bridgeIndex.match(/requestClose\(dispatchLocal\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(bridgeIndex).not.toContain("dispatchLocal('mt::ask-for-close', [])")
    // Keeping the window has to forget a pending quit, otherwise the next plain
    // close of the editor would also close the settings window.
    expect(bridgeWindow).toContain("invoke('cancel_quit')")
    const cancelBranch = bridgeWindow.slice(bridgeWindow.indexOf('export const closeWindowConfirm'))
    expect(cancelBranch.match(/await cancelQuit\(\)/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('lets the app menu hand its quit to the editor', () => {
    // A predefined Quit maps to macOS `terminate:`, which tears the windows down
    // without a close request: the renderer's guard never runs and unsaved drafts
    // vanish. The custom item runs the same close handshake a title-bar click
    // takes, then finishes with whatever windows are left.
    expect(menu).not.toContain('PredefinedMenuItem::quit')
    expect(menu).toContain('"app:quit"')
    expect(dispatch).toContain('crate::window::quit_request(app)')
    expect(rustWindow).toContain('pub fn quit_request<R: Runtime>(app: &AppHandle<R>)')
    expect(rustWindow).toContain('pub fn finish_quit<R: Runtime>')
    expect(lib).toContain('window::finish_quit(&window.app_handle().clone(), window.label())')
    // Not every quit reaches `RunEvent::ExitRequested`; the one that does still
    // goes through the editor when there is one.
    expect(lib).toContain('window::veto_exit(app)')
    expect(lib).toContain('api.prevent_exit()')
    expect(rustWindow).toContain('let _ = editor.unminimize();')
    // The abandoned quit is cleared from the renderer, and the remaining
    // windows are closed on a later tick so two windows are never torn down
    // from inside one event callback.
    expect(rustWindow).toContain('pub fn cancel_quit()')
    expect(lib).toContain('window::cancel_quit')
    expect(rustWindow).toContain('app.run_on_main_thread(move || close_other_windows(&handle))')
    // The exit hook shares the quit flow instead of closing the editor on its
    // own, and only an app with no windows left may leave.
    expect(rustWindow).toContain('QUIT_REQUESTED.store(true, Ordering::SeqCst);')
    expect(rustWindow).toContain('if app.webview_windows().is_empty()')
    // A failed destroy has to lower closeConfirmed again, or the next native
    // close is waved through without asking about the tabs edited since.
    expect(bridgeWindow).toContain('closeConfirmed = false')
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

  it('hands the startup files out once and only to the editor', () => {
    // The rebuild asks for boot info again; re-reading argv there reopened the
    // files this launch started with, and the second launch's files then came
    // from the queue, so both ended up open.
    expect(boot).toContain('fn take_once(slot: &Mutex<Option<Vec<String>>>)')
    expect(boot).toContain('window_type.as_deref().unwrap_or("editor") == "editor"')
    const bridge = read('src/renderer/src/tauri-bridge/index.ts')
    expect(bridge).toContain("invoke('boot_info', { windowType })")
  })
})
