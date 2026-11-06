// Window close, in place of the Electron main process's close handling
// (src/main/app/windowManager.ts + the `mt::close-window-confirm` branch of
// src/main/menu/actions/file.ts).
//
// Electron let the main process veto a close and ask the renderer first. Tauri
// exposes the same veto to JS through `onCloseRequested`, so the whole
// handshake lives here: intercept the close, ask the renderer over
// `mt::ask-for-close`, and let it come back with `mt::close-window` (nothing
// unsaved) or `mt::close-window-confirm` (a list of documents to deal with).

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { clearTrackedOpenFiles } from './open-files'
import { flushStoredPreferences } from './preferences'
import {
  askAboutUnsavedFiles,
  saveDocument,
  type DispatchLocal,
  type UnsavedFile
} from './save'

// Set only once the window is about to be destroyed, so every close request
// that arrives before that is still vetoed.
let closeConfirmed = false

// The close that is already under way. A second request during the flush must
// wait for it rather than start over.
let closing: Promise<void> | null = null

// True between asking the editor about unsaved tabs and the answer coming back.
// Without it two close requests — a double click on the title bar, or the taskbar
// menu while the first dialog is up — each ask again, and the editor stacks a
// second save dialog on top of the unanswered one.
let asking = false

const flushAndDestroy = (): Promise<void> => {
  closing ??= (async() => {
    clearTrackedOpenFiles()
    await writePendingPreferences()
    await rememberWindowState()
    // A request that lands between the flush and this line would otherwise
    // destroy the window without ever seeing the destroyed flag set.
    closeConfirmed = true
    await getCurrentWindow().destroy()
  })().catch(async(err) => {
    // A failed destroy leaves the window alive; forgetting the attempt lets the
    // next close request try again instead of being vetoed forever — including
    // `closeConfirmed`, which otherwise makes the guard wave the next native
    // close straight through without asking about the tabs edited since.
    closing = null
    asking = false
    closeConfirmed = false
    await cancelQuit()
    throw err
  })

  return closing
}

/**
 * Ask the editor about unsaved tabs, once.
 *
 * Every close entry point has to come through here — the title-bar request, the
 * File menu, the command palette. Two of them used to dispatch the question
 * straight to the renderer, so a second request while the first dialog was still
 * open stacked another one and orphaned the first answer.
 */
export const requestClose = (dispatchLocal: DispatchLocal): void => {
  if (closeConfirmed || closing || asking) return

  asking = true
  try {
    // Nothing answers during start-up: the guard is installed before the Vue
    // app registers `mt::ask-for-close`, and a quit that lands in that window
    // would otherwise latch `asking` and make the window unclosable.
    if (dispatchLocal('mt::ask-for-close', []) === 0) abandonRequest()
  } catch (err) {
    // A handler that throws never replies either.
    abandonRequest()
    throw err
  }
}

/**
 * Give up on a question nobody answered.
 *
 * `asking` stays true until the renderer replies, so an unanswered request has
 * to lower it — and tell Rust the quit it may have started is off — or every
 * later close is vetoed forever.
 */
export const abandonCloseRequest = (): void => {
  asking = false
  cancelQuit().catch((err) => console.warn('[tauri-bridge] cannot cancel the pending quit:', err))
}

const abandonRequest = abandonCloseRequest

/**
 * Only the editor answers `mt::ask-for-close` — it is the editor store that
 * collects unsaved tabs and replies. Guarding any other window would veto its
 * close and wait for an answer that never comes, so the settings window closes
 * the ordinary way — after writing the preferences it still owes to disk.
 */
export const installCloseGuard = (dispatchLocal: DispatchLocal, windowType: string): void => {
  if (windowType !== 'editor') {
    getCurrentWindow()
      .onCloseRequested(async(event) => {
        if (closeConfirmed) return
        // Veto first, then flush: a second request while the write is in flight
        // would otherwise let Tauri destroy the window with the patch unsent.
        event.preventDefault()
        await flushAndDestroy()
      })
      .catch((err) => console.warn('[tauri-bridge] cannot guard window close:', err))
    return
  }

  getCurrentWindow()
    .onCloseRequested((event) => {
      if (closeConfirmed) return
      event.preventDefault()
      // The renderer is already flushing a close it agreed to; asking again
      // would reopen the save dialog on a window that is on its way out.
      if (closing) return
      requestClose(dispatchLocal)
    })
    .catch((err) => console.warn('[tauri-bridge] cannot guard window close:', err))
}

/** Never let a failed write keep a window open: the close was the user's idea. */
const writePendingPreferences = async(): Promise<void> => {
  try {
    await flushStoredPreferences()
  } catch (err) {
    console.error('[tauri-bridge] cannot write the pending preferences:', err)
  }
}

/**
 * Store the window rectangle before it goes away.
 *
 * `destroy()` does not raise `CloseRequested`, so the Rust hook that saves on
 * the way out is skipped; by the time `RunEvent::Exit` runs there is nothing
 * left to measure and a maximised window would come back as the last
 * free-floating rectangle. Best-effort: a failed save is cosmetic.
 */
const rememberWindowState = async(): Promise<void> => {
  try {
    await invoke('remember_window_state')
  } catch (err) {
    console.warn('[tauri-bridge] cannot save the window state:', err)
  }
}

export const closeWindow = async(): Promise<void> => {
  await flushAndDestroy()
}

/**
 * Tell Rust the quit was abandoned.
 *
 * The application menu closes the editor on the way out and remembers that a
 * quit is pending. If the user keeps the window, that memory has to go, or the
 * next plain close of the editor would also close the settings window and end
 * the process.
 */
const cancelQuit = async(): Promise<void> => {
  try {
    await invoke('cancel_quit')
  } catch (err) {
    console.warn('[tauri-bridge] cannot cancel the pending quit:', err)
  }
}

/**
 * Close with unsaved documents on the table.
 *
 * Diverges from Electron on one point: if a save fails or its dialog is
 * dismissed, the window stays open. Upstream closed anyway, which discards the
 * very edits the user just chose to keep — and the tab has already been told
 * about the failure over `mt::tab-save-failure`, so there is something to act on.
 */
export const closeWindowConfirm = async(
  files: UnsavedFile[],
  dispatchLocal: DispatchLocal
): Promise<void> => {
  try {
    const choice = await askAboutUnsavedFiles(files)
    if (choice === 'cancel') {
      // The window stays open, so the next close request has to ask again.
      asking = false
      await cancelQuit()
      return
    }

    if (choice === 'save') {
      const written = await Promise.all(files.map((file) => saveDocument(file, dispatchLocal)))
      if (written.some((path) => path === null)) {
        asking = false
        await cancelQuit()
        return
      }
    }

    await closeWindow()
  } catch (err) {
    // A rejected dialog or write must not leave the window permanently
    // unclosable: the next request gets to ask again.
    asking = false
    await cancelQuit()
    throw err
  }
}
