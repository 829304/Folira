// The window URL, read once per window.
//
// The two blobs it carries are deliberately separate: `initialState` is what
// `main.ts` hands to the preferences store before mount, and `initialTheme` is
// only the theme the previous frame was painted with. Folding the theme into the
// state would read as a user choice and overwrite the stored one, so the split
// lives in one place instead of at each call site.

export interface UrlArgs {
  type: string | null
  debug: boolean
  userDataPath: string | null
  windowId: number
  /**
   * The theme the previous frame was painted with, cached in the window URL.
   * It is not a stored preference: the preferences file cannot be read until
   * after the first paint, so this only keeps that first frame from flashing
   * the defaults.
   */
  initialTheme: string | null
  initialState: {
    codeFontFamily: string | null
    codeFontSize: string | null
    hideScrollbar: boolean
    titleBarStyle: string | null
  }
}

export const parseUrlArgs = (): UrlArgs => {
  const params = new URLSearchParams(window.location.search)
  const codeFontFamily = params.get('cff')
  const codeFontSize = params.get('cfs')
  const debug = params.get('debug') === '1'
  const hideScrollbar = params.get('hsb') === '1'
  const theme = params.get('th')
  const titleBarStyle = params.get('tbs')
  const userDataPath = params.get('udp')
  const windowId = Number(params.get('wid'))
  const type = params.get('type')

  if (Number.isNaN(windowId)) {
    throw new Error('Error while parsing URL arguments: windowId!')
  }

  return {
    type,
    debug,
    userDataPath,
    windowId,
    initialTheme: theme,
    initialState: {
      codeFontFamily,
      codeFontSize,
      hideScrollbar,
      titleBarStyle
    }
  }
}
