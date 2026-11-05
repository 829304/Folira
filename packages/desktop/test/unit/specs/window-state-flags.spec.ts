// Where the window's geometry comes from now that the plugin is gone.
//
// `tauri-plugin-window-state` restored everything it could: size, position,
// decorations, visibility. Two of those break this window. It is
// `decorations: false` and draws its own title bar, so a restored
// `decorated: true` would put the OS frame back on top of ours; a restored
// `visible: false` would start the app with nothing on screen and no way to ask
// for it back. The plugin also wrote into the per-user config directory, which a
// portable install must not touch.
//
// So the app carries its own state file next to the data root. These assertions
// keep that replacement honest: every one of them fails if the geometry handling
// is swapped for the plugin's defaults.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const srcDir = resolve(__dirname, '../../../src-tauri/src')
const read = (name: string): string => readFileSync(resolve(srcDir, name), 'utf-8')

const lib = read('lib.rs')
const window = read('window.rs')
const paths = read('paths.rs')

describe('window state', () => {
  it('no longer depends on the plugin that restored everything', () => {
    expect(lib).not.toContain('tauri_plugin_window_state')

    const cargo = readFileSync(resolve(__dirname, '../../../src-tauri/Cargo.toml'), 'utf-8')
    expect(cargo).not.toContain('tauri-plugin-window-state')
  })

  it('keeps its state next to the rest of the portable data', () => {
    expect(paths).toContain('window_state')
    expect(window).toContain('window-state.json')
  })

  it('restores size, position and the maximized state', () => {
    expect(window).toContain('inner_size(')
    expect(window).toContain('.position(')
    expect(window).toContain('.maximize()')
    expect(window).toContain('maximized')
  })

  it('restores neither decorations nor visibility', () => {
    // Only the editor window is restored from state; the settings window is
    // built with fixed flags, and `.decorations(false)` there is a choice rather
    // than something the state file can flip.
    const editor = window.slice(window.indexOf('pub fn create('), window.indexOf('pub fn save('))
    expect(editor).not.toContain('.decorations(')
    expect(editor).not.toContain('.visible(')
  })

  it('only restores a position on a monitor that still exists', () => {
    // A state file can outlive the monitor it was written on.
    expect(window).toContain('monitor_from_point')
  })

  it('saves while the window still exists, and again on exit', () => {
    expect(lib).toContain('WindowEvent::CloseRequested')
    expect(lib).toContain('RunEvent::Exit')
    expect(lib).toContain('window::save')
  })
})
