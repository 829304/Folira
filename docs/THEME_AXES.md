# Theme axes

The editor's look is split into two independent axes:

- **UI theme** — the chrome: title bar, menu bar, side bar, tabs, buttons,
  inputs, floating panels.
- **Markdown theme** — the body: headings, body text, lists, quotes, tables,
  links, code blocks, and the Prism palette that highlights them.

Any UI theme can be paired with any Markdown theme. The two are loaded,
applied and remembered separately.

## Why

A theme used to be a single `.theme.css` that carried both palettes, and the
settings page offered a single list of 33 of them. That coupling shows up the
moment you want a light editor around a dark page: the only way to get it was
to fork a theme file, and the theme page could not express it at all.

`Folira.md` asks for three things this design has to satisfy: the axes are
chosen independently, each theme is one file so adding one needs no code, and
"follow the system" keeps working across both axes. The page also has to show
what a theme will look like before it is committed.

## Phase 1 — the split

Shipped as `5403b319 fix(theme): keep user overrides on the elements that
declare them`.

```
packages/desktop/src/renderer/src/assets/themes/
  base.css        generated: publishes the public names on :root and .editor-wrapper
  manifest.json   generated: id, label, appearance, prism
  ui/<id>.css     33 files, each declares --fui-* on :root
  md/<id>.css     33 files, each declares --fmd-* on .editor-wrapper
  prismjs/<id>.theme.css
packages/desktop/scripts/themes/
  build.mjs       --migrate (one-off split), default (aggregate), --check
  tokens.mjs      classifies every variable by who reads it; tokens.json is shared with CI
  tokens.json     122 variables, 39 kebab aliases
  verify.mjs      cascade checks the generators cannot express
```

The variable names did not change: `--editorBgColor`, `--h1Color`, … are still
the public surface that components and Muya read. `base.css` binds each one to
its axis:

- on `:root`, to `var(--fui-<name>, <built-in light value>)` — the chrome;
- on `.editor-wrapper`, to `var(--fmd-<name>, var(--fui-<name>, …))` — the
  body, falling back to the chrome so a mixed pair never renders a hole.

Both declarations live in `@layer folira-base`. That matters: a user's custom
CSS is written unlayered, and an unlayered declaration beats a layered one, so
a custom `:root { --editorColor: … }` still wins without the editor having to
rewrite the user's stylesheet. To carry such a declaration across the scope
boundary the runtime mirrors each custom property on the element that declares
it (`--folira-user-<name>: var(--<name>)`), and the `.editor-wrapper` block
reads those aliases first. Copying the declaration text instead would have
changed its cascade position, its selector and its evaluation context.

`applyTheme({ ui, md })` in `util/theme.ts` fills three `<style>` slots
(`ag-theme-ui`, `ag-theme-md`, `ag-theme-prism`), each guarded by a request
token so a slow import cannot overwrite a newer choice. Prism follows the
Markdown axis, and so does `body.dark` — a light chrome around a dark page must
not leave the page's own components rendering light.

`themes:check` runs the generator in `--check` mode, `tokens --check`, and
`verify.mjs` (cascade resolution for all 33 themes, 3830 values compared
against the pre-split files, plus appearance, axis isolation, structural
variables and user-override checks).

## Phase 2 — selection, preview, follow the system

Status: implemented (`becfcf92`, with `f58386a7` fixing the page background
that a mixed pair exposed).

The settings page is now the only place a theme is chosen. The native Theme
menu and the command palette's "Change Theme" entry both offered a fixed list
of six whole themes, which no longer described the model — they were removed
rather than repointed, because one entry point cannot show two axes.

### What Phase 1 left

- `uiTheme` / `mdTheme` exist in the preferences store and default to `''`
  ("follow `theme`"), but nothing in the settings page can set them, and they
  are absent from `shared/preferences-schema.json`, so settings search cannot
  find them either.
- `followSystemTheme` / `lightModeTheme` / `darkModeTheme` are still in the
  store and rendered by the theme page, but no code reads them. The switch is
  inert.
- The theme page is a single grid of 33 hand-styled cards. Every theme id has a
  hand-written colour block in that file, `theme.md` feeds a generated preview,
  and `config.ts` holds a second copy of the theme list.
- The native Theme menu writes a single choice to `localStorage` and calls
  `applyTheme` once; it never reaches the preferences file, so the choice does
  not survive a restart.

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | Following the system stores four fields: `lightUiTheme`, `lightMdTheme`, `darkUiTheme`, `darkMdTheme`. | The system can flip the appearance under us; with one field per axis the pair would have to be re-derived, which either loses the user's per-axis choice or quietly resets it. Four fields keep both axes independent in system mode. |
| D2 | The page has one section per axis; system mode replaces the two grids with two groups of two selects. | Four grids is a wall of cards. Selects are the honest control for "one theme per mode per axis". |
| D3 | Card colours come from a generated `swatches` block in `manifest.json`. | The settings window must not load 66 stylesheets to colour 66 cards, and hand-written colours drift from the files they claim to describe. |
| D4 | Hovering a card renders that pair into a shadow root instead of writing inline custom properties on the preview block. | A shadow root keeps the generated stylesheets (`:root` becomes `:host`, `.editor-wrapper` keeps its name) off the settings page without rewriting the cascade, so a hover can never repaint the window. |
| D5 | The native "theme:system" item turns following on; "theme:<id>" sets both axes to that id and turns following off. | Keeps the pre-split meaning of picking one theme from the menu. |
| D6 | The `localStorage` mirror becomes `{ ui, md }`, and the window URL carries `uith` / `mdth` for first paint. | The first frame renders before the preferences file has been read; with one value it can only paint one axis. |

### Work

**A. Resolution**

- `util/themeSelection.ts`: `resolveThemePair(prefs, appearance)` — in system
  mode read the two fields for that appearance; otherwise
  `uiTheme || theme` and `mdTheme || theme`; validate both ids against the
  manifest and fall back per axis (`light` / `dark`) with one warning.
- `composables/useSystemAppearance.ts`: a `ref<'light' | 'dark'>` driven by
  `matchMedia('(prefers-color-scheme: dark)')`, falling back to `light` when
  the API is absent.
- `store/preferences.ts`: add the four fields; add an idempotent
  `MIGRATE_THEME_PREFERENCES()` that seeds them from `lightModeTheme` /
  `darkModeTheme` only when they are all empty, called once after the stored
  preferences arrive.
- Replace every `xTheme || theme` with the resolver: `pages/app.vue`
  (including the `addStyles` call), `pages/preference.vue`,
  `editorWithTabs/editor.vue` (diagram palette) and
  `editorWithTabs/sourceCode.vue` (CodeMirror theme).
- `tauri-bridge/theme.ts`: `initThemeController` takes a callback that writes
  preferences instead of only `applyTheme`; `resolveInitialTheme` becomes
  `resolveInitialPair`, and `synthesizeEditorUrlArgs` carries both axes;
  `bootstrap.ts` parses them into `initialState`.

**B. Generator**

- `build.mjs` writes `swatches` per theme into `manifest.json` (`ui`: bg, fg,
  side bar, title bar, accent; `md`: bg, fg, h1, link, code background,
  quote border), resolved from the same literals the verifier uses.
- `verify.mjs` fails when a manifest entry has no complete `swatches`, or when
  either axis' background disagrees with the resolved `editorBgColor`.

**C. Settings page**

- `prefComponents/theme/index.vue` rewritten: header, follow-system toggle,
  two sections (search, appearance filter, card grid), preview block, custom
  CSS. `config.ts` and `theme.md` are deleted; `THEMES` from
  `util/themeColor.ts` is the only list.
- Cards are drawn from `swatches`: a UI card shows a title-bar strip, a side
  bar strip and an accent button; a Markdown card shows a background, an
  H1 bar, body lines, a quote and a code line.
- The preview renders into a shadow root: `:root` becomes `:host` and
  `.editor-wrapper` keeps its name, so the interface names resolve on the host
  and the Markdown names on the page inside it, exactly as in a window. Nothing
  the preview loads reaches the settings page. A stylesheet that fails to load
  keeps the pair already on screen and warns once.
- The sample covers headings, emphasis, link, quote, list, table and a code
  block with Prism `token` spans; the Prism stylesheet follows the Markdown
  theme, as it does in the editor.
- Hovering a card sets a local `preview` state; leaving clears it.
- The hidden "import themes" block is removed.

**D. Preferences surface**

- `shared/preferences-schema.json`: `uiTheme` and `mdTheme` entries so
  settings search reaches the page; the four system-mode fields are marked
  `--internal`.
- Locales gain the section titles, filter labels, search placeholder and
  empty state in all ten files (`locale-parity.spec.ts` enforces the set).

**E. Tests**

- `theme-selection.spec.ts`: fixed pair, system light and dark, legacy
  fallback, unknown ids, empty strings.
- `theme-preview.spec.ts`: the preview moves the document scope onto `:host`
  and leaves every other selector alone; the cascade order is base → interface
  → body → Prism → preview chrome; the component renders into a shadow root and
  never touches `document.head`; a mixed pair (light chrome, dracula body)
  resolves the page from `--fmd-*`; the sample carries Prism tokens.

### Acceptance

1. With following off, picking a UI theme changes only the chrome; picking a
   Markdown theme changes only the body.
2. Hovering a card changes the preview; leaving restores the saved pair;
   only a click writes preferences.
3. With following on, switching the OS appearance swaps the pair without a
   restart, and all four choices persist.
4. A preferences file that predates this change renders exactly as before.
5. A cold start loads the cached pair, not the legacy single theme: the ids are
   known before the preferences file arrives, and each stylesheet is fetched
   asynchronously. Inlining critical CSS is out of scope, so this says nothing
   about the very first painted pixels.
6. `typecheck`, `themes:check`, `eslint` and `test:unit` pass.

### Failure modes

- No `matchMedia` (old WebView): treat the system as light.
- An id that no longer exists: fall back on that axis only.
- A theme stylesheet that fails to load while hovering: keep the saved pair
  and warn once. The preview never falls back to a half-styled sample.
- A preview stylesheet that fails to load: the preview keeps the pair already
  rendered and warns once; the settings page itself is never restyled.
- Two windows: the existing `mt::user-preference` broadcast keeps them in
  step; both resolve the pair from the same function.
- Switching the OS appearance while following never writes preferences — the
  system is not the user's choice.

### Out of scope

- First-paint snapshot / critical CSS inlining.
- `--ui-theme` / `--md-theme` command-line flags.
- Export and print following the Markdown theme.
- Per-axis theme registries. `build.mjs` requires `ui/<id>.css` and
  `md/<id>.css` to exist together because the picker lists one card per id and
  the preview reads both files; adding a stylesheet to one axis alone fails the
  build with a message naming the unpaired ids.
- A native theme menu, with a check mark on the current choice. The menu was
  removed in Phase 2; themes are chosen in Preferences.

## Phase 3 — deferred

The remaining items from the original design: an inline first-frame snapshot,
CLI flags that override the pair for one launch, and export/print options that
follow the body theme instead of the chrome.

## Verifying locally

```bash
node packages/desktop/scripts/themes/build.mjs
pnpm --filter folira themes:check
pnpm --filter folira typecheck
pnpm --filter folira test:unit
pnpm --filter folira tauri:dev
```

The generator and verifier also run in CI (`lint.yml`), so a stale
`manifest.json`, `base.css` or `tokens.json` fails the build rather than
shipping.
