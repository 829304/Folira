export const PATH_SEPARATOR: string = window.path.sep

export const THEME_STYLE_ID = 'ag-theme'
// One <style> per axis. Keeping them separate is what lets the chrome and the
// body move independently: each element holds exactly one theme's variables.
export const UI_THEME_STYLE_ID = 'ag-theme-ui'
export const MD_THEME_STYLE_ID = 'ag-theme-md'
export const PRISM_STYLE_ID = 'ag-theme-prism'
export const COMMON_STYLE_ID = 'ag-common-style'

export const DEFAULT_EDITOR_FONT_FAMILY =
  '"Open Sans", "Clear Sans", "Helvetica Neue", Helvetica, Arial, sans-serif, Segoe UI Emoji, Apple Color Emoji, "Noto Color Emoji"'
export const DEFAULT_CODE_FONT_FAMILY =
  '"DejaVu Sans Mono", "Source Code Pro", "Droid Sans Mono", monospace'
export const DEFAULT_STYLE = Object.freeze({
  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
  codeFontSize: '14px',
  hideScrollbar: false,
  theme: 'light'
})

export { railscastsThemes, oneDarkThemes } from '../../common/theme'
