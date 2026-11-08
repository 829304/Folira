<p align="center">
  <img src="docs/assets/logo-small.png" width="96" height="96" alt="Folira">
</p>

<h1 align="center">Folira</h1>

<p align="center"><strong>A light, quiet cross-platform Markdown editor</strong><br>
WYSIWYG, so your attention stays on the words.</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/829304/Folira/releases/latest"><img src="https://img.shields.io/github/v/release/829304/Folira?label=release&style=for-the-badge" alt="release"></a>
  <a href="https://github.com/829304/Folira/releases"><img src="https://img.shields.io/github/downloads/829304/Folira/total.svg?style=for-the-badge" alt="downloads"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT">
  <img src="https://img.shields.io/static/v1.svg?label=Platform&message=Windows%20%7C%20macOS%20%7C%20Linux&style=for-the-badge" alt="platform">
</p>

## What it is

Folira is an open-source desktop Markdown editor. What you type is what the page looks like — there is no preview pane, and nothing to switch between.

It is built with **Tauri 2 + Rust + Vue 3**. The editor engine is MarkText's Muya; the shell uses the WebView the operating system already has instead of shipping a browser of its own, so the installer is a few megabytes, startup is faster, and memory use is lower.

## Screenshot

> Screenshots will be added once the rebranding and theme work lands.

## Features

- **WYSIWYG**: headings, lists, tables and math take shape at the cursor — the editing surface is the finished page
- **Standards**: [CommonMark](https://spec.commonmark.org) and [GitHub Flavored Markdown](https://github.github.com/gfm/), with selective support for [Pandoc Markdown](https://pandoc.org/MANUAL.html#pandocs-markdown)
- **Extensions**: math (KaTeX), Mermaid diagrams, PlantUML sequence and flow charts, tables, task lists, front matter, emoji
- **Three writing modes**: source code, typewriter, focus
- **Export**: HTML and PDF
- **Images**: paste from the clipboard or drag them in
- **Files**: tabs, a sidebar file tree, a table-of-contents panel, full-text search
- **Themes**: 33 built in (14 light, 19 dark); one choice sets the chrome, the page and the syntax colours
- **Ten interface languages**: de, en, es, fr, ja, ko, pt, tr, zh-CN, zh-TW

## Themes

Folira ships 33 built-in themes — 14 light and 19 dark. A theme is a single choice: it sets the window chrome (title bar, sidebar, tabs, menus, settings), the page (type, headings, quotes, code blocks, tables) and the syntax-highlighting palette together, so none of them can drift out of step with the others.

`Preferences` → `Theme` lists them under **Light** and **Dark** tabs, opens on the tab of the theme in use, and filters with a search box. Hovering a card previews it before you apply; custom CSS is appended after the theme, so it wins at equal specificity (syntax colours need no prefix; typography a theme sets needs a selector of the same shape, such as `.editor-wrapper h2`).

Most palettes come from community colour schemes (GitHub Primer, GitBook, Notion, Catppuccin, Dracula, Nord, Tokyo Night, Solarized, …). The full list and its sources are in [Themes](packages/website/content/docs/end-user/THEMES.md).

## Download and installation

Installers are on the [latest release](https://github.com/829304/Folira/releases/latest). Every platform links the system WebView rather than bundling one — that is where the size saving comes from, and it is the one thing to have on the machine before installing.

#### Windows

An NSIS installer (`.exe`) for x64. It needs the Microsoft Edge **WebView2** runtime, which ships with Windows 11 and is installed by the setup wizard on Windows 10 if it is missing.

#### macOS

A `.dmg` each for **arm64** and **x64** — no universal build, so pick the one matching your machine. The WebView (WKWebView) is part of the OS; nothing else to install.

The app is **not code-signed or notarised**, so Gatekeeper will refuse it on first open: right-click the app and choose *Open*, or clear the quarantine attribute with

```bash
xattr -dr com.apple.quarantine /Applications/Folira.app
```

#### Linux

An `.AppImage`, a `.deb` and a `.rpm` for x64. All three need **webkit2gtk 4.1** and GTK 3 from your distribution:

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

## Relationship to upstream

Folira is not an editor written from scratch. It stands on MarkText:

```
MarkText (Electron, by Jocs and its contributors)
   └── marktext-light (a Tauri shell)
          └── Folira (branding, interface, themes)
```

- The editor engine [Muya](https://github.com/marktext/muya) and most of the interface come from [MarkText](https://github.com/marktext/marktext), under the MIT licence
- The Tauri shell comes from [marktext-light](https://github.com/SugarFatFree/marktext-light)
- What Folira adds is branding and icons, the interface's visual design, the theme system, and the image-upload and auto-update work that follows

The editor's own capabilities — parsing, typesetting, import and export — stay upstream's job; Folira does not reimplement them, and picks up upstream improvements selectively.

## Development

Prerequisites:

- Node.js **>= 20.19** (CI runs Node 22)
- pnpm **10.33.4** (pinned by `packageManager` in the root `package.json`; `corepack` can enable it)
- Rust **stable**, plus the platform's C toolchain: MSVC on Windows, Xcode Command Line Tools on macOS, the distribution's GTK/WebKitGTK packages on Linux
- WebView2 on Windows

```bash
pnpm install                        # install dependencies
pnpm --filter folira tauri:dev      # dev mode: renderer HMR + incremental Rust builds
pnpm --filter folira tauri:build    # package for the current platform
pnpm --filter folira test:unit      # unit tests
pnpm --filter folira typecheck      # type check
pnpm lint                           # ESLint
```

Repository layout, module boundaries and the finer development conventions are in [CLAUDE.md](CLAUDE.md); requirements and design notes are under [docs/](docs).

## Roadmap

- [x] Remove the Electron main process and its build tooling; keep only the Tauri shell
- [x] Fix the build, type and unit-test issues left by that migration
- [x] Rebranding: name, icons, window title, installer identity
- [x] Theme system: one theme id drives the chrome, the page and the syntax colours, browsed under Light/Dark tabs
- [x] New theme: GitHub Light (Primer chrome, Prettylights syntax)
- [x] New light theme: Typora GitBook (GitBook / Azure reading style)
- [x] New light theme: Notion (neutral document look)
- [ ] New light theme: Bear
- [ ] New light theme: iA Writer
- [ ] New light theme: Paper / Sepia
- [ ] Image upload (PicGo or a custom script)
- [ ] Auto-update
- [ ] Release pipelines for Windows, macOS and Linux

## Contributing

Please read the [contributing guide](.github/CONTRIBUTING.md) before opening a pull request. Day-to-day work lands on `develop`; `main` carries released versions.

## Licence

[MIT](LICENSE). Copyright for the original work belongs to Luo Ran (Jocs) and the MarkText Contributors; the Tauri shell belongs to marktext-light's author.
