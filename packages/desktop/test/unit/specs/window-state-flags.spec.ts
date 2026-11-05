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
    expect(window).toContain('is_on_a_monitor(app, x, y)')
    expect(window).toContain('fn is_on_a_monitor')
    // The legacy conversion is the one place that reads a physical point.
    expect(window).toContain('monitor_from_point')
  })

  it('saves while the window still exists, and again on exit', () => {
    expect(lib).toContain('WindowEvent::CloseRequested')
    expect(lib).toContain('RunEvent::Exit')
    expect(lib).toContain('window::save')
  })

  it('stores the rectangle in the unit the builder reads it back in', () => {
    // `inner_size` and `position` take logical pixels; `inner_size()` and
    // `outer_position()` report physical ones. Mixing them restores a window
    // that is the right size only at 100 % scaling.
    expect(window).toContain('scale_factor()')
    expect(window).toContain('logical')
    expect(window).toContain('fn update_bounds')
    expect(window).toContain('/ scale')
  })

  it('remembers fullscreen and the rectangle to come back to', () => {
    expect(window).toContain('fullscreen')
    expect(window).toContain('is_fullscreen')
    expect(window).toContain('set_fullscreen(')
    // The last free-floating rectangle is recorded as it changes, so quitting
    // from a maximized window still restores what the user chose.
    expect(lib).toContain('WindowEvent::Resized')
    expect(lib).toContain('WindowEvent::Moved')
    expect(lib).toContain('window::track')
  })

  it('keeps the preferences window inside the work area', () => {
    expect(window).toContain('work_area()')
    expect(window).toContain('clamp(')
  })

  it('tests the saved corner in the unit the file stores', () => {
    // `monitor_from_point` reads physical pixels; feeding it a logical corner
    // misjudges the monitor on a scaled display and can drop the position.
    const create = window.slice(window.indexOf('pub fn create('), window.indexOf('pub fn save('))
    expect(create).not.toContain('monitor_from_point(')
    expect(window).toContain('available_monitors()')
  })

  it('does not record the screen-sized rectangle a zoom reports first', () => {
    // The platform resizes the window before `is_maximized()` turns true, so
    // the free-floating rectangle would be overwritten by the maximized one.
    expect(window).toContain('fn fills_screen')
    expect(window).toContain('work_area().size')
    expect(window).toContain('if fills_screen(window, ')
  })

  it('does not record the off-screen rectangle a minimized window reports', () => {
    // Minimizing resizes the window to the taskbar's idea of a rectangle;
    // storing that would bring the editor back at the wrong size.
    const track = window.slice(window.indexOf('pub fn track('), window.indexOf('pub fn save('))
    expect(track).toContain('is_minimized')
  })

  it('still writes the state when quitting destroyed the window first', () => {
    // Quitting from the menu tears the windows down before `RunEvent::Exit`,
    // so `save` must fall back to the rectangle `track` recorded rather than
    // return early when the window is gone.
    const save = window.slice(window.indexOf('pub fn save('), window.indexOf('fn update_bounds'))
    expect(save).toContain('if let Some(window) = app.get_webview_window("main")')
    expect(save).toContain('data.window_state()')
  })

  it('follows the dev server only in a development build', () => {
    // `devUrl` stays in the packaged config; opening the settings window on it
    // would point a shipped app at a localhost page that no longer exists.
    expect(window).toContain('tauri::is_dev()')
  })

  it('does not put data inside a macOS application bundle', () => {
    // `Folira.app/Contents/MacOS/folira` is writable, but writing there breaks
    // the signature and loses the data on the next update.
    expect(paths).toContain('inside_app_bundle')
    expect(paths).toContain('extension().is_some_and(|ext| ext == "app")')
  })
})
