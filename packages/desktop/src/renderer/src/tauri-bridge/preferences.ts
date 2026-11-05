// User preferences and user data, in place of the Electron main process's
// electron-store instances (src/main/preferences + src/main/dataCenter).
//
// Both are persisted as JSON under the user-data directory, the way
// electron-store did, so the files stay inspectable and a future Rust-side
// reader (the native menu needs `autoSave`, `theme`, …) can pick them up.
//
// Only the user's *overrides* are stored: the renderer's preferences store
// already carries the full default state and merges whatever arrives on
// `mt::user-preference` on top of it.

import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog'
import pathe from 'pathe'
import { PREFERENCES_VERSION, PREFERENCES_VERSION_KEY } from '@shared/types/preferences'

type Bag = Record<string, unknown>

interface Store {
  path: string
  values: Bag
  /** Keys merged since the last write, on their way to disk. */
  pending: Bag
  /** The in-flight read, shared by every caller so the file is read once. */
  loading: Promise<Bag> | null
  writeTimer: ReturnType<typeof setTimeout> | null
}

const createStore = (): Store => ({
  path: '',
  values: {},
  pending: {},
  loading: null,
  writeTimer: null
})

const preferences = createStore()
const userData = createStore()

/** Point both stores at the user-data directory reported by `boot_info`. */
export const initPreferenceStores = (userDataDir: string): void => {
  if (!userDataDir) {
    console.warn('[tauri-bridge] no user-data dir; preferences will not persist')
    return
  }
  preferences.path = pathe.join(userDataDir, 'preferences.json')
  userData.path = pathe.join(userDataDir, 'dataCenter.json')
}

const loadFromDisk = async(store: Store): Promise<Bag> => {
  try {
    if (await invoke('path_exists', { path: store.path })) {
      const raw = await invoke('read_file', { path: store.path, encoding: 'utf8' })
      const parsed: unknown = JSON.parse(String(raw))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Stored values fill in what is not already set. Anything written while
        // this read was in flight is newer than the file and must survive it.
        store.values = { ...(parsed as Bag), ...store.values }
      }
    }
  } catch (err) {
    // A hand-edited file with a syntax error must not stop the app from
    // starting; fall back to defaults and let the next write repair it.
    console.error(`[tauri-bridge] cannot read ${store.path}:`, err)
  }
  return store.values
}

/**
 * The stored values, reading the file at most once.
 *
 * The in-flight promise is shared rather than a `loaded` flag being set up
 * front: a flag flips before the `await` resolves, so a concurrent caller got
 * an empty bag, wrote its patch into that, and either lost the patch when the
 * read landed or — if its debounced write fired first — replaced the file with
 * the patch alone. Both happen on an ordinary launch, where the preferences
 * request and the first layout write are microseconds apart.
 */
const read = (store: Store): Promise<Bag> => {
  if (!store.path) return Promise.resolve(store.values)
  store.loading ??= loadFromDisk(store)
  return store.loading
}

// Preference edits arrive one key at a time (every toggle in the settings
// window is its own `mt::set-user-preference`), so coalesce them.
const WRITE_DELAY = 300

const scheduleWrite = (store: Store): void => {
  if (!store.path) return
  if (store.writeTimer) clearTimeout(store.writeTimer)
  store.writeTimer = setTimeout(() => {
    store.writeTimer = null
    flush(store).catch((err) => console.error(`[tauri-bridge] cannot write ${store.path}:`, err))
  }, WRITE_DELAY)
}

/**
 * Send the keys merged since the last write, and only those.
 *
 * The file is shared with every other window, so writing this window's whole
 * bag would drop whatever another window saved in the meantime — the editor
 * writes `sideBarVisibility` at startup while the settings window is writing a
 * theme, and one of them used to lose. `merge_json_file` applies the patch to
 * what is on disk, so both land.
 */
const flush = async(store: Store): Promise<void> => {
  const patch = store.pending
  if (!store.path || Object.keys(patch).length === 0) return
  store.pending = {}
  try {
    await invoke('merge_json_file', { path: store.path, patch })
  } catch (err) {
    // Keep the keys so the next edit retries them rather than dropping them.
    store.pending = { ...patch, ...store.pending }
    throw err
  }
}

const merge = async(store: Store, patch: unknown): Promise<void> => {
  if (!patch || typeof patch !== 'object') return
  await read(store)
  Object.assign(store.values, patch as Bag)
  Object.assign(store.pending, patch as Bag)
  scheduleWrite(store)
}

type DispatchLocal = (channel: string, args: unknown[]) => void

/**
 * Announce a preference change to every window.
 *
 * Electron's main process owned the preferences file and pushed each change out
 * on `mt::user-preference`, so an open editor followed along with whatever the
 * settings window did. Here each window writes the file itself, and for a long
 * time that was all it did: the theme, the font, the line height, the tab width
 * — every one of them landed on disk and changed nothing on screen until the
 * next launch. Only `language` worked, because it had been given a broadcast of
 * its own.
 *
 * A global `emit` reaches every window including this one, and `registerEvent`
 * subscribes each window's store to it, so the sender needs no local dispatch as
 * well — doing both would deliver the same patch twice.
 *
 * Not to be confused with `sendStoredPreferences` below, which answers a
 * question one window asked and is rightly local.
 */
export const announcePreferences = (patch: Record<string, unknown> | undefined): void => {
  if (!patch) return
  emit('mt::user-preference', patch).catch((err) =>
    console.warn('[tauri-bridge] cannot announce a preference change:', err)
  )
}

/**
 * Answer `mt::ask-for-user-preference` / `mt::ask-for-user-data`.
 *
 * These are the files as stored, which is the only payload that may predate the
 * two-axis split, so they travel on their own channel: the store migrates them
 * on arrival and must never do that to a patch from `announcePreferences`.
 */
export const sendStoredPreferences = async(dispatchLocal: DispatchLocal): Promise<void> => {
  dispatchLocal('mt::stored-user-preference', [await read(preferences)])
}

export const sendStoredUserData = async(dispatchLocal: DispatchLocal): Promise<void> => {
  dispatchLocal('mt::stored-user-data', [await read(userData)])
}

/**
 * Persist a preference patch.
 *
 * Every write carries the file version, so a file this build has touched can
 * always be told apart from one that predates the two-axis split.
 */
export const setStoredPreferences = (patch: unknown): Promise<void> =>
  merge(preferences, {
    [PREFERENCES_VERSION_KEY]: PREFERENCES_VERSION,
    ...(patch as Record<string, unknown>)
  })

export const setStoredUserData = (patch: unknown): Promise<void> => merge(userData, patch)

/**
 * Write whatever is still waiting out, for a window that is about to go away.
 *
 * Writes are debounced, and a window closed inside that window of time takes
 * its timer with it — the change the user just made would never be stored.
 */
export const flushStoredPreferences = async(): Promise<void> => {
  await Promise.all([flush(preferences), flush(userData)])
}

/** Read one preference without waiting for a round trip through the store. */
export const getStoredPreference = async(key: string): Promise<unknown> =>
  (await read(preferences))[key]

/**
 * Pick a folder and store it under `key`, then push the new value back so the
 * settings UI reflects it — the store learns about preference changes only
 * through `mt::user-preference`.
 *
 * `preset` short-circuits the dialog: the image-folder setting can be typed in
 * as well as browsed for, and Electron accepted both on the same channel.
 */
export const pickFolderPreference = async(
  key: string,
  dispatchLocal: DispatchLocal,
  preset?: string
): Promise<void> => {
  let chosen = preset
  if (!chosen) {
    const current = await getStoredPreference(key)
    const selected = await showOpenDialog({
      directory: true,
      defaultPath: typeof current === 'string' && current ? current : undefined
    })
    if (typeof selected !== 'string') return
    chosen = selected
  }

  await setStoredPreferences({ [key]: chosen })
  // Global: the image folder decides where the *editor* puts a pasted image, so
  // a folder picked in the settings window has to reach it.
  announcePreferences({ [key]: chosen })
}
