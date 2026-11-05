import { describe, expect, it } from 'vitest'

import { composePreviewCss, scopeThemeCss } from '@/util/themePreview'

const BASE = `:root { --a: 1; }
.editor-wrapper { --a: var(--fui-a, 2); }`
const UI = ':root { --fui-a: 3; }'
const MD = '.editor-wrapper { --fmd-a: 4; }'

describe('theme preview stylesheet', () => {
  it('aims both scopes at the preview block', () => {
    const css = composePreviewCss(BASE, UI, MD)

    expect(css).not.toContain(':root')
    expect(css).not.toContain('.editor-wrapper')
    expect(css.match(/\.theme-preview/g)).toHaveLength(4)
  })

  it('keeps the cascade order base, then interface, then Markdown', () => {
    const css = composePreviewCss(BASE, UI, MD)

    expect(css.indexOf('--a: 1')).toBeLessThan(css.indexOf('--fui-a: 3'))
    expect(css.indexOf('--fui-a: 3')).toBeLessThan(css.indexOf('--fmd-a: 4'))
  })

  it('leaves the rest of a stylesheet alone', () => {
    const css = scopeThemeCss(`.mu-front-menu { box-shadow: 0 0 0 var(--editorColor); }
@media not print { :root { --a: 1; } }`)

    expect(css).toContain('.mu-front-menu')
    expect(css).toContain('@media not print')
    expect(css).toContain('.theme-preview { --a: 1; }')
  })
})
