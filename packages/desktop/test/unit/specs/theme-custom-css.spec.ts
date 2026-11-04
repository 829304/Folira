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

const customHtml = () => (document.querySelector('#custom-styles') as HTMLStyleElement | null)?.innerHTML ?? ''

describe('addCustomStyle', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  afterEach(() => {
    vi.doUnmock('@/util')
  })

  // base.css re-declares the theme variables inside `.editor-wrapper`, so a
  // custom property declared only at the root would stop applying to the body.
  it('mirrors document-level custom properties onto the editor scope', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({ customCss: ':root { --editorColor: #ff0000; }' })

    const html = customHtml()
    expect(html).toContain(':root { --editorColor: #ff0000; }')
    expect(html).toContain('.editor-wrapper { --editorColor: #ff0000; }')
  })

  it('keeps one editor scope for a selector list that names both html and body', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({ customCss: ':root, body { --h1Color: blue; }' })

    expect(customHtml()).toContain('.editor-wrapper { --h1Color: blue; }')
  })

  it('leaves rules without custom properties alone', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({ customCss: '.mu-editor { color: red; }' })

    expect(customHtml()).toBe('.mu-editor { color: red; }')
  })

  it('does not create a sheet when no custom CSS is configured', async() => {
    const { addCustomStyle } = await loadTheme()

    addCustomStyle({})

    expect(document.querySelector('#custom-styles')).toBeNull()
  })
})
