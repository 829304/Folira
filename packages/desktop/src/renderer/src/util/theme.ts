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
import { isLinux } from './index'

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

  // The class drives body-level styling (GitHub alerts, table chrome), so it
  // follows the Markdown theme: light chrome around a dark page must not leave
  // the page's own components rendering light.
  document.body.classList.toggle('dark', getTheme(md)?.appearance === 'dark')

  const cm = document.querySelector('.CodeMirror')
  if (cm) {
    cm.classList.remove('cm-s-default')
    cm.classList.remove('cm-s-one-dark')
    cm.classList.remove('cm-s-railscasts')
    if (oneDarkThemes.includes(md)) {
      cm.classList.add('cm-s-one-dark')
    } else if (railscastsThemes.includes(md)) {
      cm.classList.add('cm-s-railscasts')
    } else {
      cm.classList.add('cm-s-default')
    }
  }
}

/** Legacy entry point: one theme for both axes. */
export const addThemeStyle = (theme: string): void => {
  applyTheme({ ui: theme, md: theme })
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
