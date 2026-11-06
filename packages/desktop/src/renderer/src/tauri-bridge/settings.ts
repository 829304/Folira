// The preferences window and the language handshake, in place of the Electron
// main process's `_openSettingsWindow` and its language broadcast
// (src/main/app/index.ts).
//
// Preferences live at the `/preference` route of the same bundle; the router
// picks it whenever the `type` URL argument is anything but `editor`. So this
// opens a second Tauri window onto the same `index.html` with `type=settings`,
// exactly as the Electron build built its URL.

import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'

import type { DispatchLocal } from './save'
import { getStoredPreference } from './preferences'
import { resolveInitialTheme } from './theme'

/**
 * Open the preferences window, or focus it and switch tabs if it is already up.
 *
 * The window is built in Rust (`window::open_settings_window`) rather than from
 * here, because it has to share the editor's WebView2 data directory; see that
 * command for what a default one does to a green install.
 *
 * `category` selects a tab; the Electron build encoded it as `type=settings/x`
 * and pushed `settings::change-tab` at an existing window, and both paths are
 * kept so the renderer's callers are unchanged.
 */
export const openSettingsWindow = async(
  category: string | null,
  userDataPath: string
): Promise<void> => {
  const params = new URLSearchParams({
    type: category ? `settings/${category}` : 'settings',
    wid: '2',
    udp: userDataPath || '/tmp',
    th: resolveInitialTheme(),
    debug: '0',
    hsb: '0',
    tbs: 'custom'
  })

  await invoke('open_settings_window', { url: `index.html?${params.toString()}` })
  // A cross-window push: the bridge's local bus only reaches this window.
  await emit('settings::change-tab', category)
}

/**
 * Answer `mt::get-current-language`.
 *
 * The renderer asks once at startup and then follows `language-changed`. The
 * stored preference wins; `bootLocale` is the OS language the Rust side already
 * resolved to an available translation.
 */
export const sendCurrentLanguage = async(
  dispatchLocal: DispatchLocal,
  bootLocale: string
): Promise<void> => {
  const stored = await getStoredPreference('language')
  dispatchLocal('mt::current-language', [typeof stored === 'string' ? stored : bootLocale])
}

/** Tell every window the language changed — both of them run their own i18n. */
export const broadcastLanguage = (language: string): void => {
  emit('language-changed', language).catch((err) =>
    console.warn('[tauri-bridge] cannot broadcast the language change:', err)
  )
}
