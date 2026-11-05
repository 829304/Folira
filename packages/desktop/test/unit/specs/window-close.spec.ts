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
    expect(bridgePreferences).toContain('flush(preferences)')
    expect(bridgePreferences).toContain('flush(userData)')
  })

  it('rebuilds the editor when a second launch finds it closed', () => {
    expect(rustWindow).toContain('pub fn focus_or_create_editor')
    expect(rustWindow).toContain('app.get_webview_window("main")')
    // Rebuilding must not try to manage the geometry state a second time.
    expect(rustWindow).toContain('app.try_state::<Geometry>()')
    expect(lib).toContain('window::focus_or_create_editor(app)')
  })

  it('hands the new launch its files through boot info', () => {
    // The running process cannot answer for argv it never saw, and the rebuilt
    // window would otherwise open the file the first launch named.
    expect(lib).toContain('commands::boot::hand_over_paths(paths)')
    expect(boot).toContain('pub fn hand_over_paths')
    expect(boot).toContain('std::mem::take(&mut *pending)')
  })
})
