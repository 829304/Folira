import {
  UI_THEME_STYLE_ID,
  MD_THEME_STYLE_ID,
  PRISM_STYLE_ID,
  COMMON_STYLE_ID,
  DEFAULT_CODE_FONT_FAMILY,
  oneDarkThemes,
  railscastsThemes
} from '../config'
import { getTheme, loadMdCss, loadPrismCss, loadUiCss } from './themeColor'
import { rememberThemePair } from '@/tauri-bridge/theme'
import { settleSplashTheme } from './splash'
import { isLinux } from './index'
import { shallowRef } from 'vue'

const patchTheme = (css: string): string => {
  return `@media not print {\n${css}\n}`
}

const getEmojiPickerPatch = (): string => {
  return isLinux
    ? '.mu-emoji-picker section .emoji-wrapper .item span { font-family: sans-serif, "Noto Color Emoji"; }'
    : ''
}

const ensureStyle = (id: string): HTMLStyleElement => {
  let element = document.querySelector(`#${id}`) as HTMLStyleElement | null
  if (!element) {
    element = document.createElement('style')
    element.id = id
    document.head.appendChild(element)
  }
  return element
}

// Each axis counts its own requests. The two stylesheets load concurrently and
// can settle in either order, so "the newest request wins" is tracked per axis
// rather than by comparing the element's own dataset.
let uiRequest = 0
let mdRequest = 0
let prismRequest = 0

/**
 * Repaint the pieces that are not stylesheets.
 *
 * `body.dark` drives Muya's own dark rules (GitHub alerts, table chrome) and the
 * CodeMirror skin colours source mode, so both have to move with the theme that
 * is actually on screen — never with the one a load is still fetching.
 */
const paintPalette = (theme: string): void => {
  document.body.classList.toggle('dark', getTheme(theme)?.appearance === 'dark')

  const cm = document.querySelector('.CodeMirror')
  if (!cm) return

  cm.classList.remove('cm-s-default')
  cm.classList.remove('cm-s-one-dark')
  cm.classList.remove('cm-s-railscasts')
  if (oneDarkThemes.includes(theme)) {
    cm.classList.add('cm-s-one-dark')
  } else if (railscastsThemes.includes(theme)) {
    cm.classList.add('cm-s-railscasts')
  } else {
    cm.classList.add('cm-s-default')
  }
}

export interface ThemePair {
  ui: string
  md: string
}

/**
 * Apply a UI theme and a Markdown theme. The Prism sheet belongs to the
 * Markdown theme: syntax highlighting is part of the body, not the chrome.
 */
export const applyTheme = (pair: ThemePair): void => {
  const { ui, md } = pair
  // Mirror the pair where first paint can read it synchronously; the
  // preferences file is not available until well after the first frame.
  rememberThemePair({ ui, md })

  const uiEl = ensureStyle(UI_THEME_STYLE_ID)
  const mdEl = ensureStyle(MD_THEME_STYLE_ID)
  const prismEl = ensureStyle(PRISM_STYLE_ID)

  uiEl.dataset.theme = ui
  const uiToken = ++uiRequest
  loadUiCss(ui)
    .then((css) => {
      if (uiToken === uiRequest) uiEl.innerHTML = patchTheme(css)
    })
    .catch((err) => console.error(`[theme] cannot load ui/${ui}:`, err))

  mdEl.dataset.theme = md
  const mdToken = ++mdRequest
  loadMdCss(md)
    .then((css) => {
      if (mdToken === mdRequest) mdEl.innerHTML = patchTheme(css)
    })
    .catch((err) => console.error(`[theme] cannot load md/${md}:`, err))

  const prismToken = ++prismRequest
  loadPrismCss(md)
    .then((css) => {
      if (prismToken === prismRequest) prismEl.innerHTML = patchTheme(css)
    })
    .catch((err) => console.error(`[theme] cannot load prism for ${md}:`, err))

  paintPalette(md)

  // The pair path writes the same slots, so the single-theme cache no longer
  // describes what is on screen. Phase 2 removes the path altogether.
  appliedSheets = false
  appliedTheme.value = null
}

/** Legacy entry point: one theme for both axes. */
export const addThemeStyle = (theme: string): void => {
  applyTheme({ ui: theme, md: theme })
}

// --- Single-theme kernel ---------------------------------------------------
//
// A theme id names a whole set: chrome, body and syntax. The pair-based entry
// above stays until the settings page and the startup path switch together, so
// both can be covered by tests in the meantime; the first-paint mirror is wired
// in at that switch.

export type ThemeApplyResult = 'applied' | 'superseded' | 'failed'

/** The theme this window has on screen; `null` before the first commit. */
export const appliedTheme = shallowRef<string | null>(null)

// Bumped before every attempt so a newer attempt retires the one in flight,
// even when the newer one ends up reusing what is already painted.
let themeApplyRequest = 0
// Whether the three slots in the document came from a completed commit.
let appliedSheets = false

/**
 * A theme slot that lands before the user's custom CSS.
 *
 * Slots are created lazily on the first switch, long after `#custom-styles` may
 * exist, and appending would put the generated palette after the user's
 * overrides. Every call re-places the slot before the custom sheet, so a slot
 * left behind by the pair path ends up in the documented order too: base → ui →
 * md → prism → custom.
 */
const ensureThemeStyle = (id: string): HTMLStyleElement => {
  const found = document.querySelector(`#${id}`) as HTMLStyleElement | null
  const element = found ?? document.createElement('style')
  if (!found) element.id = id

  const custom = document.querySelector('#custom-styles')
  if (custom?.parentNode === document.head) {
    document.head.insertBefore(element, custom)
  } else if (!found) {
    document.head.appendChild(element)
  }
  return element
}

const reportThemeFailure = async(theme: string): Promise<void> => {
  let title = 'Theme could not be applied'
  let message = `Folira kept the previous theme: ${theme} could not be loaded.`
  try {
    const { t } = await import('@/i18n')
    title = t('notifications.themeLoadFailedTitle')
    message = t('notifications.themeLoadFailedMessage', { theme })
  } catch (error) {
    console.error('[theme] cannot localise the failure:', error)
  }

  try {
    const notification = (await import('@/services/notification')).default
    await notification.notify({ title, type: 'error', message })
  } catch (error) {
    console.error('[theme] cannot report the failure:', error)
  }
}

/**
 * End a failed attempt.
 *
 * The splash gate opens on failure as well as on success: a theme that cannot be
 * loaded would otherwise hold the window under the splash until the startup
 * deadline. A newer attempt that arrived while the failure was being reported
 * owns the gate now, so this one stays quiet and reports `superseded`.
 */
function settleFailure(token: number): ThemeApplyResult {
  if (token !== themeApplyRequest) return 'superseded'
  settleSplashTheme()
  return 'failed'
}

/**
 * Apply one complete theme.
 *
 * The three sheets are fetched together and committed together: a failure or a
 * newer selection leaves the previous theme exactly as it was, so a window can
 * never show one theme's chrome around another theme's body. `superseded` says
 * a newer attempt won and this failure must stay quiet.
 */
export const applyThemeSet = async(theme: string): Promise<ThemeApplyResult> => {
  const token = ++themeApplyRequest

  if (appliedTheme.value === theme && appliedSheets) return 'applied'

  let ui = ''
  let md = ''
  let prism = ''
  try {
    [ui, md, prism] = await Promise.all([loadUiCss(theme), loadMdCss(theme), loadPrismCss(theme)])
  } catch (error) {
    if (token !== themeApplyRequest) return 'superseded'
    console.error(`[theme] cannot load ${theme}:`, error)
    await reportThemeFailure(theme)
    return settleFailure(token)
  }

  if (token !== themeApplyRequest) return 'superseded'

  // `themeColor` answers a missing stylesheet with an empty string rather than
  // an error, so absence is only visible here. The chrome and the body are
  // always required; syntax colours only when the manifest promises a palette,
  // because a null `prism` is a legitimate theme without highlighting.
  const wantsPrism = (getTheme(theme)?.prism ?? null) !== null
  if (!ui.trim() || !md.trim() || (wantsPrism && !prism.trim())) {
    await reportThemeFailure(theme)
    return settleFailure(token)
  }

  const uiEl = ensureThemeStyle(UI_THEME_STYLE_ID)
  const mdEl = ensureThemeStyle(MD_THEME_STYLE_ID)
  const prismEl = ensureThemeStyle(PRISM_STYLE_ID)

  uiEl.innerHTML = patchTheme(ui)
  uiEl.dataset.theme = theme
  mdEl.innerHTML = patchTheme(md)
  mdEl.dataset.theme = theme
  prismEl.innerHTML = prism.trim() ? patchTheme(prism) : ''
  prismEl.dataset.theme = theme

  paintPalette(theme)
  appliedSheets = true
  appliedTheme.value = theme
  // The splash may leave as soon as the first palette is on screen.
  settleSplashTheme()

  return 'applied'
}

export const setEditorWidth = (value: string): void => {
  const EDITOR_WIDTH_STYLE_ID = 'editor-width'
  let result = ''
  if (value && /^[0-9]+(?:ch|px|%)$/.test(value)) {
    // Add 100px for the container's horizontal padding. Set both the legacy
    // camelCase var (source mode) and the kebab-case var the active
    // @muyajs/core engine reads for `.mu-container` max-width (issue #4828).
    const width = `calc(100px + ${value})`
    result = `:root { --editorAreaWidth: ${width}; --editor-area-width: ${width}; }`
  }
  let styleEle = document.querySelector(`#${EDITOR_WIDTH_STYLE_ID}`) as HTMLStyleElement | null
  if (!styleEle) {
    styleEle = document.createElement('style')
    styleEle.setAttribute('id', EDITOR_WIDTH_STYLE_ID)
    document.head.appendChild(styleEle)
  }

  styleEle.innerHTML = result
}

export interface CommonStyleOptions {
  codeFontFamily: string
  codeFontSize: number | string
  hideScrollbar?: boolean
  [key: string]: unknown
}

export const addCommonStyle = (options: CommonStyleOptions): void => {
  const { codeFontFamily, codeFontSize, hideScrollbar } = options
  let sheet = document.querySelector(`#${COMMON_STYLE_ID}`) as HTMLStyleElement | null
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = COMMON_STYLE_ID
    document.head.appendChild(sheet)
  }

  let scrollbarStyle = ''
  if (hideScrollbar) {
    scrollbarStyle = '::-webkit-scrollbar {display: none;}'
  }

  sheet.innerHTML = `${scrollbarStyle}
.CodeMirror {
font-family: ${codeFontFamily}, ${DEFAULT_CODE_FONT_FAMILY};
font-size: ${codeFontSize}px;
}

${getEmojiPickerPatch()}
`
}

/**
 * Keep user values on their original elements. The browser resolves their
 * selectors, priorities and var() references before the editor inherits them.
 * base.css reads these bindings ahead of its Markdown palette defaults.
 */
const bindCustomProperties = (rules: CSSRuleList): void => {
  for (const rule of Array.from(rules)) {
    if ('style' in rule) {
      const declarations = (rule as CSSStyleRule).style
      for (const name of Array.from(declarations)) {
        if (!name.startsWith('--') || name.startsWith('--folira-user-')) continue
        declarations.setProperty(
          `--folira-user-${name.slice(2)}`,
          `var(${name})`,
          declarations.getPropertyPriority(name)
        )
      }
    }
    if ('cssRules' in rule) bindCustomProperties((rule as CSSGroupingRule).cssRules)
  }
}

export interface CustomStyleOptions {
  customCss?: string
  [key: string]: unknown
}

export const addCustomStyle = (options: CustomStyleOptions): void => {
  let element = document.querySelector('#custom-styles') as HTMLStyleElement | null
  if (!options.customCss) {
    element?.remove()
    return
  }

  if (!element) {
    element = document.createElement('style')
    element.id = 'custom-styles'
    document.head.appendChild(element)
  }
  element.textContent = options.customCss
  if (element.sheet) bindCustomProperties(element.sheet.cssRules)
}

export interface AddStylesOptions extends CommonStyleOptions {
  theme: string
  /** Per-axis overrides; empty or missing means "same as `theme`". */
  uiTheme?: string
  mdTheme?: string
}

// Append common sheet and theme at the end of head - order is important.
export const addStyles = (options: AddStylesOptions): void => {
  const { theme, uiTheme, mdTheme } = options
  applyTheme({ ui: uiTheme || theme, md: mdTheme || theme })
  addCommonStyle(options)
}
