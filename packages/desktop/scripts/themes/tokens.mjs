/**
 * Decides which axis owns each theme variable, by looking at who reads it.
 *
 * The legacy themes declared one flat palette in `:root`, so a variable's axis
 * is not written anywhere — it has to be derived. Two things make a naive
 * `grep var(--name)` wrong:
 *
 *  - Muya reads the kebab-case aliases (`--h1-color`), not the camel-case
 *    originals (`--h1Color`) the themes declare, so the aliases have to be
 *    followed or every body colour looks unused;
 *  - a few names are written by themes but read by nobody, and they still have
 *    to be preserved verbatim (`deprecated`), not dropped.
 *
 * Run with `--write` after touching the legacy sources; `--check` fails when
 * `tokens.json` is out of date. CI runs `--check`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBlocks, parseDeclarations, stripComments } from './css.mjs'

// Resolved from this file, not the shell: the pnpm filter scripts run with
// `packages/desktop` as the working directory, one level below the repo root.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const RENDERER = path.join(ROOT, 'packages/desktop/src/renderer/src')
const THEMES = path.join(RENDERER, 'assets/themes')
const MUYA = path.join(ROOT, 'packages/muya/src')
const TOKENS = path.join(ROOT, 'packages/desktop/scripts/themes/tokens.json')

const write = process.argv.includes('--write')
const check = process.argv.includes('--check')

function walk (dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'lib', 'dist'].includes(entry.name)) continue
      walk(full, out)
    } else if (/\.(css|vue|ts)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Which axis a source file belongs to, judged by where it lives. */
function axisOfSource (file) {
  const rel = path.relative(RENDERER, file).replace(/\\/g, '/')
  if (file.startsWith(MUYA)) return 'md'
  if (rel === 'assets/styles/index.css') return 'ui'
  if (rel.startsWith('assets/styles/')) return 'md'
  if (rel.startsWith('assets/themes/')) return null
  // editor.vue hosts both the chrome-facing wrapper and the Muya mount point.
  if (rel === 'components/editorWithTabs/editor.vue') return 'both'
  if (/^util\/(exportHtml|pdf|markdownToHtml|export)\.ts$/.test(rel)) return 'md'
  if (/^(components|pages|prefComponents)\//.test(rel)) return 'ui'
  return 'other'
}

function countUsage () {
  const usage = new Map()
  for (const file of [...walk(MUYA), ...walk(RENDERER)]) {
    const axis = axisOfSource(file)
    if (!axis) continue
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/var\(\s*--([A-Za-z0-9_-]+)/g)) {
      const name = match[1]
      if (!usage.has(name)) usage.set(name, { md: 0, ui: 0 })
      const row = usage.get(name)
      if (axis === 'md' || axis === 'both') row.md++
      if (axis === 'ui' || axis === 'both') row.ui++
    }
  }
  return usage
}

function declaredValues () {
  const decls = new Map()
  const add = (name, value) => {
    if (!decls.has(name)) decls.set(name, new Set())
    decls.get(name).add(value)
  }

  // The palette lives in the split light theme now, namespaced per axis; the
  // legacy one-file themes it was originally read from no longer exist.
  for (const [file, prefix] of [['ui/light.css', '--fui-'], ['md/light.css', '--fmd-']]) {
    const full = path.join(THEMES, file)
    const css = stripComments(fs.readFileSync(full, 'utf8'))
    for (const block of parseBlocks(css)) {
      for (const decl of parseDeclarations(block.body)) {
        if (decl.prop.startsWith(prefix)) add(decl.prop.slice(prefix.length), decl.value)
      }
    }
  }

  // The kebab-case aliases are generated into base.css; read them back so
  // --check covers the alias layer too.
  const base = path.join(THEMES, 'base.css')
  if (fs.existsSync(base)) {
    for (const block of parseBlocks(stripComments(fs.readFileSync(base, 'utf8')))) {
      for (const decl of parseDeclarations(block.body)) {
        if (decl.prop.startsWith('--') && !/[A-Z]/.test(decl.prop)) add(decl.prop.slice(2), decl.value)
      }
    }
  }

  return decls
}

function compute () {
  const usage = countUsage()
  const decls = declaredValues()
  const aliases = {}
  for (const [name, values] of decls) {
    if (/[A-Z]/.test(name)) continue
    const target = [...values].map(value => value.match(/^var\(--([A-Za-z_][A-Za-z0-9_-]*)\)$/)?.[1]).find(Boolean)
    if (target && /[A-Z]/.test(target)) aliases[name] = target
  }
  const aliasReads = new Map()
  for (const [kebab, camel] of Object.entries(aliases)) {
    if (!aliasReads.has(camel)) aliasReads.set(camel, [])
    aliasReads.get(camel).push(kebab)
  }
  const axis = {}
  for (const name of decls.keys()) {
    if (!/[A-Z]/.test(name)) continue
    let { md = 0, ui = 0 } = usage.get(name) ?? {}
    for (const kebab of aliasReads.get(name) ?? []) {
      const row = usage.get(kebab) ?? {}
      md += row.md ?? 0
      ui += row.ui ?? 0
    }
    axis[name] = md && ui ? 'dual' : md ? 'md' : ui ? 'ui' : 'deprecated'
  }
  for (const name of decls.keys()) {
    if (/[A-Z]/.test(name)) continue
    const { md = 0, ui = 0 } = usage.get(name) ?? {}
    axis[name] = md && ui ? 'dual' : md ? 'md' : ui ? 'ui' : 'deprecated'
  }
  const sorted = Object.fromEntries(Object.entries(axis).sort(([a], [b]) => a.localeCompare(b)))
  return { aliases: Object.fromEntries(Object.entries(aliases).sort()), axis: sorted }
}

const result = compute()
const serialized = JSON.stringify(result, null, 2) + '\n'

if (check) {
  // Compared with LF endings: a Windows checkout makes the file CRLF, and
  // comparing verbatim would report it stale on every clone.
  const current = fs.existsSync(TOKENS) ? fs.readFileSync(TOKENS, 'utf8').replace(/\r\n/g, '\n') : ''
  if (current !== serialized) {
    console.error('tokens.json is stale — run: node packages/desktop/scripts/themes/tokens.mjs --write')
    process.exitCode = 1
  }
} else if (write) {
  fs.writeFileSync(TOKENS, serialized)
  console.log(`tokens.json: ${Object.keys(result.axis).length} variables, ${Object.keys(result.aliases).length} aliases`)
} else {
  console.log(serialized)
}
