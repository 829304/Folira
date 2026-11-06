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
  /** Failed writes since the last success, so a stuck file is not retried forever. */
  failures: number
}

const createStore = (): Store => ({
  path: '',
  values: {},
  pending: {},
  pendingAt: {},
  loading: null,
  writeTimer: null,
  writing: null,
  failures: 0
})

const preferences = createStore()
const userData = createStore()

/**
 * Identifies this window in an announcement.
 *
 * Two windows can stamp the same millisecond, and a stamp alone cannot then say
 * which edit was later. The sender's id can, and it costs nothing: each window
 * runs its own copy of this module.
 */
const WINDOW_ID = Math.random().toString(36).slice(2)

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
/** How often a failed write retries before it waits for the next edit. */
const WRITE_RETRIES = 3

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
    store.failures = 0
  } catch (err) {
    // Keep the keys so the next edit retries them rather than dropping them.
    store.pending = { ...patch, ...store.pending }
    store.pendingAt = { ...queuedAt, ...store.pendingAt }
    // Retry a few times on our own: the announcement has already taken these
    // keys away from the other windows, so leaving them parked until the next
    // unrelated edit (or the close handler) is the only copy going stale.
    store.failures += 1
    if (store.failures < WRITE_RETRIES) scheduleWrite(store)
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
  emit('mt::user-preference', { patch, at, from: WINDOW_ID }).catch((err) =>
    console.warn('[tauri-bridge] cannot announce a preference change:', err)
  )
}

/**
 * Announce a change to `dataCenter.json`.
 *
 * A separate channel, because the two files are cached separately: replaying a
 * data key into the preferences cache would answer `getStoredPreference` with a
 * value the preferences file does not have.
 */
export const announceUserData = (
  patch: Record<string, unknown> | undefined,
  at = Date.now()
): void => {
  if (!patch) return
  emit('mt::user-data', { patch, at, from: WINDOW_ID }).catch((err) =>
    console.warn('[tauri-bridge] cannot announce a user-data change:', err)
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
  // Both files must be attempted: `Promise.all` would stop at the first
  // rejection and let the close handler destroy the window while the other
  // drain is still waiting on a write.
  await Promise.allSettled([drain(preferences), drain(userData)])
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
export const rememberStoredPreferences = (
  patch: unknown,
  at?: number,
  from?: string
): Record<string, unknown> => {
  if (!patch || typeof patch !== 'object') return {}
  const announced = patch as Bag
  const accepted: Bag = {}

  Object.keys(announced).forEach((key) => {
    const queuedAt = preferences.pendingAt[key]

    // A key this window queued *after* the announcement must keep its value and
    // its queue entry; writing the announced one over it would show an older
    // value in this session while disk gets the newer one. An own echo carries
    // the same stamp and the same value, so it is adopted and its queue entry
    // stays.
    if (typeof at === 'number' && queuedAt !== undefined && at < queuedAt) return

    // The announcement wins the queue entry when it is strictly newer, or when
    // it carries the same millisecond from another window — a stamp alone
    // cannot order those two, and the later writer would otherwise be whoever
    // reaches the file last.
    if (
      typeof at === 'number' &&
      queuedAt !== undefined &&
      (at > queuedAt || (at === queuedAt && from !== undefined && from !== WINDOW_ID))
    ) {
      delete preferences.pending[key]
      delete preferences.pendingAt[key]
    }

    accepted[key] = announced[key]
  })

  Object.assign(preferences.values, accepted)
  return accepted
}

/**
 * Record a `dataCenter.json` change another window announced.
 *
 * Data keys never go through the preferences cache, so there is one store to
 * update and no queue here: the file is written by whichever window made the
 * change, and a stale cache only affects the current session.
 */
export const rememberStoredUserData = (patch: unknown): void => {
  if (!patch || typeof patch !== 'object') return
  Object.assign(userData.values, patch as Bag)
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
