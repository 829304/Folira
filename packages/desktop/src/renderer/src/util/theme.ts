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
import { rememberTheme } from '@/tauri-bridge/theme'
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

/**
 * The theme a window is actually showing.
 *
 * `null` until a commit lands: the preferences may ask for a theme whose sheets
 * are still loading, or whose load failed, and the diagram and source-mode
 * chrome must keep describing what is on screen rather than what was requested.
 */
export const appliedTheme = shallowRef<string | null>(null)

export type ThemeApplyResult = 'applied' | 'superseded' | 'failed'

let themeApplyRequest = 0
/** Whether the three slots currently hold a committed theme. */
let appliedSheets = false

/**
 * The stylesheet slot for one part of the current theme.
 *
 * Existing slots are moved back in front of the user's custom CSS on every call:
 * a window may have been styled by another path (`addCustomStyle` re-appends
 * itself), and a user rule must always win over the theme it overrides.
 */
const ensureThemeStyle = (id: string): HTMLStyleElement => {
  const element = (document.querySelector(`#${id}`) as HTMLStyleElement | null) ?? document.createElement('style')
  element.id = id

  const custom = document.querySelector('#custom-styles')
  if (custom?.parentNode === document.head) {
    document.head.insertBefore(element, custom)
  } else if (element.parentNode !== document.head) {
    document.head.appendChild(element)
  }

  return element
}

/**
 * Announce a failure without holding the theme result behind it.
 *
 * `notify` resolves when the reader answers the notification, and a notification
 * that just fades away never answers at all; awaiting it would keep
 * `applyThemeSet` from ever returning. The announcement is therefore a detached
 * side effect, and it asks `isCurrent` after each lazy import: a newer selection
 * may own the window by then and has no business showing this failure.
 *
 * @internal Exported so the guard can be tested without racing the real import cache.
 */
export const announceThemeFailure = (theme: string, isCurrent: () => boolean): void => {
  const announce = async(): Promise<void> => {
    let title = 'Theme could not be applied'
    let message = `Folira kept the previous theme: ${theme} could not be loaded.`
    try {
      const { t } = await import('@/i18n')
      title = t('notifications.themeLoadFailedTitle')
      message = t('notifications.themeLoadFailedMessage', { theme })
    } catch (error) {
      console.error('[theme] cannot localise the failure:', error)
    }

    if (!isCurrent()) return

    try {
      const notification = (await import('@/services/notification')).default
      if (!isCurrent()) return
      await notification.notify({ title, type: 'error', message })
    } catch (error) {
      console.error('[theme] cannot report the failure:', error)
    }
  }

  announce().catch((error: unknown) => {
    console.error('[theme] cannot report the failure:', error)
  })
}

/**
 * End a failed attempt.
 *
 * A newer attempt that arrived while the sheets were loading owns the window
 * now, so this one reports `superseded` and says nothing — and leaves the
 * splash gate alone, because the winner has not committed its sheets yet.
 * A failure that still owns the attempt opens the gate: a theme that cannot be
 * loaded would otherwise hold the window under the splash until the startup
 * deadline.
 */
function settleFailure(theme: string, token: number): ThemeApplyResult {
  if (token !== themeApplyRequest) return 'superseded'

  announceThemeFailure(theme, () => token === themeApplyRequest)
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
 *
 * The token is taken before the cache check so that re-selecting a theme still
 * invalidates an attempt that is in flight for a different one.
 */
export const applyThemeSet = async(theme: string, options: { settleSplash?: boolean } = {}): Promise<ThemeApplyResult> => {
  const token = ++themeApplyRequest
  const settles = options.settleSplash !== false

  if (appliedTheme.value === theme && appliedSheets) {
    if (settles) settleSplashTheme()
    return 'applied'
  }

  let ui = ''
  let md = ''
  let prism = ''
  try {
    [ui, md, prism] = await Promise.all([loadUiCss(theme), loadMdCss(theme), loadPrismCss(theme)])
  } catch (error) {
    if (token !== themeApplyRequest) return 'superseded'
    console.error(`[theme] cannot load ${theme}:`, error)
    return settleFailure(theme, token)
  }

  if (token !== themeApplyRequest) return 'superseded'

  // `themeColor` answers a missing stylesheet with an empty string rather than
  // an error, so absence is only visible here. The chrome and the body are
  // always required; syntax colours only when the manifest promises a palette,
  // because a null `prism` is a legitimate theme without highlighting.
  const wantsPrism = (getTheme(theme)?.prism ?? null) !== null
  if (!ui.trim() || !md.trim() || (wantsPrism && !prism.trim())) return settleFailure(theme, token)

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
  // Mirror the committed id for the next first paint. Recorded after the commit
  // so the cache can never name a theme that failed to load.
  rememberTheme(theme)
  // The splash may leave as soon as the first palette is on screen, but only
  // when this commit is the stored theme: the first frame can be a guess from
  // the cache, and revealing the window on a guess lets the real theme swap in
  // afterwards, which reads as a flash.
  if (settles) settleSplashTheme()

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
  // Re-append so the user sheet stays after the theme slots: adding it must not
  // let a theme override rules the user wrote.
  document.head.appendChild(element)
  element.textContent = options.customCss
  if (element.sheet) bindCustomProperties(element.sheet.cssRules)
}
