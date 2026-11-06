import log from 'electron-log/renderer'
import RendererPaths from './node/paths'
import { parseUrlArgs } from './util/urlArgs'

let exceptionLogger: (s: unknown) => void = (s) => console.error(s)

const configureLogger = (): void => {
  const isDev = window.electron?.process?.env?.NODE_ENV === 'development'
  log.transports.console.level = isDev ? 'info' : false // mirror to window console
  exceptionLogger = log.error
}

/**
 * Check if an error is a known non-fatal CodeMirror race condition.
 * These errors occur when clicking in the editor during rapid state changes
 * and don't affect functionality - the user can simply click again.
 *
 * @param error - The error to check
 * @returns True if this is a suppressible CodeMirror error
 */
const isCodeMirrorRaceCondition = (error: Error | null | undefined): boolean => {
  if (!error || !error.stack) return false

  // CodeMirror internal error when line measurement data is unavailable during mouse click
  // This happens when the document state is out of sync with the display during rapid changes
  const isMapOnUndefined = error.message === "Cannot read properties of undefined (reading 'map')"
  const isInPrepareMeasure = error.stack.includes('prepareMeasureForLine')
  const isInCoordsChar = error.stack.includes('coordsChar') || error.stack.includes('posFromMouse')

  return isMapOnUndefined && isInPrepareMeasure && isInCoordsChar
}

const handleRendererError = (event: ErrorEvent | PromiseRejectionEvent | Event): void => {
  const errorEvent = event as ErrorEvent
  if (errorEvent.error) {
    if (isCodeMirrorRaceCondition(errorEvent.error)) {
      console.warn('Suppressed non-fatal CodeMirror race condition:', errorEvent.error.message)
      return
    }

    const { message, name, stack } = errorEvent.error
    const copy = {
      message,
      name,
      stack
    }

    exceptionLogger(errorEvent.error)

    // Pass exception to main process exception handler to show a error dialog.
    window.electron.ipcRenderer.send('mt::handle-renderer-error', copy)
  } else {
    console.error(event)
  }
}

const bootstrapRenderer = (): void => {
  // Register renderer exception handler
  window.addEventListener('error', handleRendererError)
  window.addEventListener('unhandledrejection', handleRendererError)

  const { debug, initialThemePair, initialState, userDataPath, windowId, type } = parseUrlArgs()
  // RendererPaths throws when userDataPath is missing; preserve that runtime check.
  const paths = new RendererPaths(userDataPath as string)
  const marktext = {
    initialState,
    initialThemePair,
    env: {
      debug,
      paths,
      windowId,
      type
    },
    paths
  }
  // `global` is not available in a sandboxed renderer — attach to window.
  // RendererPaths has no string index signature, so widen through `unknown`.
  window.marktext = marktext as unknown as Window['marktext']

  configureLogger()
}

export default bootstrapRenderer
