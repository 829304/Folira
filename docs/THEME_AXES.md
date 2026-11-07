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
still carry a tail of their own selector rules (33 of the 34 ids do — only
`ui/light.css`, `md/light.css` and `ui/github-light.css` are pure variables;
One Dark alone has 25 rules for scrollbars, dialogs, buttons, the title bar and
the side bar). The
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

Syntax colours follow the same rule. Theme rules are scoped to the editor at
zero or engine-level specificity — the GitHub Light Prism palette through
`:where(.editor-wrapper)` in `prismjs/github-light.theme.css`, its inline-code
rule through `:where(:not(pre))` — so a user's rule wins on source order. A
`.token.keyword`, `.editor-wrapper code` or `.editor-wrapper h1` rule needs no
theme-specific prefix and keeps working when the theme changes; the other 32
upstream palettes stay global and take the same selectors.

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

## Checks

`themes:check` runs `build.mjs --check`, `tokens.mjs --check`, and
`verify.mjs` — cascade resolution for every theme, appearance, axis isolation,
structural variables, swatches, and a comparison of 3830 values against the
pre-split files. A theme added after the split has no pre-split file: it skips
that one comparison (a pre-split id without a baseline still fails) and goes
through every other check. `verify.mjs` needs `THEME_LEGACY_DIR`; without a
baseline it exits non-zero unless `THEMES_VERIFY_ALLOW_NO_BASELINE=1` is set.

Custom CSS stays effective across theme switches: `.token.keyword`,
`.editor-wrapper code` and `.editor-wrapper h1` are the selector shapes a theme
must leave overridable, and `theme-preview.spec.ts` fails if a theme raises their
specificity (a bare `.editor-wrapper` prefix, or `:not(pre)` without `:where`).

## Out of scope

- Themes that change layout, spacing or the writing column. Those are
  preferences, not themes.
- Per-axis registries: a theme id always ships both halves.
