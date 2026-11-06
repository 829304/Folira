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
  prismjs/<name>.theme.css the syntax palette named by the theme's manifest entry
packages/desktop/scripts/themes/
  build.mjs                --migrate (one-off), default (aggregate), --check
  tokens.mjs               classifies every variable by who reads it; tokens.json is shared with CI
  verify.mjs               cascade checks the generators cannot express
```

The two source halves are an implementation detail, not a user choice: the
generator requires a `ui/<id>.css` **and** a `md/<id>.css` for every id, and a
theme only ever ships as the pair plus the palette its manifest entry names.

Theme files declare variables and nothing else. They never carry selectors, so
a theme cannot restyle a component, move the writing column, or change how code
blocks are laid out — those stay the app's decisions and the user's
preferences.

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
box. Hovering (or keyboard-focusing) a card repaints the preview only; the
choice is written after `applyThemeSet` returns `applied`, so a theme that
cannot load is never saved. The preview runs in a shadow root with the same
three sheets plus `preview.css`, so it shows the real cascade without leaking
into the page.

## Adding a theme

1. Add `ui/<id>.css` and `md/<id>.css`, declaring only that axis's variables.
2. If the theme needs its own syntax palette, add
   `prismjs/<name>.theme.css` and point the manifest entry at it; themes
   without one fall back to `default`.
3. `pnpm --filter folira themes` regenerates `base.css` and `manifest.json`;
   `pnpm --filter folira themes:check` runs the generator check, the token
   check and the cascade verification (`THEME_LEGACY_DIR` must point at a
   checkout that still has the pre-split files).

No code changes are needed: the settings page reads the manifest.

## Checks

`themes:check` runs `build.mjs --check`, `tokens.mjs --check`, and
`verify.mjs` — cascade resolution for every theme, appearance, axis isolation,
structural variables, swatches, and a comparison of 3830 values against the
pre-split files. `verify.mjs` needs `THEME_LEGACY_DIR`; without a baseline it
exits non-zero unless `THEMES_ALLOW_NO_BASELINE=1` is set.

## Out of scope

- Themes that change layout, spacing or the writing column. Those are
  preferences, not themes.
- Per-axis registries: a theme id always ships both halves.
