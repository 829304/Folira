/**
 * Checks the theme split the way a browser would resolve it.
 *
 * build.mjs proves the generated files are self-consistent; this script proves
 * the *cascade* is: which declaration wins at `:root`, which ones win inside
 * `.editor-wrapper`, and what happens when the user overrides a variable at
 * runtime (editor width, custom CSS). Those are the cases a value-by-value
 * comparison of the split files cannot see.
 *
 * Usage: node scripts/themes/verify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveValue, variablesOf } from './css.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const RENDERER = path.join(ROOT, 'packages/desktop/src/renderer/src')
const THEMES = path.join(RENDERER, 'assets/themes')
const INDEX_CSS = path.join(RENDERER, 'assets/styles/index.css')

const PREFIX = { ui: 'fui-', md: 'fmd-' }
const STRUCTURAL = new Set(['editorAreaWidth'])

const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/desktop/scripts/themes/tokens.json'), 'utf8'))
const { axis, aliases } = tokens
const aliasOf = new Map(Object.entries(aliases))

const failures = []
const fail = message => failures.push(message)

const read = file => fs.readFileSync(path.join(THEMES, file), 'utf8')

/** Declaration names as written, `--` stripped, so `--fui-x` stays `fui-x`. */
const declarations = css => new Map(variablesOf(css))

const blockOf = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

const resolve = (scope, name) => resolveValue(scope, name)

const baseCss = read('base.css')
const baseRoot = declarations(blockOf(baseCss, ':root'))
const baseEditor = declarations(blockOf(baseCss, '.editor-wrapper'))
const indexRoot = declarations(blockOf(fs.readFileSync(INDEX_CSS, 'utf8'), ':root'))

/**
 * What the browser sees at `:root`: base.css publishes the plain names, the UI
 * palette supplies the `fui-` ones those names point at, and index.css keeps
 * the structural ones.
 */
const rootScope = id => {
  const scope = new Map(baseRoot)
  for (const [name, value] of Object.entries(aliases)) scope.set(name, `var(--${value})`)
  for (const [name, value] of declarations(read(`ui/${id}.css`))) scope.set(name, value)
  for (const [name, value] of indexRoot) scope.set(name, value)
  return scope
}

/** `.editor-wrapper`: the Markdown palette re-binds the plain names it owns. */
const editorScope = (uiId, mdId) => {
  const scope = rootScope(uiId)
  for (const [name, value] of declarations(read(`md/${mdId}.css`))) scope.set(name, value)
  for (const [name, value] of baseEditor) scope.set(name, value)
  return scope
}

/* 1. Every reference resolves inside its own file, aliases aside. */

for (const dir of ['ui', 'md']) {
  for (const file of fs.readdirSync(path.join(THEMES, dir)).filter(name => name.endsWith('.css'))) {
    const css = read(`${dir}/${file}`)
    const owned = new Set([...declarations(css).keys()].filter(name => name.startsWith(PREFIX[dir])).map(name => name.slice(PREFIX[dir].length)))
    for (const match of css.matchAll(/var\(\s*--(?:fui-|fmd-)([A-Za-z0-9_-]+)/g)) {
      if (owned.has(match[1])) continue
      fail(`${dir}/${file}: --${PREFIX[dir]}${match[1]} is referenced but not declared on this axis`)
    }
  }
}

/* 2. Layout variables stay out of both palettes. */

for (const dir of ['ui', 'md']) {
  for (const file of fs.readdirSync(path.join(THEMES, dir)).filter(name => name.endsWith('.css'))) {
    for (const name of STRUCTURAL) {
      if (read(`${dir}/${file}`).includes(`--${PREFIX[dir]}${name}:`)) {
        fail(`${dir}/${file}: declares --${PREFIX[dir]}${name}; layout must stay in index.css`)
      }
    }
  }
}

/* 3. Layout variables are never re-bound inside the editor. */

for (const name of STRUCTURAL) {
  if (baseEditor.has(name)) {
    fail(`base.css re-binds --${name} inside .editor-wrapper; the width preference would be ignored there`)
  }
}

/* 4. The appearance flag follows the colour, not the file name. */

const manifest = JSON.parse(read('manifest.json'))
const luminance = value => {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3) digits = [...digits].map(d => d + d).join('')
    const [r, g, b] = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(value)
  if (fn) {
    const [r, g, b] = fn.slice(1, 4).map(channel => Number(channel) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return null
}

for (const entry of manifest) {
  const scope = rootScope(entry.id)
  const background = resolve(scope, 'editorBgColor')
  const lum = background === null ? null : luminance(String(background).trim())
  if (lum === null) {
    fail(`${entry.id}: cannot resolve --editorBgColor for the appearance flag`)
    continue
  }
  const expected = lum > 0.5 ? 'light' : 'dark'
  if (entry.appearance !== expected) {
    fail(`${entry.id}: appearance is "${entry.appearance}" but editorBgColor resolves to ${background} (${expected})`)
  }
}

/* 5. The axes move independently: body colours ignore the UI theme, chrome
 *    colours ignore the Markdown theme. */

const ids = manifest.map(entry => entry.id)
const pick = id => ids.includes(id)
const BODY_SAMPLE = ['editorColor', 'h1Color', 'linkColor', 'codeBlockBgColor', 'blockquoteBorderColor']
// Chrome-only names: dual-owned ones (float menus, selection) legitimately
// follow the Markdown theme *inside* the editor, so they cannot be asserted here.
const CHROME_SAMPLE = ['sideBarBgColor', 'titleBarBgColor', 'buttonPrimaryBgColor', 'buttonFocusBorder', 'focusColor']

if (pick('light') && pick('dark')) {
  for (const [ui, md] of [['light', 'dark'], ['dark', 'light']]) {
    const scope = editorScope(ui, md)
    const mdOnly = editorScope(md, md)
    for (const name of BODY_SAMPLE) {
      if (axis[name] === 'ui') continue
      const body = resolve(scope, name)
      const expected = resolve(mdOnly, name)
      if (body !== expected) {
        fail(`${name}: ui=${ui} md=${md} resolves to ${body}, but md=${md} alone resolves to ${expected}`)
      }
    }
    for (const name of CHROME_SAMPLE) {
      if (axis[name] === 'md') continue
      const chrome = resolve(rootScope(ui), name)
      const inside = resolve(editorScope(ui, md), name)
      if (chrome !== inside) {
        fail(`${name}: ui=${ui} resolves to ${chrome} at :root but ${inside} inside the editor (md=${md})`)
      }
    }
  }
}

/* 6. The width preference is layout: it must survive the editor re-binding. */

for (const pair of [['light', 'light'], ['dark', 'dark'], ['light', 'dark']]) {
  const scope = editorScope(pair[0], pair[1])
  const widthOverride = 'calc(100px + 60ch)'
  scope.set('editorAreaWidth', widthOverride)
  if (resolve(scope, 'editorAreaWidth') !== widthOverride) {
    fail(`ui=${pair[0]} md=${pair[1]}: the width preference does not reach the editor scope`)
  }
  if (resolve(scope, 'editor-area-width') !== widthOverride) {
    fail(`ui=${pair[0]} md=${pair[1]}: --editor-area-width does not follow the width preference`)
  }
}

/* 7. The same-name pair still renders exactly what the legacy theme did. */

const SPLIT_COMMIT = '4df59485'
// `THEME_LEGACY_DIR` lets offline runs (and the sandbox) point at a directory
// holding the pre-split files — the git path is unusable wherever spawning a
// child process is blocked. Files are named after their basename.
const legacyAt = relativePath => {
  if (process.env.THEME_LEGACY_DIR) {
    const local = path.join(process.env.THEME_LEGACY_DIR, path.basename(relativePath))
    try {
      return fs.readFileSync(local, 'utf8')
    } catch {
      return null
    }
  }
  try {
    return execFileSync('git', ['show', `${SPLIT_COMMIT}^:${relativePath}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return null
  }
}

const legacyFor = id => {
  if (id === 'light') return legacyAt('packages/desktop/src/renderer/src/assets/styles/index.css')
  return legacyAt(`packages/desktop/src/renderer/src/assets/themes/${id}.theme.css`)
}

let legacyCompared = 0
let legacySkipped = false
for (const entry of manifest) {
  const source = legacyFor(entry.id)
  if (source === null) {
    legacySkipped = true
    break
  }
  const block = /:root\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
  const legacy = new Map()
  for (const [name, value] of variablesOf(block)) legacy.set(name, value)

  const root = rootScope(entry.id)
  const pair = editorScope(entry.id, entry.id)
  for (const [name, value] of legacy) {
    // Structural variables live in index.css, and a name the split never
    // registered is not part of any palette (theme-variables.spec.ts already
    // fails on a var() that nothing declares).
    if (aliasOf.has(name) || !Object.hasOwn(axis, name) || STRUCTURAL.has(name)) continue
    const place = axis[name] ?? 'deprecated'
    const expected = resolveValue(legacy, name)
    // A name the legacy file itself could not resolve was initial back then
    // too; there is nothing to preserve.
    if (expected === 'initial') continue
    if (place !== 'md') {
      const actual = resolve(root, name)
      if (actual !== expected) {
        fail(`${entry.id}: --${name} at :root resolves to ${actual}, the legacy theme had ${expected}`)
      }
      legacyCompared++
    }
    if (place !== 'ui') {
      const actual = resolve(pair, name)
      if (actual !== expected) {
        fail(`${entry.id}: --${name} in .editor-wrapper resolves to ${actual}, the legacy theme had ${expected}`)
      }
      legacyCompared++
    }
  }
}
/* report */

if (failures.length) {
  console.error(`themes:verify — ${failures.length} problem(s)`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exitCode = 1
} else if (legacySkipped) {
  console.log(`themes:verify — ${manifest.length} themes, cascade checks ok (legacy comparison skipped: no git history)`)
} else {
  console.log(`themes:verify — ${manifest.length} themes, ${legacyCompared} legacy values, cascade and overrides ok`)
}

export { failures }
