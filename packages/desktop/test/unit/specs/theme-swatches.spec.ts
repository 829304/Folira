// The card swatches are resolved by the theme generator. `themes:check` reads
// the whole manifest, so these pin the resolution rules on their own: the
// Markdown half borrows the interface palette through `base.css`, and a cycle
// or a dangling reference must fail the build instead of painting `initial`.

// @ts-expect-error — the theme tooling is plain ESM without type declarations.
import { swatchesOf } from '../../../scripts/themes/css.mjs'
import { describe, expect, it } from 'vitest'

const uiLiterals = new Map([
  ['editorBgColor', '#ffffff'],
  ['editorColor', '#1f2328'],
  ['sideBarBgColor', '#f6f8fa'],
  ['themeColor', '#0969da'],
  ['buttonPrimaryBgColor', '#1f883d']
])

const mdDeclaring = (extra: [string, string][] = []): Map<string, string> =>
  new Map([
    ['editorBgColor', '#ffffff'],
    ['editorColor', '#1f2328'],
    ['h1Color', '#1f2328'],
    ['linkColor', 'var(--themeColor)'],
    ['codeBlockBgColor', '#f6f8fa'],
    ['blockquoteBorderColor', '#d1d9e0'],
    ...extra
  ])

describe('card swatches', () => {
  it('resolves a Markdown reference through the interface palette', () => {
    const swatches = swatchesOf(uiLiterals, mdDeclaring(), 'github-light')

    expect(swatches.md.linkColor).toBe('#0969da')
  })

  it('lets the Markdown half win when both palettes declare a name', () => {
    const swatches = swatchesOf(uiLiterals, mdDeclaring([['editorColor', '#24292f']]), 'github-light')

    expect(swatches.md.editorColor).toBe('#24292f')
    expect(swatches.ui.editorColor).toBe('#1f2328')
  })

  it('throws on a cycle instead of painting initial', () => {
    const literals = mdDeclaring([['linkColor', 'var(--otherColor)'], ['otherColor', 'var(--linkColor)']])

    expect(() => swatchesOf(uiLiterals, literals, 'github-light')).toThrow(
      'github-light: cannot resolve linkColor for the card swatches'
    )
  })

  it('throws on a dangling reference', () => {
    const literals = mdDeclaring([['linkColor', 'var(--missingColor)']])

    expect(() => swatchesOf(uiLiterals, literals, 'github-light')).toThrow(
      'github-light: cannot resolve linkColor for the card swatches'
    )
  })

  it('resolves the fallback of a var() whose reference is missing', () => {
    const literals = mdDeclaring([['linkColor', 'var(--missingColor, #fff)']])

    expect(swatchesOf(uiLiterals, literals, 'github-light').md.linkColor).toBe('#fff')
  })

  it('throws when a swatch is missing from both palettes', () => {
    const literals = mdDeclaring()
    literals.delete('h1Color')

    expect(() => swatchesOf(uiLiterals, literals, 'github-light')).toThrow(
      'github-light: cannot resolve h1Color for the card swatches'
    )
  })
})
