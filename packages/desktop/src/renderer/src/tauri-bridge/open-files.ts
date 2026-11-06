// Reloading a document that changed on disk, in place of the Electron main
// process's per-file chokidar watch (`WatchType.file` in
// src/main/filesystem/watcher.ts).
//
// The Rust side reports only that a path changed; the document is built here,
// where opening a file already builds one. Duplicating that in Rust would mean
// two implementations of the same thing, free to drift.

import { invoke } from '@tauri-apps/api/core'

import { loadMarkdownFile, type LoadedMarkdown } from './markdown-file'
import type { DispatchLocal } from './save'
import { isTauri } from '@/util/isTauri'

/** Paths behind open tabs. The Rust watch is re-armed whenever this changes. */
const openPaths = new Set<string>()

// Reading a file takes a round trip, and the world moves on during it: the tab
// can close, a second change can finish reading first, or the file can go away.
// Each read claims a ticket and only publishes while its ticket is still the one
// on file, so an older read cannot overwrite newer content.
const readTickets = new Map<string, number>()

// One counter for the whole process, never per path: a tab that closes and
// reopens while a read is in flight would otherwise hand the old read a ticket
// that matches the new one.
let readTicketSequence = 0

const claimReadTicket = (pathname: string): number => {
  const ticket = ++readTicketSequence
  readTickets.set(pathname, ticket)
  return ticket
}

let syncTimer: ReturnType<typeof setTimeout> | null = null

// Opening a folder of documents adds paths one at a time; re-arming the watch
// for each would ask Rust to rebuild the whole set repeatedly.
const SYNC_DELAY = 200

const syncWatch = (): void => {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    invoke('watch_open_files', { paths: [...openPaths] }).catch((err) =>
      console.warn('[tauri-bridge] cannot watch open files:', err)
    )
  }, SYNC_DELAY)
}

export const trackOpenFile = (pathname: string | null | undefined): void => {
  if (!pathname || openPaths.has(pathname)) return
  openPaths.add(pathname)
  syncWatch()
}

/**
 * Take the files another launch queued, newest batch first.
 *
 * Rust cannot push them: the editor window may exist while its renderer is
 * still booting, and an event delivered before `mt::open-new-tab` has a
 * listener is dropped, not replayed. Pulling after the listeners are in place
 * is the only delivery that survives that window, and it collapses a burst of
 * double-clicks into one batch.
 */
export const takePendingOpenFiles = async(): Promise<string[]> => {
  if (!isTauri()) return []
  try {
    const paths = await invoke<string[]>('take_pending_open_files')
    return Array.isArray(paths) ? paths.filter((path) => typeof path === 'string') : []
  } catch (err) {
    console.warn('[tauri-bridge] cannot take the queued files:', err)
    return []
  }
}

export const untrackOpenFile = (pathname: string | null | undefined): void => {
  if (!pathname || !openPaths.delete(pathname)) return
  readTickets.delete(pathname)
  syncWatch()
}

/** The paths being watched, for a caller that may have to put them back. */
export const trackedOpenFiles = (): string[] => [...openPaths]

/**
 * Watch the given paths again.
 *
 * A window that fails to go away is still in use, so the watchers it dropped on
 * the way out have to come back; without them external edits and deletions stop
 * reaching the editor even though the window is alive.
 */
export const restoreTrackedOpenFiles = (paths: string[]): void => {
  let added = false
  for (const pathname of paths) {
    if (openPaths.has(pathname)) continue
    openPaths.add(pathname)
    added = true
  }
  if (added) syncWatch()
}
export const clearTrackedOpenFiles = (): void => {
  if (openPaths.size === 0) return
  openPaths.clear()
  readTickets.clear()
  syncWatch()
}

interface DiskChange {
  pathname: string
  kind: 'change' | 'unlink'
}

/**
 * Turn a disk-change signal into the `mt::update-file` payload the editor
 * store expects.
 *
 * The store compares the incoming markdown against the tab's own before it
 * warns, so a save the editor itself performed — or a checkout that left the
 * bytes identical — passes through without bothering anyone. That comparison
 * needs the content, which is why the file is read here rather than merely
 * announced.
 */
export const handleDiskChange = async(
  payload: unknown,
  dispatchLocal: DispatchLocal,
  platform: string
): Promise<void> => {
  const { pathname, kind } = (payload ?? {}) as Partial<DiskChange>
  if (!pathname || !openPaths.has(pathname)) return

  if (kind === 'unlink') {
    // Forgetting the ticket aborts any read still in flight: its content
    // describes a file that no longer exists.
    readTickets.delete(pathname)
    dispatchLocal('mt::update-file', [{ type: 'unlink', change: { pathname } }])
    return
  }

  // Claim the ticket before the read starts: a change that arrives while this
  // one is in flight takes a later ticket and wins.
  const ticket = claimReadTicket(pathname)

  let document: LoadedMarkdown
  try {
    document = await loadMarkdownFile(pathname, platform)
  } catch {
    // Removed between the event and the read; the unlink event is on its way.
    return
  }

  // The tab may have closed, or a later change may have published already.
  // Either way this content is stale and must not reach the editor.
  if (!openPaths.has(pathname) || readTickets.get(pathname) !== ticket) return

  // The whole document. `loadChange` in the editor store reads the encoding and
  // line ending off this payload, so sending only the text reset both to
  // undefined every time a file changed underneath an open tab.
  dispatchLocal('mt::update-file', [
    { type: 'change', change: { pathname, data: document } }
  ])
}
