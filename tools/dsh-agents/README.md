# Folira agent presets

Four DSH agent presets for this repository, plus the single override that lets a
Folira session hand work to them:

| preset id | what it is for |
|---|---|
| `theme-agent` | Markdown themes, typography and design tokens on Folira's two independent axes (`--fui-*` / `--fmd-*`). |
| `editor-agent` | The Muya editing core, Markdown fidelity, IME and selection behaviour. |
| `test-agent` | Runs the checks, reads the logs, separates a code fault from an environment fault. |
| `review-agent` | Read-only review: correctness, data integrity, types, theme hygiene, Tauri boundaries. |

Each one is a real preset, not a prompt: its own `@deepseek-ai/dsh-agent-preset`
row with its own plugin list, so it has its own tools and system prompt
independent of the primary agent. `review-agent` is the only one without
`write`/`edit` on its filesystem tool.

## What is in here

```
tools/dsh-agents/
  package.json        bundle manifest (dsh.bundle.patch -> cordis.patch.yml)
  index.js            empty module; the bundle contributes patch rows only
  cordis.patch.yml    four preset inserts + the preset-standard override
```

## How a session calls one

Once the bundle is installed and DSH has restarted, the primary agent's
`subagent` tool accepts the preset id:

```
subagent({ agent_preset: 'theme-agent', description: 'Add the GitHub themes', prompt: '...' })
```

`allowedAgentPresets` on the standard preset's `tool-subagent` is what exposes
that field to the model; the default stays `standard`, so a session that never
names a preset behaves exactly as before.

## Optional review skill

`review-agent` prefers the `differential-review` skill when it is installed; the
preset text says so conditionally, and the agent falls back to running the same
checks directly (and says one line about it) when the skill is absent.

The skill is not vendored here. It is a Trail of Bits project (CC BY-SA 4.0,
© Trail of Bits), while this repository is MIT, so a copy under `.dsh/` is a
machine-local install and `.gitignore` excludes `/.dsh/`. Install it at
`.dsh/skills/differential-review/` in this repository, or into the user's DSH
skills directory; either location satisfies the preset. `review-agent` has no
write tools, so it returns the full report in its final reply and the caller
decides where the report is saved.

## The one override

`cordis.patch.yml` restates `preset-standard` in full. A patch row replaces the
whole configuration of the row it names, so an allowlist cannot be added to
`tool-subagent` without repeating the rest of that preset. Everything in the
restated row is copied unchanged from
`@deepseek-ai/dsh-web-app/presets/standard.patch.yml` except the two lines
(`agentPreset`, `allowedAgentPresets`).

That copy is the maintenance cost: when a DSH update changes the standard
preset, this row must be re-synced or the primary agent silently keeps using the
old plugin list. If that trade is not wanted, delete the `preset-standard` entry
from `cordis.patch.yml` and the four presets still register; they simply cannot
be named from a subagent call until a session switches to a preset that lists
them.

The four presets themselves touch nothing that already exists: they are pure
`insert` rows, and the default preset (`agent-preset-registry.default`) is left
alone.

## Install, update, remove

Install (from any session with the plugin manager):

```
plugin_manager({ action: 'install_bundle', target: 'link:<absolute path to tools/dsh-agents>' })
```

`link:` keeps the directory live, so editing `cordis.patch.yml` and restarting
DSH picks up new text; it still requires the restart because the preset rows are
composed at boot.

Remove with `plugin_manager({ action: 'remove_bundle', target: 'folira-agent-presets' })`.

## Checking the file

`.tmp/check-presets.mjs` (session scratch, not committed) parses the patch,
checks the four inserts, the child ids, the allowlist, and that every plugin name
it mentions appears in the shipped standard preset:

```
node .tmp/check-presets.mjs tools/dsh-agents/cordis.patch.yml .tmp/preset-standard.yml
```
