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

// The themes that still ship and existed before the split. A legacy id with no
// pre-split file means the comparison cannot prove anything, so it fails. A
// theme added later has no pre-split file by definition and skips only this
// comparison — it still goes through every other check below. Do not add new
// themes to this list, and drop an id here when its theme stops shipping.
const PRE_SPLIT_IDS = new Set([
  'ayu-dark',
  'ayu-light',
  'ayu-mirage',
  'catppuccin-latte',
  'catppuccin-mocha',
  'dark',
  'dracula',
  'everforest-dark',
  'everforest-light',
  'graphite',
  'gruvbox-dark',
  'gruvbox-light',
  'horizon-dark',
  'kanagawa',
  'light',
  'material-dark',
  'monokai-pro',
  'nord',
  'one-dark',
  'oxocarbon-dark',
  'palenight',
  'rose-pine',
  'rose-pine-dawn',
  'solarized-dark',
  'solarized-light',
  'synthwave-84',
  'tokyo-night',
  'tokyo-night-light',
  'ulysses'
])

const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/desktop/scripts/themes/tokens.json'), 'utf8'))
const { axis, aliases } = tokens
const aliasOf = new Map(Object.entries(aliases))

const failures = []
const fail = message => failures.push(message)

const read = file => fs.readFileSync(path.join(THEMES, file), 'utf8')

/** Declaration names as written, `--` stripped, so `--fui-x` stays `fui-x`. */
const declarations = css => new Map(variablesOf(css))

/**
 * `#fff`, `#ffffff` and `rgba(255, 255, 255, 1)` are the same colour.
 *
 * A theme may spell a palette entry the way its reference does (hex) while the
 * cascade resolves the same entry to `rgba(...)`; comparing the strings would
 * report a colour that never changed.
 */
const parseColor = value => {
  const text = String(value).trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)
  if (hex) {
    const digits = hex[1]
    const expand = digit => parseInt(digit + digit, 16)
    if (digits.length === 3 || digits.length === 4) {
      return [expand(digits[0]), expand(digits[1]), expand(digits[2]), digits.length === 4 ? expand(digits[3]) / 255 : 1]
    }
    if (digits.length === 6 || digits.length === 8) {
      return [
        parseInt(digits.slice(0, 2), 16),
        parseInt(digits.slice(2, 4), 16),
        parseInt(digits.slice(4, 6), 16),
        digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1
      ]
    }
    return null
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(text)
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])]
  return null
}

const sameColor = (actual, expected) => {
  const left = parseColor(actual)
  const right = parseColor(expected)
  if (left && right) {
    return left.every((channel, index) => Math.abs(channel - right[index]) <= (index === 3 ? 0.002 : 0.5))
  }
  return String(actual).trim() === String(expected).trim()
}

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

/* 2b. Shared and same-axis references must respond to public overrides. */

for (const dir of ['ui', 'md']) {
  for (const file of fs.readdirSync(path.join(THEMES, dir)).filter(name => name.endsWith('.css'))) {
    const css = read(`${dir}/${file}`)
    for (const match of css.matchAll(/var\(\s*--(?:fui-|fmd-)([A-Za-z0-9_-]+)/g)) {
      if (axis[match[1]] === 'dual' || axis[match[1]] === dir) {
        fail(`${dir}/${file}: refers to the internal --${PREFIX[dir]}${match[1]}; a shared or same-axis name must use its public spelling`)
      }
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

/* 4b. Card swatches exist and agree with the scope they claim to describe. */
/*     The picker paints 66 cards from this block; a stale value here is a */
/*     wrong-coloured card rather than a broken theme, so the generator is the */
/*     only place allowed to compute them. */

const SWATCH_KEYS = {
  ui: ['editorBgColor', 'editorColor', 'sideBarBgColor', 'themeColor', 'buttonPrimaryBgColor'],
  md: ['editorBgColor', 'editorColor', 'h1Color', 'linkColor', 'codeBlockBgColor', 'blockquoteBorderColor']
}

for (const entry of manifest) {
  const swatches = entry.swatches
  if (!swatches?.ui || !swatches?.md) {
    fail(`${entry.id}: manifest has no card swatches`)
    continue
  }
  for (const [axis, keys] of Object.entries(SWATCH_KEYS)) {
    for (const key of keys) {
      const value = swatches[axis][key]
      if (typeof value !== 'string' || !value.trim()) {
        fail(`${entry.id}: swatch ${axis}.${key} is missing`)
      }
    }
  }
  const rootBackground = String(resolve(rootScope(entry.id), 'editorBgColor') ?? '').trim()
  if (!sameColor(swatches.ui.editorBgColor ?? '', rootBackground)) {
    fail(`${entry.id}: ui swatch background is ${swatches.ui.editorBgColor}, the chrome resolves to ${rootBackground}`)
  }
  const bodyBackground = String(resolve(editorScope(entry.id, entry.id), 'editorBgColor') ?? '').trim()
  if (!sameColor(swatches.md.editorBgColor ?? '', bodyBackground)) {
    fail(`${entry.id}: md swatch background is ${swatches.md.editorBgColor}, the body resolves to ${bodyBackground}`)
  }
}

/* 5. Derived accents keep following the theme that owns them. */
/*    A default declared as `var(--themeColor)` before the split must still be a */
/*    reference: resolving it to the built-in literal made dark themes green. */

const DERIVED_ACCENTS = ['highlightThemeColor', 'focusColor']
for (const entry of manifest) {
  const scope = rootScope(entry.id)
  const accent = resolve(scope, 'themeColor')
  // A theme that states its own value keeps it; the check only guards the
  // derived defaults the pre-split stylesheet expressed as references.
  const stated = declarations(read(`ui/${entry.id}.css`))
  for (const name of DERIVED_ACCENTS) {
    if (stated.has(`${PREFIX.ui}${name}`)) continue
    const value = resolve(scope, name)
    if (value !== accent) {
      fail(`${entry.id}: --${name} resolves to ${value}, but the theme accent is ${accent}`)
    }
  }
  if (!stated.has(`${PREFIX.ui}buttonFocusBorder`)) {
    const border = String(resolve(scope, 'buttonFocusBorder'))
    if (!border.includes(accent)) {
      fail(`${entry.id}: --buttonFocusBorder resolves to ${border}, which does not follow the theme accent ${accent}`)
    }
  }
}

/* 6. The axes move independently: body colours ignore the UI theme, chrome
 *    colours ignore the Markdown theme. */

const ids = manifest.map(entry => entry.id)
const pick = id => ids.includes(id)
const BODY_SAMPLE = ['editorColor', 'h1Color', 'linkColor', 'codeBlockBgColor', 'blockquoteBorderColor']

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
  }
}

/* Chrome is rendered outside the editor scope, so its half of the isolation
 * contract is "the root block never reads the Markdown axis". */

const baseRootBlock = /:root\s*\{([^}]*)\}/.exec(baseCss)?.[1] ?? ''
const leaked = baseRootBlock.match(/var\(\s*--fmd-([\w-]+)/g) ?? []
for (const match of leaked) {
  fail(`base.css reads ${match} at :root; chrome would follow the Markdown theme`)
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

// The comparison needs the pre-split files. When they are missing altogether
// (no git history, no THEME_LEGACY_DIR) the run cannot prove anything and the
// report below fails unless the sandbox opts out explicitly.
const baselineAvailable = legacyFor('light') !== null

let legacyCompared = 0
const legacySkipped = !baselineAvailable
for (const entry of manifest) {
  if (!baselineAvailable) break
  const source = legacyFor(entry.id)
  if (source === null) {
    // A theme added after the split has nothing to compare against; it still
    // went through the variable, cascade and override checks above. A legacy
    // id without a file means the baseline is incomplete, which would make a
    // green run mean "not checked".
    if (PRE_SPLIT_IDS.has(entry.id)) {
      fail(`${entry.id}: the pre-split baseline has no theme file to compare against`)
    }
    continue
  }
  const block = /:root\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
  const legacy = new Map()
  for (const [name, value] of variablesOf(block)) legacy.set(name, value)

  const root = rootScope(entry.id)
  const pair = editorScope(entry.id, entry.id)
  for (const name of legacy.keys()) {
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
/* 8. A user override of the public accent reaches the primary button. */
/*    Themes that hardcode their button colour keep it; the ones the legacy */
/*    sheet derived from `--themeColor` must derive it again. */

for (const entry of manifest) {
  const id = entry.id
  const declared = declarations(read(`ui/${id}.css`)).get(`${PREFIX.ui}buttonPrimaryBgColor`)
  if (declared === undefined || !declared.includes('var(--themeColor')) continue
  const scope = rootScope(id)
  scope.set('themeColor', '#ff0000')
  const actual = resolve(scope, 'buttonPrimaryBgColor')
  if (actual !== '#ff0000') {
    fail(`${id}: overriding --themeColor leaves the primary button at ${actual}`)
  }
}

/* report */

if (failures.length) {
  console.error(`themes:verify — ${failures.length} problem(s)`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exitCode = 1
} else if (legacySkipped) {
  // Without the pre-split baseline nothing proves the split preserved every
  // legacy value, so a green run would mean "not checked". Fail instead, and
  // let the sandbox opt out explicitly rather than by leaving CI unset.
  if (process.env.THEMES_VERIFY_ALLOW_NO_BASELINE === '1') {
    console.log(`themes:verify — ${manifest.length} themes, cascade checks ok (legacy comparison skipped on request)`)
  } else {
    console.error('themes:verify — the legacy comparison needs the pre-split themes; fetch them (`fetch-depth: 0`) or set THEME_LEGACY_DIR')
    process.exitCode = 1
  }
} else {
  console.log(`themes:verify — ${manifest.length} themes, ${legacyCompared} legacy values, cascade and overrides ok`)
}

export { failures }
