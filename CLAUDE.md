# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Folira

## Project Overview

Folira is a lightweight, cross-platform WYSIWYG Markdown editor: a Tauri 2 desktop
shell around a Vue 3 renderer and the Muya editor engine inherited from MarkText.
It supports CommonMark, GitHub Flavored Markdown, math (KaTeX), Mermaid diagrams,
PlantUML, and multiple editing modes (focus, typewriter, source-code).

- **Version**: 0.1.0 — kept in sync in three places: root `package.json`,
  `packages/desktop/package.json`, `packages/desktop/src-tauri/tauri.conf.json`
  and `.../src-tauri/Cargo.toml`.
- **License**: MIT. Upstream attribution is required and lives in `LICENSE`, the
  About dialog and the README lineage section — keep it when editing either.
- **Repository**: https://github.com/829304/Folira (`origin`); the fork this was
  built from is the `upstream` remote (`SugarFatFree/marktext-light`).
- **Lineage**: `marktext/marktext` → `SugarFatFree/marktext-light` → Folira.
  The Electron main process was removed; upstream `src/main/**` is reference
  material for behaviour, not a merge target. Keep desktop changes narrow so the
  fork stays rebasable, and prefer renderer-side code over editing Muya.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 6 (strict) |
| Desktop shell | Tauri 2 (Rust) over the system WebView: WebView2, WKWebView, webkit2gtk |
| Renderer build | Vite 7 via `packages/desktop/vite.tauri.config.ts` (standalone; no electron-vite) |
| Packaging | tauri-bundler, configured entirely in `packages/desktop/src-tauri/tauri.conf.json` |
| Frontend | Vue 3 + Element Plus + Pinia 3 + Vue Router 4 |
| Editor engine | `@muyajs/core` (`packages/muya`, TS) |
| Unit tests | Vitest 4 with jsdom |
| Package manager | pnpm 10.33.4 workspace (`packageManager`); Node.js >= 20.19.0 |
| Rust | stable toolchain, `rust-version = "1.77.2"` |

## Directory Structure

```
<repo-root>/
  package.json              Workspace orchestrator. Proxies every desktop script
                            with `pnpm --filter folira …`; also holds the shared
                            tooling scripts (lint, minify-locales, gen-third-party).
  pnpm-workspace.yaml       `packages: ['packages/*']` plus allowBuilds.
  pnpm-lock.yaml            Single lockfile for the whole workspace.
  eslint.config.js          Root ESLint v9 flat config (desktop;
                            website has its own ESLint 8 config and is ignored).
  scripts/                  minify-locales.ts, generateThirdPartyLicense.ts,
                            validateLicenses.ts, thirdPartyChecker.ts, bundle-size.ts.
  CLAUDE.md, README.md      Project docs. README is Chinese-first, README.en.md
                            is the English mirror.
  docs/                     Requirements (`docs/Folira.md`), logo sources
                            (`Folira-icon.svg`, `Folira-mark.svg`), assets, upstream
                            i18n READMEs.
  packages/
    desktop/                The app (package name: "folira").
      package.json          Vue/editor deps + tauri scripts + test/typecheck.
      vite.tauri.config.ts  Renderer-only Vite config → out-tauri/renderer.
      tsconfig.json / tsconfig.base.json
      vitest.config.ts      jsdom, `test/unit/specs/**/*.spec.ts`.
      static/               Assets bundled into the app: locales/*.json (10
                            locales), preference.json, logos and icons.
      out-tauri/            Renderer build output (git-ignored, rebuildable).
      test/unit/specs/      Vitest specs. No e2e suite exists for Tauri yet.
      src-tauri/            Rust shell — see Architecture.
        tauri.conf.json     Window, bundle targets, icons, file associations.
        capabilities/       Tauri permission grants (default.json).
        icons/              Generated from docs/Folira-icon.svg (do not hand-edit).
        src/                lib.rs, main.rs, startup.rs, commands/, menu/.
      src/
        common/             Pure TS utilities shared with the renderer
                            (keybindings, markdown helpers, filesystem helpers).
        renderer/           Vue 3 application (see Architecture).
          index.html        Entry document, including the inline splash.
          src/              components/, pages/, store/, prefComponents/,
                            commands/, tauri-bridge/, assets/, bus/, router/,
                            services/, util/, i18n/, codeMirror/.
        shared/             Cross-process types and JSON shared by both sides:
                            types/ipc.ts (the invoke/event contract) and
                            preferences-schema.json (the settings schema).
        types/              Ambient .d.ts declarations (window bridges, Muya shim).
    muya/                   `@muyajs/core` — TypeScript editor engine (parser,
                            block state, WYSIWYG renderer). Self-contained
                            toolchain; see packages/muya/AGENTS.md.
    website/                marktext-website (Vite + React 18), standalone.
                            Not part of desktop CI.
```

There is no `src/main/`, `src/preload/`, `electron.vite.config.ts`,
`electron-builder.yml` or Playwright e2e directory — all removed with the
Electron shell.

## Development Workflow

All commands run from the repo root.

```bash
# Dependencies. On Windows use the hoisted linker: pnpm's default junction
# layout breaks the non-native fs.realpathSync some CJS tooling relies on
# (vue-tsc / jsdom resolve the wrong transitive copy otherwise).
pnpm install --config.node-linker=hoisted

# Dev mode: starts Vite on :5174 (beforeDevCommand) and builds/runs the Rust
# crate. The first Rust build takes several minutes; later ones are incremental.
# Renderer edits hot-reload. Rust edits are rebuilt and relaunched automatically.
pnpm --filter folira tauri:dev

# Renderer only — fast check that the Vue app still compiles (~10s)
pnpm --filter folira tauri:build-renderer

# Type check / lint / unit tests (CI enforces all three)
pnpm typecheck
pnpm lint
pnpm test:unit
```

The root `package.json` has **no** `tauri:*` proxies — `pnpm tauri:dev` from the
root fails with a missing script. Use `pnpm --filter folira <script>` (or
`pnpm -C packages/desktop <script>`) for anything Tauri- or desktop-specific.

Scripts that exist on `folira`: `tauri`, `tauri:dev`, `tauri:build`,
`tauri:dev-renderer`, `tauri:build-renderer`, `test`, `test:unit`, `typecheck`,
`typecheck:watch`, `minify-locales`.

Note for automated agents: a Tauri dev run needs to create its WebView2 data
directory under `%LOCALAPPDATA%`. If the launching shell runs at a low Windows
integrity level, that write is denied and the app panics with
`Failed to setup app: 拒绝访问。 (os error 5)` — that is an environment problem,
not an app bug; run it from a normal (or elevated) terminal.

## Build & Release

```bash
pnpm --filter folira tauri:build     # minify-locales, then bundle for this OS
```

`tauri:build` runs `scripts/minify-locales.ts` first (production uses the minified
locales; dev does not). Bundle targets, icons, descriptions and file associations
all come from `packages/desktop/src-tauri/tauri.conf.json`:

- Windows → NSIS, macOS → dmg, Linux → AppImage/deb/rpm.
- Locales ship as a Tauri resource: `{"../static/locales/*.json": "locales/"}`.
- `.md`/`.markdown`/`.txt` etc. are registered through `bundle.fileAssociations`.

CI is `.github/workflows/tauri-build.yml`; artifacts are named
`folira-tauri-<platform>`.

## Testing

```bash
pnpm test                     # desktop unit tests + the website node:test suite
pnpm test:unit                # desktop unit tests only
pnpm test:website             # website docs-search tests only
pnpm lint                     # ESLint (run before committing)
pnpm typecheck                # vue-tsc --noEmit

# Single spec — paths are relative to packages/desktop so pnpm resolves them
# inside that package's vitest config.
pnpm -C packages/desktop exec vitest run test/unit/specs/markdown-basic.spec.ts
pnpm -C packages/desktop exec vitest run -t 'partial test name'
```

The Electron Playwright suite was removed with the Electron main process; it
drove `electron.launch()` and cannot run under the Tauri shell. A Tauri-side
end-to-end suite has not been added yet.

## Code Style

Enforced by ESLint + Prettier. Run `pnpm lint` and `pnpm typecheck` before
committing.

- 2-space indentation, no semicolons, single quotes.
- TypeScript `strict: true`; see `packages/website/content/docs/dev/TYPESCRIPT.md`.
- Cross-process types live in `packages/desktop/src/shared/types/`; ambient
  declarations in `packages/desktop/src/types/`.
- Renderer code runs in a system WebView with **no Node.js access**. Everything
  OS-related goes through the bridge surface (`window.electron.*`,
  `window.fileUtils.*`, `window.path`, …) installed by `tauri-bridge`.

### Comments

Follow [.github/COMMENTING-GUIDELINES.md](.github/COMMENTING-GUIDELINES.md) for
every comment you write. The core rule: a comment must describe what isn't
obvious from the code — rationale, units, invariants, ownership, the abstraction
a caller needs — never restate the code or echo the words already in the name.
Before finishing a change, re-read the comments you added or touched and delete
any that only repeat the code.

## Architecture

### Rust shell — `packages/desktop/src-tauri/src/`

```
lib.rs          Builder: single-instance (must stay first — it decides whether
                the process lives), window-state, opener, clipboard-manager,
                dialog, then a "startup-probe" plugin. setup() attaches the
                startup trace, builds the native menu and installs it;
                on_menu_event routes ids to menu::handle_menu_event.
                invoke_handler lists every #[tauri::command] the renderer may call.
main.rs         Thin entry point → folira_lib::run().
startup.rs      trace()/attach(): appends millisecond-stamped lines to
                <app_log_dir>/startup.log (used to diagnose slow or aborted boots).
commands/
  fs.rs         is_file/read_file/write_file/readdir/stat/move_path/trash_item…
                — the Tauri side of the old `mt::fs::*` channels.
  markdown.rs   read_markdown_file: encoding detection, BOM stripping and
                line-ending normalisation that plain read_file does not do.
  project.rs    scan_project — sidebar tree.
  search.rs     rg_start / rg_cancel — in-process search that replaced the
                bundled ripgrep binary.
  watcher.rs    watch_project / watch_open_files — notify-based watchers.
  paths.rs      is_image / is_same_path helpers.
  cmd.rs        command_exists (PicGo detection) and pandoc_to_markdown.
  boot.rs       boot_info (platform, paths, argv, locale) and load_locale.
menu/
  mod.rs        build_menu + dispatch: builds the native menu from locale
                strings and menu ids (`cmd:`, `palette:`, `viewmode:`, …).
  dispatch.rs   Maps a menu id to the action the renderer should perform.
  i18n.rs       Translation lookup backed by the bundled locale JSON.
```

Menu ids are shared vocabulary: the Rust menu, the renderer's custom menu bar
(`components/menuBar/structure.ts`) and the command table
(`renderer/src/commands/index.ts`) all use the same strings. When you add or
remove a command, update all three (a missing entry fails silently at runtime).

Capabilities in `capabilities/default.json` gate every plugin call for the
`main`, `editor-*` and `settings` windows. Adding a plugin usually means adding
its permission here as well.

### Renderer — `packages/desktop/src/renderer/src/`

- **Boot**: `main.ts` awaits `installTauriBridge()` before mounting Vue. That
  bridge performs the one-shot `boot_info` handshake which replaces the old
  synchronous `ipcRenderer.sendSync('mt::boot-info')`.
- **tauri-bridge/**: recreates the exact `window.electron`, `window.fileUtils`,
  `window.path`, `window.process`, `window.commandExists`, `window.i18nUtils`,
  `window.ripgrep`, `window.uploader`, `window.fonts` surface the renderer and
  Muya already call, but backed by `invoke` and Tauri plugins instead of Node.
  Keeping those signatures is what lets the inherited Vue/Muya code run
  unchanged — prefer fixing things here over rewriting call sites.
- **UI**: `components/` (titleBar, menuBar, sideBar, editorWithTabs, …),
  `prefComponents/` (the settings pages), `pages/`, `router/`.
- **State**: Pinia stores in `store/` — `editor`, `preferences`, `layout`,
  `commandCenter`, `autoUpdates`, `recentFiles`, `bufferedState`.
- **Commands**: `commands/` holds command objects plus `descriptions.ts`, which
  maps command ids to the locale key shown in the command palette.
- The window is frameless (`decorations: false`), so the title bar and menu bar
  are drawn in the renderer; menu clicks are forwarded to Rust with
  `invoke('dispatch_menu', { id })`.

### State & persistence

`tauri-bridge/preferences.ts` debounces writes of two JSON files in the user data
directory (`com.folira.app`): `preferences.json` (settings) and `dataCenter.json`
(session/layout state). The native menu reads the same file so Rust and the
renderer agree on values such as the current theme.

### Themes

`renderer/src/assets/themes/` ships **33 themes**. Each has two files of its own —
`ui/<id>.css` (window chrome) and `md/<id>.css` (document typography) — plus a
syntax palette in `prismjs/`, which most themes name after themselves but four do
not (`light` uses `default.theme.css`; `material-dark` reuses `dark.theme.css`;
`claude-style` and `notion` reuse `github-light.theme.css` — 30 palette files for
33 themes, and `typora-gitbook` ships its own dark-on-navy palette).
`manifest.json` describes every
entry (`id`, `label`, `appearance`, `prism`, `swatches`). `util/themeColor.ts`
lazy-loads the files through `import.meta.glob`, `util/theme.ts` injects them
into three `<style>` slots, `scripts/themes/build.mjs` generates
`base.css`/`manifest.json` (`tokens.mjs` classifies the variables, `verify.mjs`
checks the cascade) — `pnpm --filter folira themes:check` is the gate (see
`docs/THEME_AXES.md`).

Users still pick **one id**: `theme` in `preferences.json` selects all three
files together, and the settings page lists them under Light/Dark tabs.
Per-axis themes are out of scope (see the doc's "Out of scope").

### i18n

`static/locales/*.json` (10 locales) ship as a Tauri resource. Rust resolves the
OS locale (`boot::load_locale`) and the renderer loads the matching bundle.
Locale files are minified for production builds by `scripts/minify-locales.ts`.

## Important Build Notes

- **Path aliases** (`vite.tauri.config.ts`, mirrored in `vitest.config.ts` and
  `tsconfig.base.json`): `@` → `src/renderer/src`, `common` → `src/common`,
  `@shared` → `src/shared`. Vite additionally aliases `path` → `pathe` because
  the renderer has no Node built-ins.
- **Output directories**: the renderer builds to `packages/desktop/out-tauri/renderer`
  (git-ignored); Rust artifacts go to `src-tauri/target/` (ignored by
  `src-tauri/.gitignore`).
- **Icons**: generated from `docs/Folira-icon.svg` with
  `pnpm --filter folira exec tauri icon ../../docs/Folira-icon.svg`. That command
  also emits `android/`, `ios/`, `Square*` and `StoreLogo` files which this
  desktop-only app does not use — delete them after regenerating.
- **Known stubs** (inherited, not yet implemented on the Tauri side): image
  uploader (`tauri-bridge` throws `notifications.imageUploaderUnavailable`) and
  auto-update (no updater plugin configured; the About/menu entry is inert).
- **Identifiers**: `productName`/`identifier`/window title/versions live in
  `tauri.conf.json` and `Cargo.toml`. Changing `identifier` moves the user data
  directory, so do it before users exist.
- **Muya core**: avoid editing `packages/muya` unless fixing a compatibility bug;
  changes there diverge from upstream and are expensive to carry.

## Contribution

- Submit PRs to the **`develop`** branch.
- Reference the related issue in the PR description.
- Run `pnpm lint` and `pnpm typecheck` before submitting; CI enforces both.
- See `.github/CONTRIBUTING.md` for the full contributing guide.
