/**
 * OS keyboard layout and key-map shapes.
 *
 * These came from the `native-keymap` package, which the Electron main process
 * used to read the active layout so shortcuts could be normalised on non-US
 * keyboards. That package is gone with the main process; the types stay because
 * the IPC contract (`KeyboardInfo`) still describes the same wire shape, and
 * `@hfelix/electron-localshortcut`'s `setKeyboardLayout` consumes it.
 *
 * Copied verbatim from native-keymap 3.3.9 `index.d.ts`
 * (Copyright (c) Microsoft Corporation, MIT).
 */

export interface IWindowsKeyMapping {
  vkey: string
  value: string
  withShift: string
  withAltGr: string
  withShiftAltGr: string
}

export interface IWindowsKeyboardMapping {
  [code: string]: IWindowsKeyMapping
}

export interface ILinuxKeyMapping {
  value: string
  withShift: string
  withAltGr: string
  withShiftAltGr: string
}

export interface ILinuxKeyboardMapping {
  [code: string]: ILinuxKeyMapping
}

export interface IMacKeyMapping {
  value: string
  valueIsDeadKey: boolean
  withShift: string
  withShiftIsDeadKey: boolean
  withAltGr: string
  withAltGrIsDeadKey: boolean
  withShiftAltGr: string
  withShiftAltGrIsDeadKey: boolean
}

export interface IMacKeyboardMapping {
  [code: string]: IMacKeyMapping
}

export type IKeyboardMapping = IWindowsKeyboardMapping | ILinuxKeyboardMapping | IMacKeyboardMapping

export interface IWindowsKeyboardLayoutInfo {
  name: string
  id: string
  text: string
}

export interface ILinuxKeyboardLayoutInfo {
  model: string
  group: number
  layout: string
  variant: string
  options: string
  rules: string
}

export interface IMacKeyboardLayoutInfo {
  id: string
  localizedName: string
  lang: string
}

export type IKeyboardLayoutInfo =
  | IWindowsKeyboardLayoutInfo
  | ILinuxKeyboardLayoutInfo
  | IMacKeyboardLayoutInfo
