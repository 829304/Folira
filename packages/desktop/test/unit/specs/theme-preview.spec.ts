// The settings preview must show one theme without becoming part of it.
//
// Two failure modes matter here and both are invisible in a screenshot: a
// stylesheet that escapes the preview and repaints the settings page, and a
// preview that commits a theme whose stylesheets did not all arrive, so the
// sample keeps the old palette under the new name.

import { readdirSync, readFileSync } from 'fs'
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

// Claude Style is the other hand-written body. Activating its warm interface
// half made two promises a theme card cannot show: h2 closes by size and weight
// alone (so it keeps neither a rule nor the padding that reserved room for one),
// and the inline pill reads `--codeBgColor` instead of a baked-in accent, so a
// custom sheet can recolour it. Its syntax palette is GitHub Light's, which the
// zero-weight Prism guard further down already covers.
describe('claude-style markdown rules', () => {
  const css = readTheme('md', 'claude-style')
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`claude-style.css has no rule for ${selector}`)
    return css.slice(start, css.indexOf('}', start) + 1)
  }

  it('closes h1 with a hairline and gives h2 no rule or the padding for one', () => {
    const h1 = rule('.editor-wrapper h1')
    expect(h1).toContain('padding-bottom: 0.3em')
    expect(h1).toContain('border-bottom: 1px solid')

    const h2 = rule('.editor-wrapper h2')
    expect(h2).not.toContain('border')
    expect(h2).not.toContain('padding')
  })

  it('reuses the GitHub Light syntax palette', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(themesDir, 'manifest.json'), 'utf8')
    ) as { id: string; prism: string | null }[]

    expect(manifest.find((theme) => theme.id === 'claude-style')?.prism).toBe('github-light')
  })

  it('fills inline code from --codeBgColor so custom CSS can recolour it', () => {
    expect(rule('.editor-wrapper :where(:not(pre)) > code')).toContain(
      'background: var(--codeBgColor)'
    )
    // The public name resolves against the UI axis, so the fill has to be
    // declared there for the editor and the settings preview to agree.
    expect(readTheme('ui', 'claude-style')).toMatch(/--fui-codeBgColor:\s*\S+/)
    // `:not(pre)` contributes a type's specificity unless wrapped in `:where`;
    // a second, plain one would outrank user CSS again, so this theme gets the
    // same exclusivity guard the GitHub Light file has.
    expect(
      selectorsIn(readTheme('md', 'claude-style')).filter((selector) => selector.includes(':not(pre)'))
    ).toEqual(['.editor-wrapper :where(:not(pre)) > code'])
  })

  it("keeps the code block on the theme's warm grey", () => {
    expect(css).toContain('--fmd-codeBlockBgColor: #f3efe6')
  })
})

// The custom-CSS slot is injected after the theme sheets, so a user rule wins
// on source order only while the theme keeps its own weight. These checks pin
// the zero-weight shapes GitHub Light promises — the Prism palette and the
// inline-code selector — because those are where a class-shaped scope, or a
// plain `:not(pre)`, would silently outrank `.token.keyword` and
// `.editor-wrapper code` again. The other 28 upstream palettes are global
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

// The stage-3 light bodies are hand-written too, so they inherit the same
// promises as the two above: a syntax palette that is either the theme's own
// scoped file or the scoped GitHub Light one, an inline pill whose selector
// stays at zero weight, and a heading hierarchy that draws its rules from the
// reference design rather than from Muya's engine sheet. These pin those
// promises for both themes without touching the 29 upstream themes.
describe('typora-gitbook and notion markdown rules', () => {
  const ruleIn = (id: string, selector: string): string => {
    const css = readTheme('md', id)
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`md/${id}.css has no rule for ${selector}`)
    return css.slice(start, css.indexOf('}', start) + 1)
  }

  it('uses the GitBook palette and leaves Notion on GitHub Light', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(themesDir, 'manifest.json'), 'utf8')
    ) as { id: string; prism: string | null }[]

    expect(manifest.find((theme) => theme.id === 'typora-gitbook')?.prism).toBe(
      'typora-gitbook'
    )
    expect(manifest.find((theme) => theme.id === 'notion')?.prism).toBe('github-light')
  })

  it('keeps the inline pill zero-weight and driven by --codeBgColor', () => {
    for (const id of ['typora-gitbook', 'notion']) {
      expect(ruleIn(id, '.editor-wrapper :where(:not(pre)) > code')).toContain(
        'background: var(--codeBgColor)'
      )
      expect(
        selectorsIn(readTheme('md', id)).filter((selector) => selector.includes(':not(pre)'))
      ).toEqual(['.editor-wrapper :where(:not(pre)) > code'])
    }
  })

  it('draws the heading hierarchy the reference designs use', () => {
    // GitBook closes h1 with a hairline and leaves h2 unruled; Notion rules no
    // heading at all. The shared heading group must not add a border to either.
    expect(ruleIn('typora-gitbook', '.editor-wrapper h1')).toContain('border-bottom: 1px solid')
    expect(ruleIn('typora-gitbook', '.editor-wrapper h2')).not.toContain('border')
    expect(ruleIn('notion', '.editor-wrapper h1')).not.toContain('border')
    expect(ruleIn('notion', '.editor-wrapper h2')).not.toContain('border')
  })

  it("keeps the fenced block on the theme's own surface", () => {
    // GitBook restores Azure's navy code surface and paints it with its own
    // scoped palette; Notion keeps the warm panel and the GitHub Light tokens.
    expect(readTheme('md', 'typora-gitbook')).toContain('--fmd-codeBlockBgColor: #183055')
    expect(readTheme('md', 'notion')).toContain('--fmd-codeBlockBgColor: #f7f6f3')
  })

  it('scopes the GitBook palette to the code surface at zero weight', () => {
    const css = stripComments(
      readFileSync(resolve(themesDir, 'prismjs/typora-gitbook.theme.css'), 'utf8')
    )
    // The scoped palette nests a comma inside `:where(pre, .mu-code-block)`, so
    // this checks whole rule blocks rather than splitting selectors on commas.
    const blocks = css
      .split('}')
      .filter((block) => block.includes('{'))
      .map((block) => block.slice(0, block.indexOf('{')).trim())

    expect(blocks.length).toBeGreaterThan(10)
    for (const block of blocks) {
      // The `:where()` wrappers add no specificity, so the later custom-CSS
      // slot can still beat any token colour with a plain `.token.*` rule.
      expect(
        block.startsWith(':where(.editor-wrapper) :where(pre, .mu-code-block) ')
      ).toBe(true)
      expect(block).toContain('.token.')
    }
    expect(css).not.toMatch(/!important/)
  })
})

// Phase 2 tightens the parts of the hand-written light bodies that a colour
// sample cannot show: a link has to be underlined in both DOM shapes Muya
// renders, the navy code surface has to keep every control inside it legible,
// and a palette file is only worth shipping while the manifest still names it.
// Each test names the production change that would break it.
/** Palette names the manifest promises; a theme may ship none (`prism: null`). */
const shippedPalettes = (manifest: { prism: string | null }[]): string[] =>
  [
    ...new Set(
      manifest.map((theme) => theme.prism).filter((prism): prism is string => prism !== null)
    )
  ].sort()

describe('light-theme phase 2 contracts', () => {
  const ruleIn = (css: string, selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return css.slice(start, css.indexOf('}', start) + 1)
  }
  const gitbookMd = readTheme('md', 'typora-gitbook')
  const gitbookUi = readTheme('ui', 'typora-gitbook')

  it('underlines GitBook links in the editor and the preview DOM', () => {
    const selectors = selectorsIn(gitbookMd)
    // Muya colours the editor link through `span.mu-inline-rule.mu-link`
    // (0,2,1); a `.mu-link`-only rule loses that comparison, so the theme keeps
    // both classes on the selector. `a` is the settings-preview shape.
    expect(selectors).toContain('.editor-wrapper .mu-inline-rule.mu-link')
    expect(selectors).toContain('.editor-wrapper a')

    const base = ruleIn(gitbookMd, '.editor-wrapper .mu-inline-rule.mu-link')
    expect(base).toContain('color: var(--linkColor)')
    expect(base).toContain('text-decoration: underline')
    expect(base).toContain('text-decoration-thickness: 1px')
    expect(base).toContain('text-underline-offset: 0.15em')

    const hover = ruleIn(gitbookMd, '.editor-wrapper .mu-inline-rule.mu-link:hover')
    expect(hover).toContain('color: #00307c')
    expect(hover).toContain('text-decoration: underline')
  })

  it('keeps the GitBook code surface light-on-navy in both code paths', () => {
    expect(ruleIn(gitbookMd, '.editor-wrapper .mu-code-block')).toContain('color: #f8f8f2')
    expect(ruleIn(gitbookMd, '.editor-wrapper > pre')).toContain('color: #f8f8f2')
  })

  it('leaves the shared heading group without a border', () => {
    for (const id of ['typora-gitbook', 'notion']) {
      const css = readTheme('md', id)
      const start = css.indexOf('.editor-wrapper h1,')
      expect(start).toBeGreaterThan(-1)
      const group = css.slice(start, css.indexOf('}', start) + 1)
      expect(group, `${id}: the h1..h6 group draws a border`).not.toContain('border')
    }
  })

  it('keeps every shipped palette reachable from the manifest', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(themesDir, 'manifest.json'), 'utf8')
    ) as { prism: string | null }[]
    const files = readdirSync(resolve(themesDir, 'prismjs'))
      .filter((file) => file.endsWith('.theme.css'))
      .map((file) => file.replace(/\.theme\.css$/, ''))

    expect([...files].sort()).toEqual(shippedPalettes(manifest))
  })

  it('ignores a theme that promises no syntax palette when listing shipped files', () => {
    expect(
      shippedPalettes([{ prism: 'dark' }, { prism: null }, { prism: 'light' }])
    ).toEqual(['dark', 'light'])
  })

  it('keeps the GitBook palette readable on the navy surface', () => {
    // Comments may name the old colour as rationale; only real declarations
    // count for the palette's contrast.
    const palette = stripComments(
      readFileSync(resolve(themesDir, 'prismjs/typora-gitbook.theme.css'), 'utf8')
    )
    // #f92672 was 3.48:1 on #183055; the pink in use is 4.68:1.
    expect(palette).toContain('color: #ff6299')
    expect(palette).not.toContain('#f92672')
    // The comment colour is the theme's muted slate, not the palette default.
    expect(palette).toContain('color: #9daab6')
  })

  it('gives the GitBook code-copy button legible idle, hover and focus states', () => {
    // `CodeBlock.create` moves the button out of `code.mu-code` and appends it
    // to the `<pre>` (the line-number gutter moves the same way), so the
    // engine's old `code.mu-active` descendant shape never matches and the
    // button stays at opacity 0 until the block-level child rule lifts it.
    expect(
      ruleIn(gitbookMd, '.editor-wrapper .mu-code-block.mu-active > .mu-code-copy')
    ).toContain('opacity: 1')
    // The real DOM reparents the button, so no `code.mu-active` descendant
    // selector may come back (comments are stripped by `selectorsIn`).
    expect(
      selectorsIn(gitbookMd).filter((selector) => selector.includes('.mu-code.mu-active'))
    ).toEqual([])

    expect(
      ruleIn(gitbookMd, '.editor-wrapper .mu-code-block .mu-code-copy:hover')
    ).toContain('background-color: rgba(255, 255, 255, 0.14)')

    const focus = ruleIn(gitbookMd, '.editor-wrapper .mu-code-block .mu-code-copy:focus-visible')
    expect(focus).toContain('background-color: rgba(255, 255, 255, 0.14)')
    expect(focus).toContain('outline: 2px solid #9daab6')
  })

  it('keeps the 12px title-bar labels above 4.5:1', () => {
    // The tab strip paints inactive labels in --editorColor50 at 12px, so the
    // chrome step has to be readable text, not an icon grey.
    const titleBar = readFileSync(
      resolve(__dirname, '../../../src/renderer/src/components/titleBar/index.vue'),
      'utf8'
    )
    expect(titleBar).toContain('color: var(--editorColor50)')
    expect(gitbookUi).toContain('--fui-editorColor50: #55616c')
    // Icon roles stay on the warm grey: they only need the 3:1 graphical step.
    expect(gitbookUi).toContain('--fui-editorColor40: #74818d')
    expect(gitbookUi).toContain('--fui-iconColor: #74818d')
  })

  it('keeps the explicit primary-button hover and the a11y text colours', () => {
    // The generator restores `var()` references when a literal matches the
    // default resolved in the same axis; a body colour must not decide that for
    // the chrome, or the hover below collapses back to the base accent.
    expect(ruleIn(gitbookUi, ':root')).toContain('--fui-buttonPrimaryBgColorHover: #0f5fd8')
    expect(gitbookUi).toContain('--fui-sideBarTextColor: #55616c')
    expect(gitbookUi).toContain('--fui-floatFontColor: #55616c')
    // 0.08 over white keeps the #1968e6 link at 4.52:1 on the selection wash.
    expect(gitbookUi).toContain('--fui-selectionColor: rgba(25, 104, 230, 0.25)')
    expect(gitbookMd).toContain('--fmd-selectionColor: rgba(25, 104, 230, 0.08)')
  })
})

// Phase 2B fulfils the same contract for Notion. The review found the preview
// `<a>` path styled while the editor's `span.mu-inline-rule.mu-link` was left
// bare, and the header band following the code-block token. The action blue is
// Light Classic's; the warm neutrals stay, with the secondary text stepped down
// to clear 4.5:1 on the panel.
describe('light-theme phase 2 contracts (Notion)', () => {
  const ruleIn = (css: string, selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return css.slice(start, css.indexOf('}', start) + 1)
  }
  const notionMd = readTheme('md', 'notion')
  const notionUi = readTheme('ui', 'notion')

  it('underlines Notion links in the editor and the preview DOM', () => {
    const selectors = selectorsIn(notionMd)
    // `span.mu-inline-rule.mu-link` is (0,2,1) in the engine; the theme keeps
    // both classes so its ink colour and underline reach the editor link too.
    expect(selectors).toContain('.editor-wrapper .mu-inline-rule.mu-link')
    expect(selectors).toContain('.editor-wrapper a')

    const base = ruleIn(notionMd, '.editor-wrapper .mu-inline-rule.mu-link')
    expect(base).toContain('color: var(--linkColor)')
    expect(base).toContain('text-decoration: underline')
    expect(base).toContain('text-decoration-thickness: 1px')
    expect(base).toContain('text-underline-offset: 0.2rem')

    const hover = ruleIn(notionMd, '.editor-wrapper .mu-inline-rule.mu-link:hover')
    expect(hover).toContain('text-decoration: underline')
  })

  it('keeps the table header band on the page token, not the code token', () => {
    const start = notionMd.indexOf('.editor-wrapper .mu-table-inner tr:first-child td,')
    expect(start).toBeGreaterThan(-1)
    const band = notionMd.slice(start, notionMd.indexOf('}', start) + 1)
    expect(band).toContain('background: var(--editorColor04)')
    expect(band).not.toContain('var(--codeBlockBgColor)')
    // The same rule covers the preview's real `<thead>`.
    expect(band).toContain('.editor-wrapper thead th')
  })

  it('adopts the Light Classic action blue and the warm UI tokens', () => {
    const root = ruleIn(notionUi, ':root')
    expect(root).toContain('--fui-themeColor: #0b6bcb')
    expect(root).toContain('--fui-codeBgColor: #f7f6f3')
    expect(root).toContain('--fui-buttonPrimaryBgColorHover: #0a5db8')
    expect(root).toContain('--fui-buttonPrimaryBgColorActive: #084f9e')
    expect(root).toContain(
      '--fui-buttonPrimaryFocusShadow: 0 0 0 2px #ffffff, 0 0 0 4px #0b6bcb'
    )
    // #73726e on #f7f6f3 is 4.46:1; secondary text steps to #6b6a66 (5.01:1).
    // Icons keep the warm grey, which clears the 3:1 graphical threshold.
    expect(root).toContain('--fui-sideBarTextColor: #6b6a66')
    expect(root).toContain('--fui-floatFontColor: #6b6a66')
    expect(root).toContain('--fui-highlightThemeColor: var(--editorColor)')
    expect(root).toContain('--fui-selectionColor: #c0e5f4')
    // The 12px title-bar/tab labels paint with `--editorColor50`, which is
    // legible on the white chrome (4.82:1) but not on the #f7f6f3 panel
    // (4.46:1); panel text is the darker #6b6a66 asserted above.
    expect(root).toContain('--fui-editorColor50: #73726e')
    // The editor body paints its selection from the Markdown axis, so the
    // Classic wash has to be declared there as well, not only on the chrome.
    expect(notionMd).toContain('--fmd-selectionColor: #c0e5f4')
  })
})

// Final-review fixes: the navy code block needs its own selection colours (the
// engine's global `*:not(.mu-hide)::selection` forces the body ink on every
// element), the inserted/deleted Prism tokens must stay legible on that
// surface, and the palette registry guard must ignore themes that promise no
// palette.
describe('final review fixes', () => {
  const ruleIn = (css: string, selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return css.slice(start, css.indexOf('}', start) + 1)
  }
  const gitbookMd = readTheme('md', 'typora-gitbook')

  it('paints the GitBook code-block selection with the light code ink', () => {
    const selectionSelectors = selectorsIn(gitbookMd).filter((selector) =>
      selector.includes('::selection')
    )
    // Only the scoped code-block rule may exist: a global `::selection` would
    // repaint the white page's 8% accent wash as well.
    expect(selectionSelectors).toEqual(['.editor-wrapper .mu-code-block ::selection'])

    const rule = ruleIn(gitbookMd, '.editor-wrapper .mu-code-block ::selection')
    expect(rule).toContain('color: #f8f8f2')
    expect(rule).toContain('background: rgba(157, 170, 182, 0.35)')
    // The white-page selection token stays the 4.52:1 accent wash.
    expect(gitbookMd).toContain('--fmd-selectionColor: rgba(25, 104, 230, 0.08)')
  })

  it('keeps inserted and deleted tokens legible on the navy surface', () => {
    const palette = stripComments(
      readFileSync(resolve(themesDir, 'prismjs/typora-gitbook.theme.css'), 'utf8')
    )
    // 8.58:1 and 6.78:1 on #183055. The light chip backgrounds Prism ships
    // (#f0fff4 / #ffeef0) would break the dark surface.
    expect(palette).toContain('color: #7ee787')
    expect(palette).toContain('color: #ffa198')
    expect(palette).not.toContain('#f0fff4')
    expect(palette).not.toContain('#ffeef0')
    expect(palette).not.toContain('#22863a')
    expect(palette).not.toContain('#b31d28')
    expect(palette).toContain('background: transparent')
  })
})

// Phase 3 calibration: the fenced code surface takes Azure's syntax colours and
// gets its own horizontal scrollbar, and the chrome selection deepens while the
// editor body's wash stays at the value the link contrast was measured with.
describe('phase 3 GitBook code surface and chrome', () => {
  const gitbookMd = readTheme('md', 'typora-gitbook')
  const gitbookUi = readTheme('ui', 'typora-gitbook')
  const palette = stripComments(
    readFileSync(resolve(themesDir, 'prismjs/typora-gitbook.theme.css'), 'utf8')
  )

  const ruleIn = (css: string, selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return css.slice(start, css.indexOf('}', start) + 1)
  }
  const paletteRule = (needle: string): string => {
    const start = palette.indexOf(needle)
    if (start < 0) throw new Error(`palette has no rule for ${needle}`)
    const open = palette.indexOf('{', start)
    return palette.slice(start, palette.indexOf('}', open) + 1)
  }
  /** WCAG relative-luminance contrast for two hex colours. */
  const contrast = (foreground: string, background: string): number => {
    const luminance = (hex: string): number => {
      const digits = hex.replace('#', '')
      const [r, g, b] = [0, 2, 4].map((index) => {
        const value = parseInt(digits.slice(index, index + 2), 16) / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
      (a, b) => b - a
    )
    return (lighter + 0.05) / (darker + 0.05)
  }

  it('takes Azure syntax colours on the navy surface', () => {
    expect(paletteRule('.token.keyword')).toContain('color: #61e3a5')
    const string = paletteRule('.token.string')
    expect(string).toContain('color: #71a7ff')
    expect(string).toContain('.token.char')

    // attr-name/builtin keep the Azure green rather than following the strings.
    const green = paletteRule('.token.selector')
    expect(green).toContain('#a6e22e')
    expect(green).toContain('.token.attr-name')
    expect(green).toContain('.token.builtin')
    expect(green).not.toContain('.token.string')

    // Every token the JS/HTML/JSON grammars emit clears 4.5:1 on #183055.
    const azureTokens: Record<string, string> = {
      keyword: '#61e3a5',
      string: '#71a7ff',
      'attr-name/builtin': '#a6e22e',
      punctuation: '#f8f8f2',
      comment: '#9daab6',
      operator: '#e67e65',
      number: '#ae81ff',
      'tag/property': '#ff6299',
      'attr-value/function': '#e6db74',
      regex: '#fd971f',
      inserted: '#7ee787',
      deleted: '#ffa198'
    }
    for (const [name, color] of Object.entries(azureTokens)) {
      expect(contrast(color, '#183055'), `${name} on the navy surface`).toBeGreaterThanOrEqual(
        4.5
      )
    }
  })

  it('keeps the horizontal code scroller legible on the navy block', () => {
    const scrollbar = (suffix: string): string => {
      const selector = `.editor-wrapper .mu-code-block .mu-code::-webkit-scrollbar${suffix}`
      expect(selectorsIn(gitbookMd)).toContain(selector)
      return ruleIn(gitbookMd, selector)
    }

    expect(scrollbar('')).toContain('height: 8px')
    expect(scrollbar('-track')).toContain('background: #10233c')
    const thumb = scrollbar('-thumb')
    expect(thumb).toContain('background: #5d748e')
    expect(thumb).toContain('border-radius')
    expect(scrollbar('-thumb:hover')).toContain('background: #7f97b3')

    // The rules stay scoped to the code scroller; no global scrollbar restyle.
    for (const selector of selectorsIn(gitbookMd).filter((entry) =>
      entry.includes('::-webkit-scrollbar')
    )) {
      expect(
        selector.startsWith('.editor-wrapper .mu-code-block .mu-code::-webkit-scrollbar')
      ).toBe(true)
    }
  })

  it('deepens the chrome selection while the editor body keeps its wash', () => {
    const value = (css: string, name: string): string | undefined =>
      new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim()

    expect(value(gitbookUi, '--fui-selectionColor')).toBe('rgba(25, 104, 230, 0.25)')
    expect(value(gitbookMd, '--fmd-selectionColor')).toBe('rgba(25, 104, 230, 0.08)')
    expect(value(gitbookUi, '--fui-selectionColor')).not.toBe(
      value(gitbookMd, '--fmd-selectionColor')
    )
    // Chrome ink on the 25% wash over white (#c6d9f9) is 6.84:1; the editor
    // body's 8% wash keeps the #1968e6 link at 4.52:1.
    expect(contrast('#3b454e', '#c6d9f9')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#1968e6', '#edf3fd')).toBeGreaterThanOrEqual(4.5)
  })
})
