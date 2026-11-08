import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const THEMES = resolve(__dirname, '../../../src/renderer/src/assets/themes')
const readFile = (path: string): string => readFileSync(resolve(THEMES, path), 'utf8')
const ui = (id: string): string => readFile(`ui/${id}.css`)
const md = (id: string): string => readFile(`md/${id}.css`)

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The first block whose selector starts with `selector`, with comments removed. */
const ruleIn = (css: string, selector: string): string => {
  const source = stripComments(css)
  const start = source.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no rule for ${selector}`)
  return source.slice(start, source.indexOf('}', start) + 1)
}

/** A declared value from a single rule, without the trailing semicolon. */
const valueIn = (css: string, selector: string, prop: string): string => {
  const rule = ruleIn(css, selector)
  const match = new RegExp(`${prop}:\\s*([^;]+);`).exec(rule)
  if (!match) throw new Error(`${selector} has no ${prop}`)
  return match[1].trim()
}

const selectorsIn = (css: string): string[] =>
  stripComments(css)
    .split('}')
    .filter(block => block.includes('{'))
    .flatMap(block => block.slice(0, block.indexOf('{')).trim().split(',').map(part => part.trim()))

const luminance = (hex: string): number => {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!digits) throw new Error(`not a hex colour: ${hex}`)
  const channels = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255)
  const linear = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

const contrast = (foreground: string, background: string): number => {
  const a = luminance(foreground)
  const b = luminance(background)
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

const manifest = JSON.parse(readFile('manifest.json')) as Array<{
  id: string
  label: string
  appearance: string
  prism: string
}>

const entry = (id: string) => manifest.find(theme => theme.id === id)

const NEW_THEMES = ['bear', 'ia-writer-light', 'paper-sepia'] as const

const GITHUB_LIGHT_TOKENS = {
  keyword: '#cf222e',
  comment: '#59636e',
  string: '#0a3069',
  tag: '#0550ae',
  function: '#6639ba',
  variable: '#953800'
} as const

const PAPER_TOKENS = {
  keyword: '#af3029',
  comment: '#59636e',
  string: '#0a3069',
  tag: '#0550ae',
  function: '#6639ba',
  variable: '#953800'
} as const

describe('new light themes — registration', () => {
  it('ships all three as light themes with the requested labels', () => {
    expect(manifest).toHaveLength(36)
    expect(manifest.filter(theme => theme.appearance === 'light')).toHaveLength(17)
    expect(manifest.filter(theme => theme.appearance === 'dark')).toHaveLength(19)

    expect(entry('bear')).toMatchObject({
      label: 'Bear',
      appearance: 'light',
      prism: 'github-light'
    })
    expect(entry('ia-writer-light')).toMatchObject({
      label: 'iA Writer Light',
      appearance: 'light',
      prism: 'github-light'
    })
    expect(entry('paper-sepia')).toMatchObject({
      label: 'Paper / Sepia',
      appearance: 'light',
      prism: 'paper-sepia'
    })
  })

  it('does not set fonts, base writing metrics or a writing width', () => {
    for (const theme of NEW_THEMES) {
      const body = md(theme)
      expect(body, theme).not.toMatch(/font-family\s*:/)
      expect(body, theme).not.toMatch(/max-width\s*:/)
      expect(body, theme).not.toContain('--fmd-editorAreaWidth')
      const root = ruleIn(body, '.editor-wrapper')
      expect(root, theme).not.toMatch(/font-size\s*:/)
      expect(root, theme).not.toMatch(/line-height\s*:/)
    }
  })

  it('keeps user code colours overridable at the published names', () => {
    for (const theme of NEW_THEMES) {
      const body = md(theme)
      expect(body, theme).toContain('background: var(--codeBgColor)')
      expect(body, theme).toContain('var(--link-color, var(--linkColor))')
      expect(body, theme).toContain('.editor-wrapper :where(:not(pre)) > code')
      expect(body, theme).not.toContain('!important')
    }
  })
})

describe('Bear', () => {
  it('splits the berry accent between light chrome and the graphite sidebar', () => {
    const chrome = ui('bear')
    const side = ruleIn(chrome, '.side-bar')

    expect(valueIn(chrome, ':root', '--fui-editorBgColor')).toBe('#fbfbfb')
    expect(valueIn(chrome, ':root', '--fui-sideBarBgColor')).toBe('#f2f2f2')
    expect(valueIn(chrome, ':root', '--fui-sideBarColor')).toBe('#5c5f62')
    expect(valueIn(side, '.side-bar', '--themeColor')).toBe('#ff9a9e')
    expect(side).toContain('--sideBarBgColor: #2e3235')
    expect(side).toContain('--sideBarColor: #d7d9da')
    expect(side).toContain('--sideBarTextColor: #b9bec1')
    expect(side).toContain('--sideBarTitleColor: #f3f4f4')
    expect(side).toContain('--sideBarIconColor: #c3c8cb')
    expect(side).toContain('--highlightThemeColor: #ff9a9e')
    expect(side).toContain('--focusColor: #ff9a9e')

    expect(contrast('#ff9a9e', '#2e3235')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#b9bec1', '#2e3235')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#5c5f62', '#fbfbfb')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the page readable and links safe on the selection wash', () => {
    const body = md('bear')
    const root = ruleIn(body, '.editor-wrapper')

    expect(valueIn(body, '.editor-wrapper', '--fmd-editorBgColor')).toBe('#fbfbfb')
    expect(valueIn(body, '.editor-wrapper', '--fmd-editorColor')).toBe('#333333')
    expect(root).toContain('--fmd-linkColor: var(--themeColor)')
    expect(root).toContain('--fmd-codeBlockBgColor: #fafafa')

    expect(contrast('#333333', '#fbfbfb')).toBeGreaterThanOrEqual(7)
    expect(contrast('#be2f34', '#fbfbfb')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#be2f34', '#fde4e5')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ffffff', '#be2f34')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the reused GitHub Light palette above 4.5:1 on #fafafa', () => {
    for (const [name, color] of Object.entries(GITHUB_LIGHT_TOKENS)) {
      expect(contrast(color, '#fafafa'), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('adds no upstream font and keeps the task/table/quote structure', () => {
    const body = md('bear')
    expect(body).not.toMatch(/font-family\s*:/)
    expect(selectorsIn(body)).toContain('.editor-wrapper li.mu-task-list-item > input::before')
    expect(selectorsIn(body)).toContain('.editor-wrapper blockquote::before')
    expect(selectorsIn(body)).toContain('.editor-wrapper .mu-table-inner tr:first-child td')
  })
})

describe('iA Writer Light', () => {
  it('keeps the chrome monochrome with an ink focus ring', () => {
    const chrome = ui('ia-writer-light')
    expect(valueIn(chrome, ':root', '--fui-themeColor')).toBe('#1a1a1a')
    expect(valueIn(chrome, ':root', '--fui-focusColor')).toBe('var(--themeColor)')
    expect(valueIn(chrome, ':root', '--fui-editorBgColor')).toBe('#f7f7f7')
    expect(valueIn(chrome, ':root', '--fui-sideBarBgColor')).toBe('#f4f4f4')
    expect(valueIn(chrome, ':root', '--fui-buttonPrimaryBgColor')).toBe('var(--themeColor)')
    expect(contrast('#1a1a1a', '#f7f7f7')).toBeGreaterThanOrEqual(7)
    expect(contrast('#ffffff', '#1a1a1a')).toBeGreaterThanOrEqual(7)
  })

  it('centers only h1 and keeps h2-h6 left', () => {
    const body = md('ia-writer-light')
    expect(valueIn(body, '.editor-wrapper h1', 'text-align')).toBe('center')
    expect(body.match(/text-align:\s*center/g)).toHaveLength(1)
    expect(body).toContain('text-align: left;')
    expect(valueIn(body, '.editor-wrapper h2', 'font-size')).toBe('1.5em')
  })

  it('keeps the body/links/selection and GitHub Light palette readable', () => {
    const body = md('ia-writer-light')
    const root = ruleIn(body, '.editor-wrapper')
    expect(valueIn(body, '.editor-wrapper', '--fmd-editorBgColor')).toBe('#f9f9f9')
    expect(valueIn(body, '.editor-wrapper', '--fmd-codeBlockBgColor')).toBe('#f0f0f0')
    expect(root).toContain('--fmd-linkColor: var(--themeColor)')
    expect(contrast('#1a1a1a', '#f9f9f9')).toBeGreaterThanOrEqual(7)
    expect(contrast('#1a1a1a', '#d9d9d9')).toBeGreaterThanOrEqual(7)
    expect(contrast('#ffffff', '#1a1a1a')).toBeGreaterThanOrEqual(7)
    for (const [name, color] of Object.entries(GITHUB_LIGHT_TOKENS)) {
      expect(contrast(color, '#f0f0f0'), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('does not add shadows to the flat chrome or change writing width', () => {
    const chrome = ui('ia-writer-light')
    expect(chrome).toContain('--fui-buttonShadow: none')
    expect(chrome).toContain('--fui-buttonPrimaryShadow: none')
    expect(chrome).not.toContain('--fui-sideBarBgColor: #2e3235')
    expect(md('ia-writer-light')).not.toMatch(/font-family\s*:/)
  })
})

describe('Paper / Sepia', () => {
  it('maps the Flexoki paper/ink scale and keeps the deep-brown action readable', () => {
    const chrome = ui('paper-sepia')
    const body = md('paper-sepia')
    const root = ruleIn(body, '.editor-wrapper')

    expect(valueIn(chrome, ':root', '--fui-themeColor')).toBe('#9d4310')
    expect(valueIn(chrome, ':root', '--fui-editorBgColor')).toBe('#f2f0e5')
    expect(valueIn(chrome, ':root', '--fui-sideBarBgColor')).toBe('#e6e4d9')
    expect(valueIn(body, '.editor-wrapper', '--fmd-editorBgColor')).toBe('#f2f0e5')
    expect(valueIn(body, '.editor-wrapper', '--fmd-codeBlockBgColor')).toBe('#e6e4d9')
    expect(root).toContain('--fmd-linkColor: var(--themeColor)')

    expect(contrast('#403e3c', '#f2f0e5')).toBeGreaterThanOrEqual(7)
    expect(contrast('#9d4310', '#f2f0e5')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#9d4310', '#e6e4d9')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#9d4310', '#dad8ce')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ffffff', '#9d4310')).toBeGreaterThanOrEqual(4.5)
  })

  it('ships a zero-weight Paper palette whose red clears the panel', () => {
    const palette = readFile('prismjs/paper-sepia.theme.css')
    const selectors = selectorsIn(palette)
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) {
      expect(selector.startsWith(':where(.editor-wrapper)')).toBe(true)
    }
    expect(palette).not.toContain('!important')
    expect(palette).toContain('color: #af3029')
    expect(palette).not.toContain('color: #cf222e')
    for (const [name, color] of Object.entries(PAPER_TOKENS)) {
      expect(contrast(color, '#e6e4d9'), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the old-paper hierarchy and code surface tokens', () => {
    const body = md('paper-sepia')
    expect(valueIn(body, '.editor-wrapper h1', 'border-bottom')).toBe('1px solid var(--hrColor)')
    expect(selectorsIn(body)).toContain('.editor-wrapper blockquote::before')
    expect(selectorsIn(body)).toContain('.editor-wrapper .mu-table-inner tr:first-child td')
    expect(body).toContain('background: var(--codeBgColor)')
    expect(body).toContain('--fmd-tableBorderColor: #dad8ce')
    expect(body).not.toMatch(/font-family\s*:/)
  })
})
