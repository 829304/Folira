# Themes

Folira ships **31 built-in themes** — 12 light and 19 dark. A theme is a single choice: it sets the window chrome (title bar, sidebar, tabs, menus, settings), the page (type, headings, quotes, code blocks, tables, links) and the syntax-highlighting palette at once, so the three always agree with each other.

## Choosing a theme

Open `Preferences` → `Theme`. The list is split into **Light** and **Dark** tabs and opens on the tab of the theme you are currently using.

- **Browse** — the tabs only switch which themes are listed; they do not change the editor.
- **Search** — filters within the current tab. The search term is kept when you switch tabs.
- **Preview** — hovering a card, or focusing it with <kbd>Tab</kbd>, previews that theme in the strip above the list without applying it. Moving away puts the preview back.
- **Apply** — clicking a card applies the theme and saves it. It is stored as `theme` in `preferences.json` and restored on the next start.

A theme whose id is no longer shipped (for example after an upgrade) falls back to the `Light` theme; the rest of your preferences are left untouched.

## Custom CSS

`Preferences` → `Theme` → `Custom CSS` appends a stylesheet after the active theme, so it wins wherever the two have equal specificity. Syntax colours are the simple case: every built-in palette claims `.token.*` at the same weight as this rule (GitHub Light additionally keeps its selectors inside `:where(.editor-wrapper)`, which adds nothing), so

```css
.token.keyword { color: #7c3aed; }
```

applies to every built-in theme without a prefix.

For the document itself, themes write their rules under `.editor-wrapper` (and structural ones — gutter, zebra rows, task boxes, nested quotes — at the engine's own weight or above). A bare `h2 { … }` therefore loses to a theme that styles `.editor-wrapper h2`; use the same shape, or a stronger selector, when you want to override the typography a theme sets:

```css
.editor-wrapper h2 { letter-spacing: -0.01em; }
```

A handful of the inherited themes still mark individual rules (code blocks, thematic breaks, diagrams) as `!important`; overriding those needs `!important` too. The repository's `docs/THEME_AXES.md` lists which rules already sit at engine weight.

## Light themes

| Theme | id | Notes |
| --- | --- | --- |
| AYU Light | `ayu-light` | Warm grey paper, gentle contrast |
| Catppuccin Latte | `catppuccin-latte` | Pastel light with warm neutrals |
| Claude Style | `claude-style` | Warm paper, ink text, terracotta accents; tuned for long Chinese prose |
| Everforest Light | `everforest-light` | Green-tinted paper |
| GitHub Light | `github-light` | GitHub's own Markdown look: Primer chrome, Prettylights syntax |
| Graphite | `graphite` | Neutral grey light |
| Gruvbox Light | `gruvbox-light` | Retro, warm light |
| Light | `light` | Folira's plain light default |
| Rose Pine Dawn | `rose-pine-dawn` | Soft rose light |
| Solarized Light | `solarized-light` | The classic cream background |
| Tokyo Night Light | `tokyo-night-light` | Cool blue-white light |
| Ulysses | `ulysses` | Muted lavender grey, built for long sessions |

## Dark themes

| Theme | id | Notes |
| --- | --- | --- |
| AYU Dark | `ayu-dark` | Deep blue-grey |
| AYU Mirage | `ayu-mirage` | The softer AYU variant |
| Catppuccin Mocha | `catppuccin-mocha` | Warm pastel dark |
| Dark | `dark` | Folira's plain dark default |
| Dracula | `dracula` | Purple-tinted dark |
| Everforest Dark | `everforest-dark` | Forest green dark |
| Gruvbox Dark | `gruvbox-dark` | Retro, warm dark |
| Horizon Dark | `horizon-dark` | Vivid warm dark |
| Kanagawa | `kanagawa` | Ink-wash inspired dark |
| Material Dark | `material-dark` | Material Design dark |
| Monokai PRO | `monokai-pro` | Monokai Pro dark |
| Nord | `nord` | Arctic blue-grey |
| ONE Dark | `one-dark` | Atom's One Dark |
| Oxocarbon Dark | `oxocarbon-dark` | IBM Carbon minimal dark |
| Palenight | `palenight` | Purple-tinted dark |
| Rose Pine | `rose-pine` | Muted rose dark |
| Solarized Dark | `solarized-dark` | The classic teal dark |
| Synthwave 84 | `synthwave-84` | 1980s neon |
| Tokyo Night | `tokyo-night` | Cool blue dark |

## Theme credits

Many of these themes follow colour schemes published by the developer community. Each project keeps its own license; the links below are the upstream sources.

- [Ayu](https://github.com/ayu-theme) — MIT
- [Anthropic brand palette](https://www.anthropic.com) — paper `#faf9f5`, ink `#141413` and terracotta `#d97757` are the starting point for Claude Style. Its look was checked against [Typora Claude-Like Theme](https://github.com/Muyiiiii/Typora_Claude-Like_Theme) and [Claude Paper for Obsidian](https://github.com/Law-Of-Cycles/claude-paper-obsidian) (both MIT); the Folira theme is written from scratch, no upstream CSS is copied.
- [Catppuccin](https://github.com/catppuccin/catppuccin) — MIT
- [Dracula](https://github.com/dracula/dracula-theme) — MIT
- [Everforest](https://github.com/sainnhe/everforest) — MIT
- [GitHub: Primer](https://github.com/primer/primitives) (interface tokens and the Prettylights syntax palette) and [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) (document styles) — MIT
- [Gruvbox](https://github.com/morhetz/gruvbox) — MIT
- [Horizon](https://github.com/jolaleye/horizon-theme-vscode) — MIT
- [Kanagawa](https://github.com/rebelot/kanagawa.nvim) — MIT
- [Material Theme](https://github.com/material-theme/vsc-material-theme) — MIT
- [Monokai Pro](https://monokai.pro) — see upstream
- [Nord](https://github.com/nordtheme/nord) — MIT
- [One Dark](https://github.com/atom/one-dark-syntax) — MIT
- [Oxocarbon](https://github.com/nyoom-engineering/oxocarbon.nvim) — MIT
- [Palenight](https://github.com/drewtempelmeyer/palenight.vim) — MIT
- [Rosé Pine](https://github.com/rose-pine/rose-pine-theme) — MIT
- [Solarized](https://github.com/altercation/solarized) — MIT
- [Synthwave '84](https://github.com/robb0wen/synthwave-vscode) — MIT
- [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme) — MIT
- [Gogh Themes](https://github.com/Gogh-Co/Gogh) — MIT (colour palette reference)
