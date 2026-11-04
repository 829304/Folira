# Muya engine sync (2026-11)

Branch `sync/muya-2026-11`, based on `develop` at `807ad0ad`. Not merged yet.

## Why

The engine was frozen at the point marktext-light forked from MarkText,
`43bd8b77` (2026-07-06). Upstream `marktext/develop` had moved 414 commits
ahead (HEAD `a88838f5`, 2026-11-03), 181 of them inside `packages/muya`.
Replaying patches one by one against a four-month-old tree costs more than
taking the new tree and re-applying the local work, so this branch does the
latter.

## What this branch does

1. Replaces `packages/muya` wholesale with `marktext/develop` at
   `a88838f5`, and removes `packages/muyajs` — upstream deleted it, and the
   desktop renderer already imports `@muyajs/core` everywhere.
2. Adapts the desktop side to the new engine surface (see
   `fix(desktop): adapt to the synced muya engine`): types now come from
   `packages/muya/lib/types` instead of a hand-written shim,
   `isGitlabCompatibilityEnabled` becomes `texMathGfm`, and `getTOC()` items
   are copied into the store's `ListItem` shape.
3. Re-applies marktext-light's engine work: 22 of its 27 Muya commits, plus
   one that had to be rewritten for the new parser.

Everything below is engine-side. No application behaviour was changed on
purpose.

## Applied commits

Each row is `upstream commit` → `commit on this branch`.

| marktext-light | this branch | Subject |
| --- | --- | --- |
| `c866a62b` | `b5f57d44` | perf(muya): replace the markdown token queue with a stream |
| `7637d549` | `68f0901e` | test(muya): guard the large-document parse from inside the engine |
| `4bbf98bf` | `fa9bb7e2` | perf: locate the large-document bottleneck, and clear three suspects |
| `f79f503e` | `3c67a795` | perf(muya): register math rules only where they could match |
| `22d77ecc` | `55e57e8a` | perf(muya): count words in one pass, after measurement rejected the first try |
| `91f83dd0` | `d7db0bea` | perf(muya): serialize the live state instead of a copy of it |
| `9a1954b5` | `3af1a689` | perf: keep the 170 KB icon set out of startup |
| `77b634a0` | `697ca69d` | perf(muya): load the emoji table when the picker needs it |
| `1202003c` | `950fc290` | test(muya): assert the emoji picker actually offers suggestions |
| `7b9b3028` | `d07c6903` | fix(muya): prefetch the emoji table instead of waiting for the first colon |
| `cde8ccbd` | `6c0c00a9` | fix(muya): log a failed icon-set load instead of swallowing it |
| `733874f1` | `9113e9b3` | test(muya): withdraw the picker-population assertion, and say why |
| `9f1ee8ef` | `49879733` | docs: measure what the engine costs, so the next trace can be read |
| `1becbac9` | `543567a9` | docs: rule out the caret placement as a large-document cost |
| `93299c91` | `4f8de0d5` | docs: rule out the caret placement, and remove scratch specs I left behind |
| `bebdf9bc` | `e2f5a231` | test(muya): pin memory linear in document size, and correct the figure |
| `23986ff7` | `f5a023c3` | perf(muya): gate the footnote rule the way the math rules already are |
| `8f39bd3f` | `ebf84c7c` | perf(muya): index the DOM bindings instead of scanning them all |
| `613000c0` | `1a3eb80e` | perf(muya): reposition every code block's gutter in one frame |
| `7d3b3b2a` | `e0c9f2f0` | test(muya): guard the code-block cost curve, not just the code that flattened it |
| `96856b5f` | `d41b9674` | perf(muya): count while walking the list instead of collecting it first |
| `63ce15c8` | `2234781d` | test: measure lexing against line length, and pin what is flat |

`c866a62b`, `f79f503e` and `7637d549` were applied by hand: the first two
conflict with the rewritten parser, and the third moved a test into the
engine's own `__tests__` directory.

## Skipped commits

| Commit | Subject | Reason |
| --- | --- | --- |
| `0323af5a` | collect link reference definitions once per document | The new engine already does this: `src/inline/referenceDefinitions.ts` caches labels per state object and its comment names #4887 as the motivation. `src/inline/__tests__/referenceDefinitions.spec.ts` covers the cache. |
| `6b67519d` | collect reference definitions from the live state | Same chain as `0323af5a`; nothing left to port. |
| `bb359280` | stop copying the document twice per edit | `JSONState` no longer dispatches per operation. `Editor` commits pass `jsonState.rawState` into `createChangePayload`, which keeps a reference, so there is no clone to remove. |
| `1d71b960` | position code-block line numbers after measuring them | The new engine already measures every gutter first (`measureLineTops`) and handles empty lines (#5294). `src/utils/__tests__/codeBlockLineNumbers.spec.ts` pins it. |
| `9e9b49f9` | CI workflow tweak | It only edits CI files that no longer exist in this repository. |

## Engine fixes written during the port

- `fix(muya): resolve prism component globs against the hoisted store` —
  `loadLanguage.ts` imported `../../../node_modules/prismjs/...`, which is
  wrong once pnpm hoists `prismjs` to the repository root. Vite's
  `vite:dynamic-import-vars` turned that into six unhandled errors in the
  desktop unit suite.
- `fix(muya): keep block math inside quotes` — the math gate added by
  `f79f503e` looked for a newline followed by `$`, so `> $$` never matched
  and the block rule was not registered at all.
- `test(muya): watch style writes through the element, not the style proxy`
  — happy-dom 21 backs `style` with a proxy whose `defineProperty` trap
  returns falsy.
- `test(muya): read round-trip fixtures with LF, as the app does` — a
  Windows checkout hands the fixtures CRLF, and `\r` breaks fence closing.
  The app normalises to LF on load (`src-tauri/src/commands/markdown.rs`).

## Verification

| Suite | Result |
| --- | --- |
| `pnpm --filter @muyajs/core test` | 368 files, 4718 passed, 76 skipped |
| `pnpm --filter @muyajs/core test:spec` | 4 files, 1347 passed |
| `pnpm --filter folira test:unit` | 72 files, 819 passed |
| `pnpm --filter @muyajs/core lint:types` | clean |
| `pnpm --filter folira typecheck` | clean |
| `pnpm --filter @muyajs/core lint` | clean (4 pre-existing warnings) |

## Follow-ups

- `c866a62b` is the load-bearing change: `markdownToState` now drains a
  `TokenStream` instead of `shift()`/`unshift(...)`. Anything that assumes
  the old array API would regress large documents, so keep
  `state/__tests__/largeDocumentParse.spec.ts` and
  `block/__tests__/largeDocumentOpen.spec.ts` in the suite.
- `613000c0` batches gutter writes into one frame. A document with many code
  blocks is the case to try by hand.
- Math and footnote rules are now gated on a textual pre-check (`$`, `[^`).
  If a new container type (quotes, lists, tables) can carry those markers,
  the pre-check has to learn it.
- Dependency jumps to confirm visually: mermaid 11 → 12, katex 0.16 → 0.19,
  marked 16 → 18, vitest 4 → 5, vite 7 → 8.
- `pnpm-workspace.yaml` records `nodeLinker: hoisted`; a plain `pnpm install`
  now reproduces the layout these paths were fixed for.

## Next sync

```sh
git fetch marktext develop
git checkout -b sync/muya-<date>
git checkout marktext/develop -- packages/muya
```

Then diff `git log <last-sync-upstream>..marktext/develop -- packages/muya`
against the current tree and re-apply only our own engine commits, which are
the ones this document lists.
