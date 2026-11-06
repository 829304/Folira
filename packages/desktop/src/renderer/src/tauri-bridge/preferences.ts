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

type Bag = Record<string, unknown>

interface Store {
  path: string
  values: Bag
  /** Keys merged since the last write, on their way to disk. */
  pending: Bag
  /** When each pending key was queued, in ms since the epoch. */
  pendingAt: Record<string, number>
  /** The in-flight read, shared by every caller so the file is read once. */
  loading: Promise<Bag> | null
  writeTimer: ReturnType<typeof setTimeout> | null
  /** The write in flight, so a close waits for it instead of racing it. */
  writing: Promise<void> | null
}

const createStore = (): Store => ({
  path: '',
  values: {},
  pending: {},
  pendingAt: {},
  loading: null,
  writeTimer: null,
  writing: null
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
 *
 * Writes are chained: `flushStoredPreferences` is called from a close handler
 * and must wait for the write already on the wire, or the window goes away
 * underneath it.
 */
const flush = async(store: Store): Promise<void> => {
  if (!store.path) return
  // A write from a moment ago is still in flight: let it land, then look at
  // whatever is pending now.
  if (store.writing) await store.writing

  const patch = store.pending
  if (Object.keys(patch).length === 0) return
  const queuedAt = store.pendingAt
  store.pending = {}
  store.pendingAt = {}

  const write = invoke('merge_json_file', { path: store.path, patch })
  const settled = write.then(
    () => undefined,
    () => undefined
  )
  store.writing = settled
  try {
    await write
  } catch (err) {
    // Keep the keys so the next edit retries them rather than dropping them.
    store.pending = { ...patch, ...store.pending }
    store.pendingAt = { ...queuedAt, ...store.pendingAt }
    throw err
  } finally {
    if (store.writing === settled) store.writing = null
  }
}

/**
 * Record a patch without waiting for the file.
 *
 * The debounced write fires 300 ms later, but the keys count as pending the
 * moment they are merged: a window closed inside that delay still has to write
 * them, and `flushStoredPreferences` looks at `pending`. Registering before the
 * `await` is what makes the close safe — waiting for the read first left the
 * keys in flight while the close handler saw an empty bag and destroyed the
 * webview.
 */
const merge = async(store: Store, patch: unknown, at: number): Promise<void> => {
  if (!patch || typeof patch !== 'object') return
  const bag = patch as Bag
  Object.assign(store.values, bag)
  Object.assign(store.pending, bag)
  Object.keys(bag).forEach((key) => {
    store.pendingAt[key] = at
  })
  scheduleWrite(store)
  // The read fills in the keys this window has not touched; anything merged
  // above wins, because `loadFromDisk` spreads the stored file under `values`.
  await read(store)
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
 *
 * The stamp travels with the patch: a window hearing its own echo back has to
 * tell that echo from a newer change by another window, and values cannot say
 * it — an array survives IPC as a fresh object with the same content.
 */
export const announcePreferences = (
  patch: Record<string, unknown> | undefined,
  at = Date.now()
): void => {
  if (!patch) return
  emit('mt::user-preference', { patch, at }).catch((err) =>
    console.warn('[tauri-bridge] cannot announce a preference change:', err)
  )
}

/**
 * Answer `mt::ask-for-user-preference` / `mt::ask-for-user-data`.
 *
 * These are the files as stored, for a window that has not read them yet; a
 * patch from `announcePreferences` carries one edit and travels on a channel of
 * its own so the store can tell the two apart.
 */
export const sendStoredPreferences = async(dispatchLocal: DispatchLocal): Promise<void> => {
  dispatchLocal('mt::stored-user-preference', [await read(preferences)])
}

export const sendStoredUserData = async(dispatchLocal: DispatchLocal): Promise<void> => {
  dispatchLocal('mt::stored-user-data', [await read(userData)])
}

/**
 * Merge a local edit and report the time it was queued at, so the caller can
 * announce it with the same stamp it was stored under.
 */
export const setStoredPreferences = (patch: unknown): Promise<number> => {
  const at = Date.now()
  return merge(preferences, patch, at).then(() => at)
}

export const setStoredUserData = (patch: unknown): Promise<number> => {
  const at = Date.now()
  return merge(userData, patch, at).then(() => at)
}

/**
 * Write whatever is still waiting out, for a window that is about to go away.
 *
 * Writes are debounced, and a window closed inside that window of time takes
 * its timer with it — the change the user just made would never be stored. A
 * second pass covers the edit that arrived while the first write was in flight.
 */
export const flushStoredPreferences = async(): Promise<void> => {
  await Promise.all([drain(preferences), drain(userData)])
}

const drain = async(store: Store): Promise<void> => {
  await flush(store)
  if (Object.keys(store.pending).length > 0) await flush(store)
}

/**
 * Record values another window announced.
 *
 * `getStoredPreference` answers from this window's copy of the file, which only
 * knows the keys this window wrote. A menu toggle asks for the current value
 * and then flips it, so without this an editor that started with `autoSave:
 * false` kept answering `false` after the settings window turned it on — and
 * the first click wrote `true` again instead of turning it off.
 */
export const rememberStoredPreferences = (patch: unknown, at?: number): void => {
  if (!patch || typeof patch !== 'object') return
  const announced = patch as Bag

  // A key queued before the announcement is stale: writing it later would put
  // the older value back after the newer one had already landed. Only a stamp
  // can tell that apart — the sender's own echo carries the same value, and an
  // array comes back from IPC as a different object with equal content, so a
  // value or reference comparison either drops a live edit or keeps a dead one.
  // A write already on the wire cannot be recalled.
  if (typeof at === 'number') {
    Object.keys(announced).forEach((key) => {
      const queuedAt = preferences.pendingAt[key]
      if (queuedAt !== undefined && at > queuedAt) {
        delete preferences.pending[key]
        delete preferences.pendingAt[key]
      }
    })
  }

  Object.assign(preferences.values, announced)
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

  const at = await setStoredPreferences({ [key]: chosen })
  // Global: the image folder decides where the *editor* puts a pasted image, so
  // a folder picked in the settings window has to reach it.
  announcePreferences({ [key]: chosen }, at)
}
