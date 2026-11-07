// The settings preview must show one theme without becoming part of it.
//
// Two failure modes matter here and both are invisible in a screenshot: a
// stylesheet that escapes the preview and repaints the settings page, and a
// preview that commits a theme whose stylesheets did not all arrive, so the
// sample keeps the old palette under the new name.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  composePreviewCss,
  isPreviewLoadable,
  PREVIEW_SAMPLE,
  scopeThemeCss
} from '@/util/themePreview'

const getTheme = vi.hoisted(() => vi.fn())
vi.mock('@/util/themeColor', async(importOriginal) => ({
  ...await importOriginal<object>(), getTheme
}))

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

  it('applies base, then the interface file, then the body file, then Prism', () => {
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

describe('preview loadability', () => {
  beforeEach(() => {
    getTheme.mockReturnValue({ prism: 'default' })
  })

  it('needs both axis stylesheets from the same theme', () => {
    expect(isPreviewLoadable('light', '', MD, PRISM)).toBe(false)
    expect(isPreviewLoadable('light', UI, '  ', PRISM)).toBe(false)
    expect(isPreviewLoadable('light', UI, MD, PRISM)).toBe(true)
  })

  it('requires syntax colours only when the manifest promises them', () => {
    expect(isPreviewLoadable('light', UI, MD, '')).toBe(false)

    getTheme.mockReturnValue({ prism: null })
    expect(isPreviewLoadable('light', UI, MD, '')).toBe(true)
  })

  it('treats a theme missing from the manifest as having no syntax palette', () => {
    getTheme.mockReturnValue(undefined)
    expect(isPreviewLoadable('gone', UI, MD, '')).toBe(true)
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

  it('keeps the rendered theme on screen when a stylesheet load rejects', () => {
    // A missing file resolves to an empty string, but a failed fetch rejects.
    // Left uncaught, that becomes an unhandled rejection every time a hover
    // lands on a theme that cannot be read.
    expect(source).toContain('try {')
    expect(source).toContain('catch (error)')
    expect(source).toContain('warned')
    expect(source).toContain('isPreviewLoadable')
  })

  it('ignores stylesheets from a theme that has been superseded', () => {
    expect(source).toContain('const token = ++request')
    expect(source).toContain('token !== request')
  })

  it('watches the single theme prop', () => {
    expect(source).toContain('theme: string')
    expect(source).toContain('watch(() => props.theme, render)')
  })
})

describe('preview of one theme', () => {
  it('paints the frame and the body from the same id', () => {
    const ui = readTheme('ui', 'dracula')
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

    // The frame follows the interface file…
    expect(hostBg).toContain('var(--fui-editorBgColor')
    // …and the page follows the Markdown file of the same theme.
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

// The GitHub Light body stylesheet carries rules the other themes do not, and
// each one changes how the editor and the preview share a stylesheet. These
// pin the two regressions a stylesheet review found: the user's code font size
// must still win, and the preview's block code must not inherit the inline pill.
describe('github-light markdown rules', () => {
  const css = readTheme('md', 'github-light')
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    // A renamed or deleted rule must fail the caller, not hand it an empty
    // string that makes `not.toContain(...)` pass on nothing.
    if (start < 0) throw new Error(`github-light.css has no rule for ${selector}`)
    return css.slice(start, css.indexOf('}', start) + 1)
  }

  it('leaves the code block font size to the user preference', () => {
    expect(rule('.editor-wrapper .mu-code-block')).not.toContain('font-size')
    expect(rule('.editor-wrapper pre code:not(.mu-code)')).toContain('font-size: 85%')
  })

  it('keeps the inline pill off a preview code block', () => {
    expect(css).toContain('.editor-wrapper :where(:not(pre)) > code {')
    expect(css).not.toContain(':not(pre) > code:not(.mu-code)')
    expect(rule('.editor-wrapper :where(:not(pre)) > code')).toContain(
      'background: var(--codeBgColor)'
    )
    expect(css).toContain('.editor-wrapper pre code:not(.mu-code)')
  })

  it('orders the inline rule before the reset that follows it', () => {
    // The reset has to stay last: if a later edit lets the inline selector match
    // a preview `<pre>`, the reset still wins the cascade. The `lastIndexOf`
    // checks also catch a second copy appended after it.
    const inlineSelector = '.editor-wrapper :where(:not(pre)) > code {'
    const resetSelector = '.editor-wrapper pre code:not(.mu-code) {'
    const inline = css.indexOf(inlineSelector)
    const reset = css.indexOf(resetSelector)
    expect(inline).toBeGreaterThan(-1)
    expect(reset).toBeGreaterThan(inline)
    expect(css.lastIndexOf(inlineSelector)).toBe(inline)
    expect(css.lastIndexOf(resetSelector)).toBe(reset)
  })

  it('pins the line-number gutter to the code block padding', () => {
    // The gutter offset and the block padding only line up as a pair, so a
    // change to either one alone must fail here.
    expect(rule('.editor-wrapper .mu-code-block')).toContain('padding: 1rem')
    expect(rule('.editor-wrapper .mu-code-block:has(.mu-line-numbers-rows)')).toContain(
      'padding-left: 2.5em'
    )
    expect(rule('.editor-wrapper .mu-code-block .mu-line-numbers-rows')).toContain('top: 1rem')
  })

  it('paints every second data row instead of every second row', () => {
    expect(css).toContain('.editor-wrapper .mu-table-inner tr:nth-child(odd):not(:first-child) td')
    expect(css).toContain('.editor-wrapper tbody tr:nth-child(2n) td')
    expect(css).not.toContain('.editor-wrapper tr:nth-child(2n) td')
  })

  it('insets nested quotes and ends with a newline', () => {
    expect(rule('.editor-wrapper blockquote blockquote')).toContain('padding-right: 1em')
    expect(css.endsWith('\n')).toBe(true)
  })
})

// The custom-CSS slot is injected after the theme sheets, so a user rule wins
// on source order only while the theme keeps its own weight. These checks pin
// the zero-weight shapes GitHub Light promises — the Prism palette and the
// inline-code selector — because those are where a class-shaped scope, or a
// plain `:not(pre)`, would silently outrank `.token.keyword` and
// `.editor-wrapper code` again. The other 32 upstream palettes are global
// (`prismjs/<id>.theme.css` with plain `.token.*` selectors) and stay out of
// scope here.

/** Strip block comments so selector parsing cannot trip over their text. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Every selector in a flat theme stylesheet. These files have no at-rules, so
 * a `}` ends each block; the selector part is what precedes the next `{`.
 */
const selectorsIn = (css: string): string[] =>
  stripComments(css)
    .split('}')
    .filter(block => block.includes('{'))
    .flatMap((block) => {
      const selector = block.slice(0, block.indexOf('{')).trim()
      return selector.split(',').map(part => part.trim())
    })

describe('theme rules custom CSS can override', () => {
  // FROZEN CONTRACT, not a convenience list: every selector below is the
  // zero-weight shape the Prism palette promises, so changing a selector means
  // editing this array deliberately. A declaration-only change (a colour, a
  // font weight) is outside this snapshot; a new selector, or a tail appended
  // to an existing one, is not. A diff therefore shows that the whole selector
  // still starts with `:where(.editor-wrapper)` and carries no
  // specificity-raising suffix (`:not()`, `:is()`, `:has()`, an attribute,
  // `:nth-child()`, a pseudo-element, an ID). A snapshot catches those because
  // it compares the whole selector, not just its prefix; compare the old
  // structural check, which was blind to any tail appended to a valid prefix.
  const GITHUB_LIGHT_PRISM_SELECTORS = [
    ':where(.editor-wrapper) code[class*=\'language-\']',
    ':where(.editor-wrapper) pre.ag-paragraph',
    ':where(.editor-wrapper) pre.ag-paragraph',
    ':where(.editor-wrapper) :where(:not(pre)) > code[class*=\'language-\']',
    ':where(.editor-wrapper) pre.ag-paragraph',
    ':where(.editor-wrapper) :where(:not(pre)) > code[class*=\'language-\']',
    ':where(.editor-wrapper) .token.comment',
    ':where(.editor-wrapper) .token.prolog',
    ':where(.editor-wrapper) .token.doctype',
    ':where(.editor-wrapper) .token.cdata',
    ':where(.editor-wrapper) .token.punctuation',
    ':where(.editor-wrapper) .namespace',
    ':where(.editor-wrapper) .token.property',
    ':where(.editor-wrapper) .token.tag',
    ':where(.editor-wrapper) .token.constant',
    ':where(.editor-wrapper) .token.symbol',
    ':where(.editor-wrapper) .token.boolean',
    ':where(.editor-wrapper) .token.number',
    ':where(.editor-wrapper) .token.deleted',
    ':where(.editor-wrapper) .token.selector',
    ':where(.editor-wrapper) .token.attr-name',
    ':where(.editor-wrapper) .token.string',
    ':where(.editor-wrapper) .token.char',
    ':where(.editor-wrapper) .token.builtin',
    ':where(.editor-wrapper) .token.attr-value',
    ':where(.editor-wrapper) .token.inserted',
    ':where(.editor-wrapper) .token.operator',
    ':where(.editor-wrapper) .token.entity',
    ':where(.editor-wrapper) .token.url',
    ':where(.editor-wrapper) .language-css .token.string',
    ':where(.editor-wrapper) .style .token.string',
    ':where(.editor-wrapper) .token.atrule',
    ':where(.editor-wrapper) .token.keyword',
    ':where(.editor-wrapper) .token.function',
    ':where(.editor-wrapper) .token.class-name',
    ':where(.editor-wrapper) .token.regex',
    ':where(.editor-wrapper) .token.variable',
    ':where(.editor-wrapper) .token.important',
    ':where(.editor-wrapper) .token.bold',
    ':where(.editor-wrapper) .token.italic',
    ':where(.editor-wrapper) .token.entity'
  ]

  it('pins every GitHub Light Prism selector and its order', () => {
    const prism = readFileSync(resolve(themesDir, 'prismjs', 'github-light.theme.css'), 'utf8')
    expect(selectorsIn(prism)).toEqual(GITHUB_LIGHT_PRISM_SELECTORS)
    // A zero-weight scope only helps while source order decides: an
    // `!important` in the palette would beat the user's `.token.keyword` no
    // matter where their stylesheet lands.
    expect(prism).not.toContain('!important')
  })

  it('keeps the GitHub Light inline-code selector exactly zero-weight', () => {
    const md = readTheme('md', 'github-light')
    const selectors = selectorsIn(md)

    expect(selectors).toContain('.editor-wrapper :where(:not(pre)) > code')
    // `:not(pre)` contributes a type's specificity unless wrapped in `:where`;
    // a plain one would let the theme outrank a user's rule again.
    expect(selectors.filter(selector => selector.includes(':not(pre)'))).toEqual([
      '.editor-wrapper :where(:not(pre)) > code'
    ])
  })
})

// The short breakpoints crop the sample's tail so its text stays legible. These
// checks pin which blocks survive at each frame: the default settings window
// lands on the 176px frame, so the code block has to stay visible there — it is
// the only place the Prism palette shows — and the table and list are what go.
describe('preview cropping at the short breakpoints', () => {
  const previewCss = readFileSync(resolve(__dirname, '../../../src/renderer/src/prefComponents/theme/preview.css'), 'utf8')
  const pageVue = readFileSync(resolve(__dirname, '../../../src/renderer/src/prefComponents/theme/index.vue'), 'utf8')

  /** The declaration body of one `@media (max-height: Npx)` block. */
  const mediaBlock = (css: string, height: string): string => {
    const match = new RegExp(`@media \\(max-height: ${height}px\\) \\{([\\s\\S]*?)\\n\\}`).exec(css)
    if (!match) throw new Error(`preview.css has no @media (max-height: ${height}px) block`)
    return match[1]
  }

  /** Selector → declaration body for the flat rules in one media block. */
  const declarationsIn = (block: string): Map<string, string> => {
    const rules = new Map<string, string>()
    for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(',')) rules.set(selector.trim(), body)
    }
    return rules
  }

  it('keeps the Prism-visible code block at the default-window frame', () => {
    const rules = declarationsIn(mediaBlock(previewCss, '760'))
    for (const selector of ['.sample-table', '.sample-list']) {
      // A `visibility: hidden` rule still keeps the block's layout space and
      // would pass a name-only check; the crop needs `display: none`.
      expect(rules.get(selector), `${selector} must be hidden here`).toContain('display: none')
    }
    // Hiding the code block here would hide the Prism palette in the window
    // users open first; the review caught exactly that.
    expect(rules.has('.sample-code')).toBe(false)
  })

  it('drops all three tail blocks at the smallest frame', () => {
    const rules = declarationsIn(mediaBlock(previewCss, '640'))
    for (const selector of ['.sample-code', '.sample-table', '.sample-list']) {
      expect(rules.get(selector), `${selector} must be hidden here`).toContain('display: none')
    }
  })

  it('uses the same breakpoints as the header height variables', () => {
    const mediaHeights = [...previewCss.matchAll(/@media \(max-height: (\d+)px\)/g)].map(match => match[1])
    expect(mediaHeights).toEqual(['760', '640'])
    // index.vue maps each viewport breakpoint to its frame height; a swapped
    // pair would make the header reserve space for the wrong frame.
    expect(pageVue).toMatch(/@media \(max-height: 760px\) \{\s*--theme-preview-height: 176px;/)
    expect(pageVue).toMatch(/@media \(max-height: 640px\) \{\s*--theme-preview-height: 140px;/)
  })
})
