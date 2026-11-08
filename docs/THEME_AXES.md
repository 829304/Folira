# Themes

A theme names one look: the chrome, the Markdown page and the syntax palette
that highlights its code blocks. Picking a theme is one decision — there is no
way to combine the chrome of one theme with the page of another, so what the
settings page shows is what the editor renders.

## What a theme is

```
packages/desktop/src/renderer/src/assets/themes/
  base.css                 generated: publishes the public names on :root and .editor-wrapper
  manifest.json            generated: id, label, appearance, prism, swatches
  ui/<id>.css              one file per theme, declares --fui-* on :root
  md/<id>.css              one file per theme, declares --fmd-* on .editor-wrapper
  prismjs/<palette>.theme.css the syntax palette named by the theme's manifest entry
packages/desktop/scripts/themes/
  build.mjs                --migrate (one-off), default (aggregate), --check
  tokens.mjs               classifies every variable by who reads it; tokens.json is shared with CI
  verify.mjs               cascade checks the generators cannot express
```

The two source halves are an implementation detail, not a user choice: the
generator requires a `ui/<id>.css` **and** a `md/<id>.css` for every id, and a
theme only ever ships as the pair plus the palette its manifest entry names.

Theme files are mostly variables, and the generator only requires that: a theme
has to declare the public variables its half owns. Most of the inherited themes
still carry a tail of their own selector rules (35 of the 36 ids do — only
`ui/light.css`, `md/light.css`, `ui/github-light.css`, `ui/claude-style.css`,
`ui/typora-gitbook.css`, `ui/notion.css`, `ui/ia-writer-light.css` and
`ui/paper-sepia.css` are pure variables; One Dark alone
has 24 rules for scrollbars, dialogs, buttons, the title bar and the side bar).
A UI tail may also declare public variables for a narrower scope: Bear uses
`.side-bar { --themeColor: … }` so its dark sidebar gets a light berry while the
light title bar keeps the darker `#be2f34`. Only a theme's palette block feeds
the manifest; the generator validates and reads that block alone.
The
generator keeps those tails as written, so do not delete them while converting
a theme to variables only. What no theme may do is move the writing column or
change layout: those stay the app's decisions and the user's preferences.

## The public variables

`--editorBgColor`, `--h1Color`, … are the surface components and Muya read, and
their names did not change when the files were split by axis. `base.css` binds
each one to its half:

- on `:root`, to `var(--fui-<name>, <built-in light value>)` — the chrome;
- on `.editor-wrapper`, to `var(--fmd-<name>, var(--fui-<name>, …))` — the page.

Both declarations sit in `@layer folira-base`. That matters: a user's custom
CSS is unlayered, and an unlayered declaration beats a layered one, so a custom
`:root { --editorColor: … }` still wins without the editor rewriting the user's
stylesheet. To carry such a declaration across the scope boundary the runtime
mirrors every custom property on the element that declares it
(`--folira-user-<name>: var(--<name>)`), and the `.editor-wrapper` block reads
those aliases first. Copying the declaration text instead would change its
cascade position, its selector and its evaluation context.

Syntax colours and ordinary typography follow the same rule for the hand-written
themes. A theme's rules for the `--fmd-*`-backed colours and for plain element
styling are scoped to the editor at zero specificity — the GitHub Light Prism
palette rides on `:where(.editor-wrapper)` in `prismjs/github-light.theme.css`,
and its inline-code rule on `:where(:not(pre))` — so a user's `.token.keyword`,
`.editor-wrapper code` or `.editor-wrapper h1` rule wins on source order. Claude
Style and Notion borrow that palette; Typora GitBook ships its own scoped palette
(`prismjs/typora-gitbook.theme.css`, adapted from the Prism dark one) with the
same `:where(.editor-wrapper) :where(.mu-code-block, .editor-wrapper > pre)` shape. All four keep
the zero-weight inline-code rule, so one `:where` scope covers the hand-written
bodies. All 31 palette files are referenced by the manifest; six theme ids pick
a palette under another name (`light` → `default`, `material-dark` → `dark`,
`claude-style`, `notion`, `bear` and `ia-writer-light` → `github-light`), while
`typora-gitbook` and `paper-sepia` name their own. The other 29 themes inherited
from upstream are the exception — and all but
`light` still carry the old selector tails, unscoped and in places `!important`,
so overriding one of those takes the same selector or a stronger one. Their 28
Prism palettes stay global and take the familiar `.token.*` names.

A few structural rules cannot be zero-weight: they have to outrank Muya's own
stylesheet. In `md/github-light.css` and `md/claude-style.css` those are the
line-number gutter's `padding-left` and `top` (the engine reserves its own
offset), the zebra rows, the task-box radius, and the nested-quote right padding.
`md/typora-gitbook.css` and `md/notion.css` repeat the gutter, task-box and
nested-quote rules — their reference designs have no zebra rows — and Notion
adds the table header band, because Muya paints the header through the engine's
own cell rule. These rules sit at engine
weight or above, so overriding one takes the same selector shape or a stronger
one; the comments next to those rules say why each is special. The guard in
`theme-preview.spec.ts` therefore pins the zero-weight shapes (the Prism scope
and the inline-code selector), not a blanket rule that every theme selector is
weightless.

The link rules are the other engine-weight exception: Muya colours
`span.mu-inline-rule.mu-link` at (0,2,1), so both bodies keep
`.editor-wrapper .mu-inline-rule.mu-link` (0,3,0) plus a plain `a` rule for the
settings preview. A custom link colour therefore needs the same shape or a
stronger one. The colour itself is `var(--link-color, var(--linkColor))`, not a
direct `--linkColor`: `--link-color` is the published alias base.css wires to
the user's custom property, so an existing `.editor-wrapper { --link-color: … }`
rule keeps overriding the theme's link colour in both the editor and the
settings preview. The default hover deepens to Azure `#00307c`; because
base.css always resolves `--link-color`, that rule keys its fallback off the
`--folira-user-link-color` mirror that exists only when custom CSS declares the
alias, so a custom colour also survives hover. GitBook's copy button is scoped
to the navy block for the same reason: the engine paints its hover/focus surface
from a pale chrome token, so the theme supplies a dark-block-safe surface and a
visible keyboard ring.

## Loading a theme

`applyThemeSet(id)` in `util/theme.ts` is the only way a theme reaches the
screen. It

1. bumps a request token, so a slower earlier request can never win;
2. fetches the UI sheet, the Markdown sheet and the syntax sheet together;
3. refuses the set unless every sheet the theme promises is non-empty;
4. commits all three `<style>` slots in one go (`ag-theme-ui`, `ag-theme-md`,
   `ag-theme-prism`), then repaints `body.dark`, the CodeMirror palette class
   and publishes `appliedTheme`;
5. remembers the id for the next first paint, and settles the splash gate.

A failure leaves the previous theme on screen, shows one notification, and
still settles the gate. A superseded request stays quiet: the newer request
owns the screen.

`appliedTheme` is what the editor components read (diagram colours, the
CodeMirror palette); it is `null` until the first commit, and consumers fall
back to `DEFAULT_THEME_ID` so a failed first load still renders.

The splash fades when the content **and** the first theme are ready, or after
six seconds counted from module load. A slow or broken theme can delay the
window, never replace it with an unstyled one.

## Preferences

Preferences carry `theme` (default `light`) and `customCss`. `resolveThemeId`
maps an unknown or missing id to the default in memory, so a stale id in an old
file still renders a valid theme; only a real user choice writes the field.

A file from a build that still wrote the UI/Markdown pair is cleaned on the
first launch that finds it: the deprecated keys are ignored, then removed from
disk by `prune_json_file` behind the queued writes. The seed file
`static/preference.json` carries none of them either.

### Profiles written by development builds

Folira has not shipped, so there is nothing to upgrade from: the profiles that
still carry the two-axis keys were written by development builds, and no
migration runs. A valid `theme` is used as stored, a missing or unknown one
resolves to `light`, and the deprecated keys are ignored and then deleted from
disk by `prune_json_file`. A file that only had the old keys therefore ends up
on the default, exactly like a fresh install — including the old "follow the
system" trio, which used to name a dark theme on a dark desktop.

The first-paint cache in `localStorage` (`mt-tauri-theme`) is not evidence
either: it feeds one frame before the preferences arrive and never becomes a
stored preference. Keys from the retired builds (`mt-tauri-theme-pair`,
`mt-tauri-theme-choice`) are not read.

Resetting a development profile only needs the theme keys removed; fonts, the
custom CSS and anything else in `preferences.json` are unrelated and stay.

## The settings page

One grid of complete themes, a name filter, a live preview and the custom-CSS
box. The preview and the filter sit in a sticky header, so the sample stays in
view while the grid scrolls; hovering or keyboard-focusing a card repaints the
preview only. Cards are native buttons, so Tab reaches them and Enter/Space
selects without extra key handlers. The choice is written after `applyThemeSet`
returns `applied`, so a theme that cannot load is never saved. The preview runs
in a shadow root with the same three sheets plus `preview.css`, so it shows the
real cascade without leaking into the page.

The grid is split into Light and Dark tabs that only change which themes are
browsed: the tab opens on the appearance of the theme the window is painting and
follows later commits until the user picks a tab or a card, while the search term
is shared across both. Choosing a card never switches tabs, so a commit that
resolves late cannot move the list under the pointer.

## Adding a theme

1. Add `ui/<id>.css` and `md/<id>.css`, declaring only that axis's variables.
2. If the theme needs a syntax palette, add a `prismjs/<palette>.theme.css` and
   point the manifest entry at that palette name (`default` is the built-in
   Prism palette, and `light` names it explicitly, so its file is
   `prismjs/default.theme.css`). Every theme we ship today names one, and
   `test/unit/specs/theme-selection.spec.ts` enforces that. `null` means the
   theme ships no syntax colouring: `loadPrismCss` returns an empty sheet and
   the kernel applies the theme anyway.
3. `pnpm --filter folira themes` regenerates `base.css` and `manifest.json`;
   `pnpm --filter folira themes:check` runs the generator check, the token
   check and the cascade verification (`THEME_LEGACY_DIR` must point at a
   checkout that still has the pre-split files).

No code changes are needed: the settings page reads the manifest.

## Theme sources

A theme that adapts an upstream style says so here, with the commit it was read
from, so a later change can be diffed against the real source instead of guessed.

- **github-light** — the Markdown half follows
  [`github-markdown-css`](https://github.com/sindresorhus/github-markdown-css)
  (`github-markdown-light.css`, commit `5f70ccef05e1ee8f7a7962a51a48f6823916a739`,
  MIT, © Sindre Sorhus), scoped to `.editor-wrapper` and mapped onto the
  `--fmd-*` variables plus the `h1`–`h6`, table, blockquote, code and rule rules
  the engine needs. The interface half follows
  [`@primer/primitives`](https://github.com/primer/primitives) 11.10.0
  (`dist/css/functional/themes/light.css`, MIT, © 2018 GitHub, Inc., gitHead
  `3f51f80ee9510974032917c9b8ac9586656c88bc`, npm dist shasum
  `affc83ae02229e05dbc599d9903643f3b08dc3bd`) and maps its semantic colours
  onto `--fui-*`. The syntax palette is Prettylights from the same stylesheet
  (`--prettylights-syntax-*`), shipped as `prismjs/github-light.theme.css` and
  scoped to `.editor-wrapper` through a zero-specificity `:where()`, so it
  colours the editor body and the settings preview without reaching chrome
  outside the writing surface or outranking user overrides.
  The primary button keeps Primer's green action colour (`#1f883d`) instead of
  following `--themeColor`, like GitHub's main action, so the check that a
  `--themeColor` override reaches the primary button does not apply to this
  theme. The line-number gutter rule uses `:has()`, as the engine already does,
  so the theme does not raise the minimum WebView version (Chromium 105+ /
  WebKit 15.4+).
- **claude-style** — a Folira original, not a port. The palette starts from
  Anthropic's paper `#faf9f5`, ink `#141413` and clay `#d97757`; its warm neutral
  and accent steps were checked against two community themes:
  [`Typora_Claude-Like_Theme`](https://github.com/Muyiiiii/Typora_Claude-Like_Theme)
  (MIT, © Muyiiiii, `master` at commit
  `f048db7ad1678afabc10e988620f2d74e8846d05`, light variant `claude-like.css`)
  and [`claude-paper-obsidian`](https://github.com/Law-Of-Cycles/claude-paper-obsidian)
  (MIT, © Law-Of-Cycles, version 1.1.0, commit
  `cb37f4c3f5c850606a771e164cf9b3733dab731d`); no upstream CSS is copied, so a
  later diff against either source is a prompt, not a patch. The body closes h1
  with a hairline and gives h2 no border and no border-reserving padding, and its
  inline pill reads the UI-axis `--codeBgColor`, which is the name a custom
  stylesheet overrides.
  The syntax palette is GitHub Light's Prettylights file above, selected through
  `PRISM_ALIASES` in `build.mjs`, so the zero-weight scope it already carries
  covers this theme too. The accent is split between text and fill: text, icons
  and selection use `#a34f38` (4.9:1 on the sidebar, 5.1:1 on the selected fill),
  while the primary button keeps the original clay `#d97757` with ink on top
  (5.9:1). Its focus ring is a solid two-layer shadow — paper gap, then the dark
  accent — because the shared button style drops the native outline and an alpha
  shadow alone is invisible on warm paper.
- **typora-gitbook** — GitBook's rendered documentation look. The palette and
  type scale were read from the Azure light variant of
  [`typora-gitbook-theme`](https://github.com/h16nning/typora-gitbook-theme)
  (GPL-3.0, © 16soundsofsilence and contributors, `main` at commit
  `9e95aebf524491ccc5b74d1b4a1e53f8c6c1ac05`): panel `#f5f7f9`, ink `#3b454e`,
  heading `#242a31`, border `#e6ecf1`, decoration blue `#3884ff`, and a deeper
  `#1968e6` for text, links and actions (5.04:1 on white, 4.70:1 on the panel),
  with `#0f5fd8`/`#00307c` as the primary button's hover/pressed steps. No
  upstream CSS is copied — the values are Folira's own, re-expressed as
  `--fui-*`/`--fmd-*` tokens — so a later diff against the source is a prompt,
  not a patch. The Azure fenced block is the dark navy `#183055`: the theme
  restores it and ships its own scoped Prism palette
  (`prismjs/typora-gitbook.theme.css`, token colours adapted from the Prism dark
  palette, comments `#9daab6`, tag/property `#ff6299`, Azure's mint keyword
  `#61e3a5` and string blue `#71a7ff`), so the code surface keeps its contrast
  while the rest of the app stays light. The palette's zero-weight scope targets
  the fenced block and the settings preview's direct `<pre>` only, so a light
  source pane such as the HTML block's `<pre>` keeps the panel ink instead of
  receiving the navy token colours. Find-in-document matches
  (`.mu-highlight`/`.mu-selection`) switch to the light code ink on a stronger
  blue/slate wash. The block's horizontal scroller gets
  its own navy track and blue-grey thumb rather than the pale global bar;
  horizontal bars are eight pixels tall so the thumb stays visible on the navy
  surface. The shared `--codeBlockBgColor` also feeds front matter,
  HTML/math/diagram source panes and the inline footnote pill; those keep the
  panel/ink pair, so only the fenced block carries the navy surface. Selection
  is split by axis on purpose: the chrome wash is 25% so
  loading dots and input selections read, while the editor body keeps 8% so a
  selected link still clears 4.5:1. h1 alone closes with a
  hairline; links carry a 1px underline in both the editor (`span.mu-link`) and
  the settings preview (`<a>`); quotes sit on the pale panel behind a 4px accent
  bar; table cells are ruled in the pale border colour; and the copy button gets
  a dark-block-safe hover/focus surface and a visible keyboard ring.
- **notion** — Light Classic reference implementation, not a port: the palette
  and typographic proportions were read from
  [`typora-notion-theme`](https://github.com/adrian-fuertes/typora-notion-theme)
  (MIT, © 2022 adrian-fuertes, `themes/classic/notion-light-classic.css`,
  v1.2.1, commit `e3d9a50524378a401df7bde792773e71f2a90cd6`); the public
  [`Notion Colors`](https://matthiasfrank.de/en/notion-colors/) reference was
  used as a secondary check. No upstream CSS or selectors are copied — the theme
  reuses the colour steps and independent declarations as Folira's own tokens.
  Ink `#37352f` on white pages, warm panels `#f7f6f3`, grey `#73726e`, hairline
  borders `#e9e9e7`, action blue `#0b6bcb` (white text 5.28:1), and the brick-red
  inline pill `#b83d3d` on the UI-axis `--codeBgColor` (5.15:1 on the warm
  panel). Headings carry no rule; h1/h2 reserve `.3em` under the text. Links
  keep the ink colour and a underline in both `span.mu-link` and `<a>`. The
  table header band reads `--editorColor04` rather than the code-block token, so
  recolouring fenced code cannot repaint it; the nested quote keeps its right
  inset. The syntax palette is GitHub Light through `PRISM_ALIASES`; the fenced
  block keeps the warm `#f7f6f3` panel rather than Classic's red code text.

- **bear** — Ursine Polar's white paper, graphite sidebar and berry accent,
  adapted to Folira. Source: [`typora-theme-ursine`](https://github.com/noatpad/typora-theme-ursine)
  (MIT, © 2019 Daniel Hernandez, `master` at
  `de3c1d696e4353f6549ab3dfc7718d1cd8c92e0c`, `ursine-polar.scss`). No upstream
  CSS or selector is copied. Page `#fbfbfb` and ink `#333333`; sidebar
  `#2e3235` with `#d7d9da` file text, `#f3f4f4` title and `#b9bec1` secondary
  text; light-chrome accent `#be2f34` (5.57:1 on paper) and sidebar accent
  `#ff9a9e` (6.38:1 on the graphite); deep berry links `#be2f34`, pale code
  `#fafafa` with the reused GitHub Light palette (minimum token 5.13:1). The
  reference selected-text wash `#fbb6b7` is lightened to `#fde4e5` because a
  berry link on `#fbb6b7` is 3.42:1; `#fde4e5` keeps it at 4.77:1. The dark
  sidebar tokens are scoped under `.side-bar`, so the title bar and window
  controls keep the light chrome's dark `#5c5f62`. A custom `--linkColor` or
  `--link-color` is read through both `--folira-user-*` mirrors on hover, so a
  user link colour survives the theme's berry hover step. Fonts, base size,
  line height and writing width are untouched.
- **ia-writer-light** — a Folira original following the community
  [`iA-Writer-theme-for-Typora`](https://github.com/tarikfayad/iA-Writer-theme-for-Typora)
  look (`master` at `fd192febb885934d86a86f8017edc9bdd335aa86`). That commit has
  no LICENSE file, so no CSS or selector from it is copied; this is an
  independent implementation of the observed near-white page, ink-underlined
  links and one neutral code panel. Page `#f9f9f9`, ink `#1a1a1a`, code
  `#f0f0f0` with the reused GitHub Light palette (minimum token 4.70:1),
  selection `#d9d9d9`, chrome `#f7f7f7` / sidebar `#f4f4f4`, flat buttons with
  an ink primary and ink focus ring. The reference centers every heading;
  Folira centers **only h1** and gives h2-h6 logical `text-align: start`:
  left in LTR, right in RTL. No font is forced, and both public spellings of
  a custom link colour survive hover.
- **paper-sepia** — a Flexoki paper/ink palette. Source:
  [`kepano/flexoki`](https://github.com/kepano/flexoki) (MIT, © 2023 Steph Ango,
  `main` at `8d723bac4a9ac46adfdf99d42155286977aac72a`; colour table at
  <https://stephango.com/flexoki>). No upstream CSS or selector is copied.
  Paper `#f2f0e5`, panel `#e6e4d9`, border `#dad8ce`, ink `#403e3c`, secondary
  `#575653`, action brown `#9d4310` (5.66:1 on paper, 5.08:1 on the panel).
  Quotes, table headers and fenced code use the same paper series; code is
  `#e6e4d9`. GitHub Light's red keyword is only 4.20:1 on that panel, so the
  theme ships a scoped `prismjs/paper-sepia.theme.css` — the same zero-weight
  selector structure with keyword/important moved to Flexoki red-600
  `#af3029` (5.02:1); comments stay `#59636e` (4.79:1). A custom `--linkColor`
  or `--link-color` also survives the brown hover step. No font is forced.

## Checks

`themes:check` runs `build.mjs --check`, `tokens.mjs --check`, and
`verify.mjs` — cascade resolution for every theme, appearance, axis isolation,
structural variables, swatches, and a comparison of 3366 values against the
pre-split files. A theme added after the split has no pre-split file: it skips
that one comparison (a pre-split id without a baseline still fails) and goes
through every other check. `verify.mjs` needs `THEME_LEGACY_DIR`; without a
baseline it exits non-zero unless `THEMES_VERIFY_ALLOW_NO_BASELINE=1` is set.

Custom CSS stays effective across theme switches. `theme-preview.spec.ts` pins
the zero-weight shapes the hand-written themes promise: every Prism selector in
`prismjs/github-light.theme.css` starts with `:where(.editor-wrapper)` (that file
is shared by GitHub Light, Claude Style and Notion), every inline-code rule in
those bodies is exactly `.editor-wrapper :where(:not(pre)) > code`, and
GitBook's own palette has the same zero-weight guard under its scoped
`:where(.editor-wrapper) :where(.mu-code-block, .editor-wrapper > pre)` prefix. The other 29
themes, whose 28 palette files stay global, take a plain `.token.keyword`, so
the guard is scoped to the files that carry the scoped palette. The suite also
pins the link rule in both DOM shapes, the table header token split, the navy
block's plain-text colour, and the palette-reference guard (every palette file
must be selected by a manifest entry).

## Verification notes

The Phase 2/3 acceptance run recorded four evidence limits. They describe the
automation environment, not known product defects:

- The boot loading indicator was too short-lived to capture a frame in the
  packaged WebView run. Its 25% selection token and the static cascade are
  covered by `theme-preview.spec.ts`; there is no runtime screenshot.
- PDF export has no Tauri `printToPDF`. It was validated structurally (page
  count, file type) and through the WebView print DOM rendered in Chrome. The
  local toolchain has no PDF rasteriser, so no per-page screenshots exist.
- One real native HTML save was verified byte-for-byte against the application's
  export function. The other styles reuse that same application export function
  because native save-dialog automation is environment-dependent.
- Light themes intentionally use CodeMirror's `cm-s-default` source-mode skin
  (only the dark theme lists select `one-dark`/`railscasts`). Source-mode tests
  cover text, cursor, selection and the return to WYSIWYG, not a per-theme
  source palette.

## Out of scope

- Themes that change layout, spacing or the writing column. Those are
  preferences, not themes.
- Per-axis registries: a theme id always ships both halves.
