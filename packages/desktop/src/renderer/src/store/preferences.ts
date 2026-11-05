import { defineStore } from 'pinia'
import { PREFERENCES_VERSION, PREFERENCES_VERSION_KEY } from '@shared/types/preferences'
import bus from '../bus'
import { setLanguage } from '../i18n'
import { rememberStoredPreferences } from '../tauri-bridge/preferences'

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
  // Empty string follows `theme`, so pre-split preferences keep working.
  uiTheme: string
  mdTheme: string
  followSystemTheme: boolean
  lightModeTheme: string
  darkModeTheme: string
  // Following the system keeps one pair per appearance; an empty axis falls
  // back to the matching `lightModeTheme` / `darkModeTheme`.
  lightUiTheme: string
  lightMdTheme: string
  darkUiTheme: string
  darkMdTheme: string
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

/**
 * Bring a stored preferences bag up to the two-axis shape.
 *
 * A file written before the split only knows `theme`. Turning on "follow the
 * system" for it would repaint those users on a dark OS before they ever saw the
 * new setting, so the single theme stays until the user saves a pair of its own.
 * The marker is the file version: theme fields cannot stand in for it, because a
 * user who never opened the theme page stores none of them.
 */
export function migrateLegacyThemeFields(raw: Record<string, unknown>): Record<string, unknown> {
  // A first run has no file; the bridge hands over an empty bag. Nothing there
  // predates the split, and turning the system theme off would override the
  // default for a user who has never stored a theme.
  if (Object.keys(raw).length === 0) return raw
  if (raw[PREFERENCES_VERSION_KEY] === PREFERENCES_VERSION) return raw

  return { ...raw, followSystemTheme: false }
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
    // Per-axis overrides; empty falls back to the single theme setting.
    // The interface above explains why both axes resolve through it.
    uiTheme: '',
    mdTheme: '',
    followSystemTheme: true,
    lightModeTheme: 'light',
    darkModeTheme: 'dark',
    // Empty: resolve to `lightModeTheme` / `darkModeTheme` on that appearance.
    lightUiTheme: '',
    lightMdTheme: '',
    darkUiTheme: '',
    darkMdTheme: '',
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
     * Only the stored file can predate the two-axis split; a broadcast patch
     * carries one field the user just changed and must never be mistaken for a
     * legacy file.
     */
    LOAD_STORED_PREFERENCES(preference: Partial<PreferencesState> | Record<string, unknown>): void {
      const raw = (preference ?? {}) as Record<string, unknown>
      const migrated = migrateLegacyThemeFields(raw)

      // Only a stored bag means the file has been read; a broadcast patch from
      // another window must not count as the first load.
      this.preferencesLoaded = true
      this.SET_USER_PREFERENCE(migrated as Partial<PreferencesState>)

      // Writing the migrated bag back is what lets the next launch skip the
      // migration. Without it the file keeps its old shape and is migrated
      // again on every start, so the store and the disk disagree until the user
      // happens to change something else.
      if (migrated !== raw) {
        window.electron.ipcRenderer.send('mt::set-user-preference', migrated)
      }
    },

    /**
     * Apply the bag read from `dataCenter.json`.
     *
     * It shares the store fields with the preferences file (image folder, upload
     * history) but has no theme fields at all, so it must not go through the
     * migration — that would read "no marker" as "pre-split file".
     */
    LOAD_STORED_USER_DATA(stored: Record<string, unknown>): void {
      this.SET_USER_PREFERENCE(stored as Partial<PreferencesState>)
    },

    SET_USER_PREFERENCE(preference: Partial<PreferencesState> | Record<string, unknown>): void {
      const oldLanguage = this.language
      const incoming = preference as Record<string, unknown>

      // Another window changed a preference. The bridge keeps its own copy of
      // the stored values to answer `getStoredPreference` without a round trip,
      // and a menu toggle reads the value it is about to flip: leaving that copy
      // behind would flip the old value back on the first click.
      rememberStoredPreferences(incoming)

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

      window.electron.ipcRenderer.on('mt::user-preference', (_e, preferences) => {
        this.SET_USER_PREFERENCE(preferences as Partial<PreferencesState>)
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
