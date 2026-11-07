import { getTheme } from './themeColor'

// The settings preview renders a sample document with the same cascade a window
// gets, inside a shadow root.
//
// The shadow root is what keeps the preview honest: the generated stylesheets
// stay untouched (`:root` becomes `:host`, `.editor-wrapper` keeps its name),
// so a theme's two files resolve exactly as they do in the editor — interface
// names on the host, Markdown names on the `.editor-wrapper` inside it — while
// none of those rules can reach the settings page itself.

/** Rewrite the document scope of a generated stylesheet onto the shadow host. */
export const scopeThemeCss = (css: string): string => css.replace(/:root\b/g, ':host')

/**
 * Build the preview stylesheet.
 *
 * Order matches the app: base (fallbacks), the interface theme, the Markdown
 * theme, then Prism and the preview's own chrome, so later files win exactly as
 * they do in the editor.
 */
export const composePreviewCss = (parts: {
  base: string
  ui: string
  md: string
  prism: string
  chrome: string
}): string =>
  [
    scopeThemeCss(parts.base),
    scopeThemeCss(parts.ui),
    scopeThemeCss(parts.md),
    parts.prism,
    parts.chrome
  ]
    .filter(css => css.trim().length > 0)
    .join('\n')

/**
 * A preview needs one complete theme. `themeColor` answers a missing stylesheet
 * with an empty string rather than an error, so this is the failure signal the
 * caller acts on: keep whatever is already rendered instead of showing a
 * half-styled sample. Syntax colours are only required when the manifest
 * promises a palette; a null `prism` is a theme without highlighting.
 */
export const isPreviewLoadable = (
  theme: string,
  ui: string,
  md: string,
  prism: string
): boolean => {
  const wantsPrism = (getTheme(theme)?.prism ?? null) !== null

  return ui.trim().length > 0 && md.trim().length > 0 && (!wantsPrism || prism.trim().length > 0)
}

/**
 * The sample the preview renders.
 *
 * The code block carries Prism's `token` spans so the syntax theme is exercised
 * too: class names come from Prism, not from us, and the Markdown theme picks
 * the palette through `prismjs/<id>.theme.css`.
 */
export const PREVIEW_SAMPLE = `<h1>Folira</h1>
<p>The quick brown fox jumps over the lazy dog. <strong>Bold</strong>, <em>italic</em>, a <a href="#">link</a> and <code>inline code</code>.</p>
<blockquote><p>A quote renders with its own border and colour.</p></blockquote>
<ul>
  <li>First item</li>
  <li>Second item with <code>code</code></li>
</ul>
<table>
  <thead><tr><th>Column</th><th>Value</th></tr></thead>
  <tbody><tr><td>Row</td><td>42</td></tr><tr><td>Next row</td><td>43</td></tr></tbody>
</table>
<pre><code class="language-javascript"><span class="token keyword">const</span> <span class="token function">sum</span> <span class="token operator">=</span> <span class="token number">1</span> <span class="token operator">+</span> <span class="token number">1</span>
<span class="token comment">// a preview is worth a thousand swatches</span></code></pre>`
