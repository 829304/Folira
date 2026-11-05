import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `theme.ts` transitively imports `@/config`, whose first line reads
// `window.path.sep` at module-load time. Stub the preload `window.path` surface
// before the dynamic import runs.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
})

const loadTheme = async() => {
  vi.resetModules()
  vi.doMock('@/util', () => ({ isLinux: false, isOsx: false, isWindows: true }))
  return await import('@/util/theme')
}

const customElement = () => document.querySelector('#custom-styles') as HTMLStyleElement | null
const customRules = () => {
  const element = customElement()
  if (!element?.sheet) throw new Error('Custom stylesheet was not created')
  return element.sheet.cssRules
}

describe('addCustomStyle', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  afterEach(() => {
    vi.doUnmock('@/util')
  })

  it('keeps overrides on the original element with an inherited binding', async() => {
    const { addCustomStyle } = await loadTheme()
    const css = ':root { --editorColor: red; padding: 0; }'

    addCustomStyle({ customCss: css })

    const rules = customRules()
    const rule = rules[0] as CSSStyleRule
    expect(rules).toHaveLength(1)
    expect(rule.selectorText).toBe(':root')
    expect(rule.style.getPropertyValue('--editorColor')).toBe('red')
    expect(rule.style.getPropertyValue('--folira-user-editorColor')).toBe('var(--editorColor)')
    expect(rule.style.getPropertyValue('padding')).toBe('0px')
    expect(customElement()?.textContent).toBe(css)
  })

  it.each([
    ':root, body',
    ':is(:root, body)',
    ':where(html, body)',
    'html > body',
    'body.dark',
    'body[data-space="a  b"]',
    '.editor-wrapper:hover',
    '.editor-wrapper .preview'
  ])('preserves the selector %s', async(selector) => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({ customCss: `${selector} { --h1Color: blue; }` })

    const rule = customRules()[0] as CSSStyleRule
    expect(rule.selectorText).toBe(selector)
    expect(rule.style.getPropertyValue('--h1Color')).toBe('blue')
    expect(rule.style.getPropertyValue('--folira-user-h1Color')).toBe('var(--h1Color)')
  })

  it('preserves priority and rule order for competing overrides', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({
      customCss: ':root { --editorColor: red !important; } html { --editorColor: blue; }'
    })

    const first = customRules()[0] as CSSStyleRule
    const second = customRules()[1] as CSSStyleRule
    expect(first.selectorText).toBe(':root')
    expect(second.selectorText).toBe('html')
    expect(first.style.getPropertyPriority('--editorColor')).toBe('important')
    expect(first.style.getPropertyPriority('--folira-user-editorColor')).toBe('important')
    expect(second.style.getPropertyPriority('--folira-user-editorColor')).toBe('')
  })

  it('reads the winning property in place without copying its var() reference', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({
      customCss: ':root { --brand: red; --editorColor: var(--brand) !important; } body { --brand: blue; }'
    })

    const root = customRules()[0] as CSSStyleRule
    const body = customRules()[1] as CSSStyleRule
    expect(root.style.getPropertyValue('--editorColor')).toBe('var(--brand)')
    expect(root.style.getPropertyValue('--folira-user-editorColor')).toBe('var(--editorColor)')
    expect(root.style.getPropertyPriority('--folira-user-editorColor')).toBe('important')
    expect(body.style.getPropertyValue('--folira-user-editorColor')).toBe('')
  })

  it('keeps conditional overrides inside their original groups', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({
      customCss: '@layer user { @media (prefers-color-scheme: dark) { :root { --editorColor: red; } } }'
    })

    const layer = customRules()[0] as CSSGroupingRule
    const media = layer.cssRules[0] as CSSMediaRule
    const rule = media.cssRules[0] as CSSStyleRule
    expect(media.conditionText).toBe('(prefers-color-scheme: dark)')
    expect(rule.selectorText).toBe(':root')
    expect(rule.style.getPropertyValue('--folira-user-editorColor')).toBe('var(--editorColor)')
  })

  it('keeps the following rule after a layer-order statement', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({ customCss: '@layer first, second; :root { --editorColor: red; }' })

    const rule = customRules()[1] as CSSStyleRule
    expect(rule.selectorText).toBe(':root')
    expect(rule.style.getPropertyValue('--folira-user-editorColor')).toBe('var(--editorColor)')
  })

  it('keeps comments, semicolons and braces inside string values', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({ customCss: '/* theme */ :root { --label: "A;B /* keep */ }"; --editorColor: red; }' })

    const rule = customRules()[0] as CSSStyleRule
    expect(rule.style.getPropertyValue('--label')).toBe('"A;B /* keep */ }"')
    expect(rule.style.getPropertyValue('--editorColor')).toBe('red')
    expect(rule.style.getPropertyValue('--folira-user-editorColor')).toBe('var(--editorColor)')
  })

  it('leaves rules without custom properties alone', async() => {
    const { addCustomStyle } = await loadTheme()
    const css = '.mu-editor { color: red; }'

    addCustomStyle({ customCss: css })

    expect(customElement()?.textContent).toBe(css)
    expect((customRules()[0] as CSSStyleRule).style.length).toBe(1)
  })

  it('replaces the previous overrides without retaining their bindings', async() => {
    const { addCustomStyle } = await loadTheme()
    addCustomStyle({ customCss: ':root { --editorColor: red; }' })
    const element = customElement()

    addCustomStyle({ customCss: ':root { --h1Color: blue; }' })

    expect(customElement()).toBe(element)
    expect(document.querySelectorAll('#custom-styles')).toHaveLength(1)
    const rule = customRules()[0] as CSSStyleRule
    expect(rule.style.getPropertyValue('--folira-user-editorColor')).toBe('')
    expect(rule.style.getPropertyValue('--folira-user-h1Color')).toBe('var(--h1Color)')
  })

  it('removes the overrides when custom CSS is cleared', async() => {
    const { addCustomStyle } = await loadTheme()
    addCustomStyle({ customCss: ':root { --editorColor: red; }' })

    addCustomStyle({ customCss: '' })

    expect(customElement()).toBeNull()
  })

  it('does not create a sheet when no custom CSS is configured', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({})

    expect(customElement()).toBeNull()
  })
})
