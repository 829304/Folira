// The settings preview must show a theme pair without becoming part of it.
//
// Two failure modes matter here and both are invisible in a screenshot: a
// stylesheet that escapes the preview and repaints the settings page, and a
// preview that resolves the body palette from the interface axis, so a light
// chrome with a dark body renders light-on-light.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import {
  composePreviewCss,
  isPreviewLoadable,
  PREVIEW_SAMPLE,
  scopeThemeCss
} from '@/util/themePreview'

const themesDir = resolve(__dirname, '../../../src/renderer/src/assets/themes')
const readTheme = (axis: 'ui' | 'md', id: string): string =>
  readFileSync(resolve(themesDir, axis, `${id}.css`), 'utf8')

const BASE = `:root { --editorBgColor: var(--fui-editorBgColor, #fff); }
@layer folira-base {
  .editor-wrapper { --editorBgColor: var(--fmd-editorBgColor, var(--fui-editorBgColor, #fff)); }
}`
const UI = ':root { --fui-editorBgColor: #ffffff; }'
const MD = '.editor-wrapper { --fmd-editorBgColor: #282a36; }'
const PRISM = '.token.keyword { color: #ff79c6; }'
const CHROME = ':host { display: block; }'

const declaredValue = (css: string, selector: string, name: string): string | undefined => {
  const block = css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)))
  const declaration = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))

  return declaration?.[1].trim()
}

describe('preview stylesheet', () => {
  it('moves the document scope onto the shadow host and keeps the wrapper', () => {
    const css = scopeThemeCss(BASE)

    expect(css).not.toContain(':root')
    expect(css).toContain(':host {')
    expect(css).toContain('.editor-wrapper {')
  })

  it('leaves selectors it does not own alone', () => {
    const css = scopeThemeCss(`.mu-front-menu { color: var(--editorColor); }
@media not print { :root { --a: 1; } }`)

    expect(css).toContain('.mu-front-menu')
    expect(css).toContain('@media not print')
    expect(css).toContain(':host { --a: 1; }')
  })

  it('applies base, then the interface theme, then the body theme, then Prism', () => {
    const css = composePreviewCss({ base: BASE, ui: UI, md: MD, prism: PRISM, chrome: CHROME })

    expect(css.indexOf('--fui-editorBgColor: #ffffff')).toBeLessThan(
      css.indexOf('--fmd-editorBgColor: #282a36')
    )
    expect(css.indexOf('--fmd-editorBgColor: #282a36')).toBeLessThan(css.indexOf('.token.keyword'))
    expect(css.indexOf('.token.keyword')).toBeLessThan(css.indexOf(':host { display: block; }'))
  })

  it('omits stylesheets that failed to load', () => {
    const withGaps = composePreviewCss({ base: BASE, ui: UI, md: MD, prism: '', chrome: '' })

    expect(withGaps).toBe([scopeThemeCss(BASE), scopeThemeCss(UI), scopeThemeCss(MD)].join('\n'))
  })
})

describe('preview isolation', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../src/renderer/src/prefComponents/theme/preview.vue'),
    'utf8'
  )

  it('renders into a shadow root instead of the page', () => {
    expect(source).toContain('attachShadow')
    expect(source).not.toContain('document.head')
    expect(source).not.toContain('document.body')
  })

  it('keeps the pair on screen when a stylesheet cannot be loaded', () => {
    expect(source).toContain('isPreviewLoadable')
    expect(isPreviewLoadable('', MD)).toBe(false)
    expect(isPreviewLoadable(UI, '  ')).toBe(false)
    expect(isPreviewLoadable(UI, MD)).toBe(true)
  })

  it('keeps the pair on screen when a stylesheet load rejects', () => {
    // A missing file resolves to an empty string, but a failed fetch rejects.
    // Left uncaught, that becomes an unhandled rejection every time a hover
    // lands on a theme that cannot be read.
    expect(source).toContain('try {')
    expect(source).toContain('catch (error)')
    expect(source).toContain('warned')
  })
})

describe('preview of a mixed pair', () => {
  it('paints the body from the Markdown axis, not the interface one', () => {
    const ui = readTheme('ui', 'light')
    const md = readTheme('md', 'dracula')
    const css = composePreviewCss({
      base: readFileSync(resolve(themesDir, 'base.css'), 'utf8'),
      ui,
      md,
      prism: readFileSync(resolve(themesDir, 'prismjs', 'dracula.theme.css'), 'utf8'),
      chrome: CHROME
    })

    const hostBg = declaredValue(css, ':host', '--editorBgColor')
    const bodyBg = declaredValue(css, '.editor-wrapper', '--editorBgColor')

    // The frame follows the interface theme…
    expect(hostBg).toContain('var(--fui-editorBgColor')
    // …and the page follows the body theme, so a light chrome still renders
    // dark text on a dark page.
    expect(bodyBg).toContain('var(--fmd-editorBgColor')
    expect(md).toContain('--fmd-editorBgColor: #282a36')
    expect(ui).not.toContain('--fmd-editorBgColor')
    expect(css).toContain('.token')
  })

  it('renders syntax highlighting tokens in the sample', () => {
    expect(PREVIEW_SAMPLE).toContain('class="language-javascript"')
    expect(PREVIEW_SAMPLE).toContain('class="token keyword"')
    expect(PREVIEW_SAMPLE).toContain('class="token comment"')
  })
})
