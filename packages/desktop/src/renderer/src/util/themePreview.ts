// The settings preview renders one block with the same cascade a window gets.
//
// The generated `base.css` binds the public names twice — on `:root` for the
// chrome and on `.editor-wrapper` for the body — because custom properties
// resolve where they are declared, not where they are inherited. Aiming both at
// the preview element therefore gives it the chrome values, the body values and
// the same fallbacks, without a second copy of the cascade rules.

/** Rewrite both scopes of a generated stylesheet onto one element. */
export const scopeThemeCss = (css: string): string =>
  css.replace(/:root\b/g, '.theme-preview').replace(/\.editor-wrapper\b/g, '.theme-preview')

/**
 * Build the preview stylesheet.
 *
 * Order is the same order the app applies: base (fallbacks), then the interface
 * theme, then the Markdown theme, so the later files win exactly as they do in
 * the editor.
 */
export const composePreviewCss = (base: string, ui: string, md: string): string =>
  [scopeThemeCss(base), scopeThemeCss(ui), scopeThemeCss(md)].join('\n')
