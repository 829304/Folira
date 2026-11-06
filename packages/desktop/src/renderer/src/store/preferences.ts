import { defineStore } from 'pinia'
import bus from '../bus'
import { setLanguage } from '../i18n'
import { rememberStoredPreferences, rememberStoredUserData } from '../tauri-bridge/preferences'

// Finite-value unions where the runtime currently constrains the field.
// We keep these as plain strings everywhere else to avoid forcing prematurely
// narrow casts on consumers that read raw values from disk.
export type EndOfLine = 'default' | 'lf' | 'crlf'
export type TitleBarStyle = 'custom' | 'native'
export type StartUpAction = 'restoreAll' | 'lastSession' | 'blank'
export type TextDirection = 'ltr' | 'rtl'
export type BulletListMarker = '*' | '+' | '-'
export type OrderListDelimiter = '.' | ')'
export type PreferHeadingStyle = 'atx' | 'setext'
export type FrontmatterType = '-' | ';' | '{' | '+'
export type SequenceTheme = 'hand' | 'simple'
export type ImageInsertAction = 'folder' | 'path' | 'upload'
export type ImageRelativeDirectoryBase = 'file' | 'root'
export type FileSortBy = 'created' | 'modified' | 'title'
export type FileSortOrder = 'asc' | 'desc'

export interface PreferencesState {
  // ----- General -----
  autoSave: boolean
  autoSaveDelay: number
  titleBarStyle: TitleBarStyle | string
  openFilesInNewWindow: boolean
  openFolderInNewWindow: boolean
  zoom: number
  hideScrollbar: boolean
  wordWrapInToc: boolean
  fileSortBy: FileSortBy | string
  fileSortOrder: FileSortOrder | string
  startUpAction: StartUpAction | string
  restoreLayoutState: boolean
  defaultDirectoryToOpen: string
  lastOpenedFolder: string
  treePathExcludePatterns: string[]
  language: string
  /**
   * Set once the stored bag has arrived, so a window can tell the pair it
   * resolved from real preferences apart from the one it painted from the URL
   * cache. Never persisted: `main.ts` seeds the store from a URL subset, and a
   * write carries one key at a time.
   */
  preferencesLoaded: boolean

  // ----- Editor / typography -----
  editorFontFamily: string
  fontSize: number
  lineHeight: number
  codeFontSize: number
  codeFontFamily: string
  codeBlockLineNumbers: boolean
  trimUnnecessaryCodeBlockEmptyLines: boolean
  wrapCodeBlocks: boolean
  editorLineWidth: string

  // ----- Markdown editing -----
  autoPairBracket: boolean
  autoPairMarkdownSyntax: boolean
  autoPairQuote: boolean
  endOfLine: EndOfLine | string
  defaultEncoding: string
  autoGuessEncoding: boolean
  autoNormalizeLineEndings: boolean

  trimTrailingNewline: number
  textDirection: TextDirection | string
  hideQuickInsertHint: boolean
  imageInsertAction: ImageInsertAction | string
  imagePreferRelativeDirectory: boolean
  imageRelativeDirectoryBase: ImageRelativeDirectoryBase | string
  imageRelativeDirectoryName: string
  hideLinkPopup: boolean
  autoCheck: boolean

  preferLooseListItem: boolean
  bulletListMarker: BulletListMarker | string
  orderListDelimiter: OrderListDelimiter | string
  preferHeadingStyle: PreferHeadingStyle | string
  tabSize: number
  listIndentation: number
  frontmatterType: FrontmatterType | string
  superSubScript: boolean
  footnote: boolean
  isHtmlEnabled: boolean
  isGitlabCompatibilityEnabled: boolean
  sequenceTheme: SequenceTheme | string
  plantumlServer: string

  theme: string
  customCss: string

  // ----- Spellchecker -----
  spellcheckerEnabled: boolean
  spellcheckerNoUnderline: boolean
  spellcheckerLanguage: string

  // ----- Side bar / tab bar visibility (persisted) -----
  sideBarVisibility: boolean
  tabBarVisibility: boolean
  sourceCodeModeEnabled: boolean
  openedFilesInSidebar: boolean

  // ----- Search -----
  searchExclusions: string[]
  searchMaxFileSize: string
  searchIncludeHidden: boolean
  searchNoIgnore: boolean
  searchFollowSymlinks: boolean

  watcherUsePolling: boolean

  // ----- Edit modes (per-window, not persisted) -----
  typewriter: boolean
  focus: boolean
  sourceCode: boolean

  // ----- User config -----
  imageFolderPath: string
  webImages: unknown[]
  cloudImages: unknown[]
  currentUploader: string
  cliScript: string
}

interface SingleSetPreferencePayload {
  type: keyof PreferencesState | string
  value: unknown
}

interface SetUserDataPayload {
  type: string
  value: unknown
}

interface ModeTogglePayload {
  type: keyof PreferencesState | 'typewriter' | 'focus' | 'sourceCode'
  checked: boolean
}

export const usePreferencesStore = defineStore('preferences', {
  state: (): PreferencesState => ({
    autoSave: false,
    autoSaveDelay: 5000,
    titleBarStyle: 'custom',
    openFilesInNewWindow: false,
    openFolderInNewWindow: false,
    zoom: 1.0,
    hideScrollbar: false,
    wordWrapInToc: false,
    fileSortBy: 'created',
    fileSortOrder: 'asc',
    startUpAction: 'restoreAll',
    restoreLayoutState: true,
    defaultDirectoryToOpen: '',
    lastOpenedFolder: '',
    treePathExcludePatterns: [],
    language: 'en',
    // Flipped by the first stored bag; see the field's note.
    preferencesLoaded: false,

    editorFontFamily: 'Open Sans',
    fontSize: 16,
    lineHeight: 1.6,
    codeFontSize: 14,
    codeFontFamily: 'DejaVu Sans Mono',
    codeBlockLineNumbers: false,
    trimUnnecessaryCodeBlockEmptyLines: true,
    wrapCodeBlocks: false,
    editorLineWidth: '',

    autoPairBracket: true,
    autoPairMarkdownSyntax: true,
    autoPairQuote: true,
    endOfLine: 'default',
    defaultEncoding: 'utf8',
    autoGuessEncoding: true,
    autoNormalizeLineEndings: false,

    trimTrailingNewline: 2,
    textDirection: 'ltr',
    hideQuickInsertHint: false,
    imageInsertAction: 'folder',
    imagePreferRelativeDirectory: false,
    imageRelativeDirectoryBase: 'file',
    imageRelativeDirectoryName: 'assets',
    hideLinkPopup: false,
    autoCheck: false,

    preferLooseListItem: true,
    bulletListMarker: '-',
    orderListDelimiter: '.',
    preferHeadingStyle: 'atx',
    tabSize: 4,
    listIndentation: 1,
    frontmatterType: '-',
    superSubScript: false,
    footnote: false,
    isHtmlEnabled: true,
    isGitlabCompatibilityEnabled: false,
    sequenceTheme: 'hand',
    plantumlServer: 'https://www.plantuml.com/plantuml',

    theme: 'light',
    customCss: '',

    spellcheckerEnabled: false,
    spellcheckerNoUnderline: false,
    spellcheckerLanguage: 'en-US',

    // Default values that are overwritten with the entries below.
    sideBarVisibility: false,
    tabBarVisibility: false,
    sourceCodeModeEnabled: false,
    openedFilesInSidebar: true,

    searchExclusions: [],
    searchMaxFileSize: '',
    searchIncludeHidden: false,
    searchNoIgnore: false,
    searchFollowSymlinks: true,

    watcherUsePolling: false,

    // --------------------------------------------------------------------------

    // Edit modes of the current window (not part of persistent settings)
    typewriter: false, // typewriter mode
    focus: false,
    sourceCode: false, // source code mode

    // user configration
    imageFolderPath: '',
    webImages: [],
    cloudImages: [],
    currentUploader: 'picgo',
    cliScript: ''
  }),

  getters: {
    getAll: (state): PreferencesState => state
  },

  actions: {
    /**
     * Apply the bag read from `preferences.json`.
     *
     * Only a stored bag means the file has been read; a broadcast patch from
     * another window must not count as the first load.
     */
    LOAD_STORED_PREFERENCES(preference: Partial<PreferencesState> | Record<string, unknown>): void {
      this.preferencesLoaded = true
      this.APPLY_PREFERENCE((preference ?? {}) as Partial<PreferencesState>)
    },

    /**
     * Apply the bag read from `dataCenter.json`.
     *
     * It shares the store fields with the preferences file (image folder, upload
     * history) but is a different file, so it is applied as it is — never merged
     * into the preferences cache.
     */
    LOAD_STORED_USER_DATA(stored: Record<string, unknown>): void {
      this.APPLY_PREFERENCE(stored as Partial<PreferencesState>)
    },

    /**
     * Apply one preference bag without touching the bridge's stored copy.
     *
     * Three sources feed the store and only one is a user change: the launch
     * URL carries throwaway values (nulls, a default `hideScrollbar`), the
     * stored files are the disk's own truth, and a broadcast patch is a real
     * edit made in another window. Only the last must reach the copy the menu
     * toggles read — syncing the others would let a launch default win over
     * what is on disk when the two are merged.
     */
    APPLY_PREFERENCE(preference: Partial<PreferencesState> | Record<string, unknown>): void {
      const oldLanguage = this.language
      const incoming = preference as Record<string, unknown>

      Object.keys(incoming).forEach((key) => {
        const value = incoming[key]
        if (
          typeof value !== 'undefined' &&
          typeof (this as unknown as Record<string, unknown>)[key] !== 'undefined'
        ) {
          ;(this as unknown as Record<string, unknown>)[key] = value
        }
      })

      // Update i18n language if language preference changed
      const lang = typeof incoming.language === 'string' ? incoming.language : undefined
      if (lang && lang !== oldLanguage) {
        setLanguage(lang)
      }
    },

    /**
     * Apply the values the window URL was opened with.
     *
     * They only exist to paint the first frame from the previous session's
     * theme; the stored file replaces all of them moments later. A missing
     * parameter arrives as `null`, and the URL carries numbers as text, so this
     * has to drop what the store would only take as a regression.
     */
    SEED_USER_PREFERENCE(startup: Partial<PreferencesState> | Record<string, unknown>): void {
      const incoming = startup as Record<string, unknown>
      const kept: Record<string, unknown> = {}

      Object.keys(incoming).forEach((key) => {
        const value = incoming[key]
        if (value === null || typeof value === 'undefined') return

        const fallback = (this as unknown as Record<string, unknown>)[key]
        if (typeof fallback === 'number') {
          const parsed = typeof value === 'string' ? Number(value) : value
          if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return
          kept[key] = parsed
          return
        }

        kept[key] = value
      })

      this.APPLY_PREFERENCE(kept)
    },

    SET_USER_PREFERENCE(
      preference: Partial<PreferencesState> | Record<string, unknown>,
      at?: number,
      from?: string
    ): void {
      const incoming = preference as Record<string, unknown>

      // Another window changed a preference. The bridge keeps its own copy of
      // the stored values to answer `getStoredPreference` without a round trip,
      // and a menu toggle reads the value it is about to flip: leaving that copy
      // behind would flip the old value back on the first click. The bridge
      // returns what it accepted, so an announcement older than a local edit
      // does not move the visible value either.
      const accepted = rememberStoredPreferences(incoming, at, from)

      this.APPLY_PREFERENCE(accepted as Partial<PreferencesState>)
    },

    SET_MODE({ type, checked }: ModeTogglePayload): void {
      ;(this as unknown as Record<string, unknown>)[type as string] = checked
    },

    TOGGLE_VIEW_MODE(entryName: keyof PreferencesState | string): void {
      const target = this as unknown as Record<string, unknown>
      target[entryName as string] = !target[entryName as string]
    },

    ASK_FOR_USER_PREFERENCE(): void {
      window.electron.ipcRenderer.send('mt::ask-for-user-preference')
      window.electron.ipcRenderer.send('mt::ask-for-user-data')

      // Three channels on purpose: the two stored files may need preparing, a
      // patch from another window never does (see LOAD_STORED_PREFERENCES).
      window.electron.ipcRenderer.on('mt::stored-user-preference', (_e, preferences) => {
        this.LOAD_STORED_PREFERENCES(preferences as Partial<PreferencesState>)
      })

      window.electron.ipcRenderer.on('mt::stored-user-data', (_e, stored) => {
        this.LOAD_STORED_USER_DATA(stored as Record<string, unknown>)
      })

      window.electron.ipcRenderer.on('mt::user-preference', (_e, message) => {
        const { patch, at, from } = message as {
          patch: Partial<PreferencesState>
          at?: number
          from?: string
        }
        this.SET_USER_PREFERENCE(patch, at, from)
      })

      // `dataCenter.json` is cached separately, so its announcement has its own
      // channel and its own store: replaying it here would put a data key into
      // the preferences cache.
      window.electron.ipcRenderer.on('mt::user-data', (_e, message) => {
        const { patch } = message as { patch: Record<string, unknown> }
        rememberStoredUserData(patch)
        // Same guard as the preference channel: a key the store does not know
        // must not appear on it through an announcement.
        this.APPLY_PREFERENCE(patch as Partial<PreferencesState>)
      })
    },

    SET_SINGLE_PREFERENCE({ type, value }: SingleSetPreferencePayload): void {
      // Update local state
      ;(this as unknown as Record<string, unknown>)[type as string] = value

      // Update i18n language if language preference changed
      if (type === 'language' && typeof value === 'string') {
        setLanguage(value)
      }

      // save to electron-store
      window.electron.ipcRenderer.send('mt::set-user-preference', { [type as string]: value })
    },

    SET_USER_DATA({ type, value }: SetUserDataPayload): void {
      window.electron.ipcRenderer.send('mt::set-user-data', { [type]: value })
    },

    SET_IMAGE_FOLDER_PATH(value?: string): void {
      window.electron.ipcRenderer.send('mt::ask-for-modify-image-folder-path', value)
    },

    SELECT_DEFAULT_DIRECTORY_TO_OPEN(): void {
      window.electron.ipcRenderer.send('mt::select-default-directory-to-open')
    },

    LISTEN_FOR_VIEW(): void {
      window.electron.ipcRenderer.on('mt::show-command-palette', () => {
        bus.emit('show-command-palette')
      })
      window.electron.ipcRenderer.on('mt::toggle-view-mode-entry', (_event, entryName) => {
        this.TOGGLE_VIEW_MODE(entryName)
        const target = this as unknown as Record<string, unknown>
        this.DISPATCH_EDITOR_VIEW_STATE({ [entryName]: target[entryName] })
      })
    },

    // Toggle a view option and notify main process to toggle menu item.
    LISTEN_TOGGLE_VIEW(): void {
      bus.on('view:toggle-view-entry', (entryName) => {
        const name = entryName as string
        this.TOGGLE_VIEW_MODE(name)
        const target = this as unknown as Record<string, unknown>
        this.DISPATCH_EDITOR_VIEW_STATE({ [name]: target[name] })
      })
    },

    DISPATCH_EDITOR_VIEW_STATE(viewState: Record<string, unknown>): void {
      const { windowId } = window.marktext?.env ?? { windowId: -1 }
      window.electron.ipcRenderer.send('mt::view-layout-changed', windowId, viewState)
    }
  }
})
