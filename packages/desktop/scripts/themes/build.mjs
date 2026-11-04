/**
 * Generates the two-axis theme files and the glue the renderer reads.
 *
 * A legacy theme declared every colour in one `:root` block, so the chrome and
 * the Markdown body could only move together. `--migrate` splits each legacy
 * file along the ownership recorded in tokens.json:
 *
 *   ui/<id>.css    :root           { --fui-<name>: … }  chrome only
 *   md/<id>.css    .editor-wrapper { --fmd-<name>: … }  body only
 *
 * Everything else is regenerated from those split files on every run:
 *
 *   base.css       publishes the `--<name>` names the components already read,
 *                  resolving them against the UI theme at :root and the
 *                  Markdown theme inside .editor-wrapper;
 *   manifest.json  the list the theme picker and the loader read.
 *
 * Names are never renamed, which is what makes the split invisible: Muya keeps
 * reading `--h1-color`, the chrome keeps reading `--editorBgColor`.
 *
 * Usage:
 *   node scripts/themes/build.mjs             # regenerate base.css + manifest.json
 *   node scripts/themes/build.mjs --migrate   # one-off split of the legacy files
 *   node scripts/themes/build.mjs --check     # fail if the generated files are stale
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MD_SCOPE, parseBlocks, parseDeclarations, resolveValue, stripComments, variablesOf } from './css.mjs'

// Resolved from this file, not the shell: the pnpm filter scripts run with
// `packages/desktop` as the working directory, one level below the repo root.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const RENDERER = path.join(ROOT, 'packages/desktop/src/renderer/src')
const THEMES = path.join(RENDERER, 'assets/themes')
const INDEX_CSS = path.join(RENDERER, 'assets/styles/index.css')
const TOKENS_FILE = path.join(ROOT, 'packages/desktop/scripts/themes/tokens.json')

const PREFIX = { ui: 'fui-', md: 'fmd-' }

const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')
const migrate = args.has('--migrate')

const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))
const { axis, aliases } = tokens
const aliasOf = new Map(Object.entries(aliases))

/** Chrome-only selectors; every other selector styles the Markdown surface. */
const CHROME_SELECTOR =
  /^(:root|::-webkit-scrollbar|::selection|body|html|\.title-bar|\.side-bar|\.open-project|\.editor-tabs|\.tabs-container|\.recent-files-projects|\.el-|\.notification)/

/** Prism themes that ship under a different name than the editor theme. */
const PRISM_ALIASES = { 'material-dark': 'dark' }

/**
 * Layout variables the user controls at runtime (`setEditorWidth` writes them
 * at :root). They are not palette, so they must not be re-bound inside
 * `.editor-wrapper` — that would make the width preference a no-op in the
 * editor while the settings window kept obeying it.
 */
const STRUCTURAL = new Set(['editorAreaWidth'])

/** Names declared inside a theme file, without the axis prefix. */
const declaredNames = css => {
  const names = new Set()
  for (const match of css.matchAll(/--(?:fui-|fmd-)([A-Za-z0-9_-]+)\s*:/g)) names.add(match[1])
  return names
}

const referencedNames = css => [...new Set([...css.matchAll(/var\(\s*--(?:fui-|fmd-)([A-Za-z0-9_-]+)/g)].map(m => m[1]))]

const rewrite = (value, kind) =>
  value.replace(/var\(\s*--([A-Za-z0-9_-]+)/g, (match, name) => {
    // Aliases stay public: base.css declares them in both scopes.
    if (aliasOf.has(name)) return `var(--${name}`
    return axis[name] ? `var(--${PREFIX[kind]}${name}` : match
  })

function splitTheme (id, css) {
  const blocks = parseBlocks(stripComments(css))
  const root = blocks.find(block => block.selector === ':root')
  if (!root) throw new Error(`${id}: no :root block`)

  const ui = []
  const md = []
  for (const decl of parseDeclarations(root.body)) {
    if (!decl.prop.startsWith('--')) continue
    const name = decl.prop.slice(2)
    if (aliasOf.has(name)) continue // declared globally in base.css
    if (STRUCTURAL.has(name)) continue // layout, user-controlled at :root
    const place = axis[name] ?? 'deprecated'
    // Deprecated names go on both axes: nothing reads them today, but dropping
    // them would change rendering for anyone who styles the app.
    if (place === 'ui' || place === 'dual' || place === 'deprecated') {
      ui.push({ name, value: rewrite(decl.value, 'ui') })
    }
    if (place === 'md' || place === 'dual' || place === 'deprecated') {
      md.push({ name, value: rewrite(decl.value, 'md') })
    }
  }

  const tail = blocks.filter(block => block !== root)
  const renderRules = (list, kind) =>
    list
      .map(block => {
        const body = parseDeclarations(block.body)
          .map(decl => `  ${decl.prop}: ${rewrite(decl.value, kind)};`)
          .join('\n')
        return `${block.selector} {\n${body}\n}`
      })
      .join('\n\n')
  const chromeTail = tail.filter(block => CHROME_SELECTOR.test(block.selector))
  const bodyTail = tail.filter(block => !CHROME_SELECTOR.test(block.selector))
  const renderVars = (list, kind) => list.map(v => `  --${PREFIX[kind]}${v.name}: ${v.value};`).join('\n')

  return {
    uiCss: [
      `/* Folira UI theme: ${id}. Generated from ${id}.theme.css by scripts/themes/build.mjs. */`,
      `:root {\n${renderVars(ui, 'ui')}\n}`,
      chromeTail.length ? renderRules(chromeTail, 'ui') : ''
    ]
      .filter(Boolean)
      .join('\n\n'),
    mdCss: [
      `/* Folira Markdown theme: ${id}. Generated from ${id}.theme.css by scripts/themes/build.mjs. */`,
      `${MD_SCOPE} {\n${renderVars(md, 'md')}\n}`,
      bodyTail.length ? renderRules(bodyTail, 'md') : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }
}

function closingBrace (source, open) {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error('unbalanced braces')
}

/**
 * The built-in light theme has no file of its own: it lives in the `:root`
 * block of index.css. Move it into the same two-file shape so every theme is a
 * pair, and leave index.css with the structural variables only. Values are
 * resolved to literals here because index.css is about to stop declaring them.
 */
function migrateLight () {
  const source = fs.readFileSync(INDEX_CSS, 'utf8')
  const root = parseBlocks(stripComments(source)).find(block => block.selector === ':root')
  const decls = parseDeclarations(root.body)
  const moved = decls.filter(decl => decl.prop.startsWith('--') && axis[decl.prop.slice(2)])
  if (!moved.length) return null
  const literals = new Map(moved.map(decl => [decl.prop.slice(2), decl.value]))
  const ui = []
  const md = []
  for (const decl of moved) {
    const name = decl.prop.slice(2)
    if (aliasOf.has(name)) continue
    const value = resolveValue(literals, name) ?? decl.value
    const place = axis[name]
    if (place === 'ui' || place === 'dual' || place === 'deprecated') ui.push({ name, value })
    if (place === 'md' || place === 'dual' || place === 'deprecated') md.push({ name, value })
  }
  const kept = decls.filter(decl => !moved.includes(decl)).map(decl => `  ${decl.prop}: ${decl.value};`)
  // Replace the body by brace position: `root.body` came from the
  // comment-stripped copy, so a textual replace against the original would
  // silently match nothing.
  const open = source.indexOf('{', source.indexOf(':root'))
  const end = closingBrace(source, open)
  const renderVars = (list, kind) =>
    list.map(v => `  --${PREFIX[kind]}${v.name}: ${v.value};`).join('\n')
  return {
    uiCss: `/* Folira UI theme: light. Generated from index.css by scripts/themes/build.mjs. */\n\n:root {\n${renderVars(
      ui,
      'ui'
    )}\n}`,
    mdCss: `/* Folira Markdown theme: light. Generated from index.css by scripts/themes/build.mjs. */\n\n${MD_SCOPE} {\n${renderVars(
      md,
      'md'
    )}\n}`,
    index: source.slice(0, open + 1) + '\n' + kept.join('\n') + '\n' + source.slice(end),
    removed: moved.length
  }
}

/* ------------------------------------------------------------------ aggregate */

function luminance (value) {
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3) {
      digits = digits
        .split('')
        .map(d => d + d)
        .join('')
    }
    const [r, g, b] = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  // The built-in light theme spells its background as rgba(), not hex.
  const fn = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
  if (fn) {
    const [r, g, b] = fn.slice(1, 4).map(channel => Number(channel) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return null
}

const titleCase = id =>
  id
    .split('-')
    .map(word =>
      word.length <= 3 && /^[a-z]+$/.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)
    )
    .join(' ')

function renderBaseCss (lightLiterals) {
  const themeNames = Object.keys(axis)
    .filter(name => !aliasOf.has(name))
    .filter(name => !STRUCTURAL.has(name))
    .sort()
  const fallback = name => lightLiterals.get(name) ?? 'initial'
  // Reference an axis only where it declares the name: pointing at an
  // `--fmd-` that no Markdown palette defines reads as a typo to
  // theme-variables.spec.ts, which requires every var() to resolve.
  const rootValue = name =>
    axis[name] === 'md'
      ? fallback(name)
      : `var(--${PREFIX.ui}${name}, ${fallback(name)})`
  const scopeValue = name => {
    if (axis[name] === 'md') return `var(--${PREFIX.md}${name}, ${fallback(name)})`
    if (axis[name] !== 'dual') return `var(--${PREFIX.ui}${name}, ${fallback(name)})`
    return `var(--${PREFIX.md}${name}, var(--${PREFIX.ui}${name}, ${fallback(name)}))`
  }
  const root = [
    ...themeNames.map(name => `  --${name}: ${rootValue(name)};`),
    ...[...aliasOf].map(([kebab, camel]) => `  --${kebab}: var(--${camel});`)
  ]
  // Structural names are deliberately absent here: :root keeps the value
  // index.css declares, so `setEditorWidth` and user CSS reach the editor.
  const scope = [
    ...themeNames.map(name => `  --${name}: ${scopeValue(name)};`),
    ...[...aliasOf].map(([kebab, camel]) => `  --${kebab}: var(--${camel});`)
  ]
  return [
    '/*',
    ' * Publishes the variable names the components already read.',
    ' *',
    ' * The chrome reads them from :root, so they resolve against the UI theme.',
    ' * Everything inside .editor-wrapper re-binds them to the Markdown theme',
    ' * first, which is what lets the two axes move independently. The last',
    ' * fallback is the built-in light value, so a theme that omits a name still',
    ' * renders the way it did when index.css carried those defaults.',
    ' *',
    ' * The kebab-case aliases are declared in both scopes on purpose: a custom',
    ' * property resolves where it is declared, so inheriting the alias from',
    ' * :root would pin it to the UI palette inside the editor.',
    ' *',
    ' * Generated by scripts/themes/build.mjs — do not edit.',
    ' */',
    ':root {',
    root.join('\n'),
    '}',
    '',
    `${MD_SCOPE} {`,
    scope.join('\n'),
    '}',
    ''
  ].join('\n')
}

/* --------------------------------------------------------------------- main */

// Compare and write LF, ignore the checkout's line endings: on Windows these
// files arrive as CRLF, and a --check that compared them verbatim would report
// every generated file stale on every clone.
function normalizeEol (text) {
  return text.replace(/\r\n/g, '\n')
}

function writeFile (file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  content = normalizeEol(content)
  const previous = fs.existsSync(file) ? normalizeEol(fs.readFileSync(file, 'utf8')) : null
  if (previous === content) return
  if (checkOnly) {
    console.error(`stale: ${path.relative(ROOT, file)}`)
    process.exitCode = 1
    return
  }
  fs.writeFileSync(file, content)
}

const idsIn = dir =>
  fs
    .readdirSync(path.join(THEMES, dir))
    .filter(name => name.endsWith('.css'))
    .map(name => name.replace(/\.css$/, ''))
    .sort()

function aggregate () {
  const uiIds = idsIn('ui')
  const mdIds = idsIn('md')
  const onlyUi = uiIds.filter(id => !mdIds.includes(id))
  const onlyMd = mdIds.filter(id => !uiIds.includes(id))
  if (onlyUi.length || onlyMd.length) {
    throw new Error(`ui/md theme lists differ — ui only: [${onlyUi}], md only: [${onlyMd}]`)
  }

  const prismDir = path.join(THEMES, 'prismjs')
  const prismIds = new Set(
    fs
      .readdirSync(prismDir)
      .filter(name => name.endsWith('.theme.css'))
      .map(name => name.replace(/\.theme\.css$/, ''))
  )

  const lightLiterals = new Map()
  for (const file of ['ui/light.css', 'md/light.css']) {
    for (const [name, value] of variablesOf(fs.readFileSync(path.join(THEMES, file), 'utf8'))) {
      const bare = name.startsWith(PREFIX.ui) ? name.slice(PREFIX.ui.length) : name.slice(PREFIX.md.length)
      if (!lightLiterals.has(bare)) lightLiterals.set(bare, value)
    }
  }

  const manifest = uiIds.map(id => {
    const uiCss = fs.readFileSync(path.join(THEMES, `ui/${id}.css`), 'utf8')
    const mdCss = fs.readFileSync(path.join(THEMES, `md/${id}.css`), 'utf8')
    for (const name of variablesOf(uiCss).keys()) {
      if (!name.startsWith(PREFIX.ui)) throw new Error(`ui/${id}.css declares non-ui variable --${name}`)
    }
    for (const name of variablesOf(mdCss).keys()) {
      if (!name.startsWith(PREFIX.md)) throw new Error(`md/${id}.css declares non-md variable --${name}`)
    }
    // Resolve the background through the theme's own references instead of
    // reading a literal: `light` spells it as rgba(), and several themes point
    // at a palette entry. A value we cannot resolve is a generator bug, not a
    // reason to guess "dark".
    const literals = new Map()
    for (const [name, value] of variablesOf(uiCss)) {
      literals.set(name.slice(PREFIX.ui.length), value)
    }
    for (const [name, value] of variablesOf(mdCss)) {
      const bare = name.slice(PREFIX.md.length)
      if (!literals.has(bare)) literals.set(bare, value)
    }
    const background = resolveValue(literals, 'editorBgColor')
    const lum = background === null ? null : luminance(background.trim())
    if (lum === null) throw new Error(`${id}: cannot resolve editorBgColor for the appearance flag`)
    const prism = PRISM_ALIASES[id] ?? (prismIds.has(id) ? id : null)
    return { id, label: titleCase(id), appearance: lum > 0.5 ? 'light' : 'dark', prism }
  })

  writeFile(path.join(THEMES, 'base.css'), renderBaseCss(lightLiterals))
  writeFile(path.join(THEMES, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    `themes: ${manifest.length} (${manifest.filter(t => t.appearance === 'light').length} light / ${
      manifest.filter(t => t.appearance === 'dark').length
    } dark), variables: ${Object.keys(axis).length}, aliases: ${aliasOf.size}`
  )
}

/* -------------------------------------------------------- normalisation */

const BLOCK_OF = { ui: ':root', md: MD_SCOPE }

/**
 * Rewrites only the variable block of a theme file. The tail rules are kept
 * byte-for-byte: they carry hand-written layout, not palette.
 */
function rewriteThemeFile (id, kind, transform) {
  const file = path.join(THEMES, `${kind}/${id}.css`)
  const source = fs.readFileSync(file, 'utf8')
  const block = parseBlocks(stripComments(source)).find(candidate => candidate.selector === BLOCK_OF[kind])
  if (!block) throw new Error(`${kind}/${id}.css: no ${BLOCK_OF[kind]} block`)

  const decls = parseDeclarations(block.body)
  const next = transform(decls)
  if (next === null) return

  const rendered = next.map(decl => `  ${decl.prop}: ${decl.value};`).join('\n')
  const open = source.indexOf('{', source.indexOf(BLOCK_OF[kind]))
  const end = closingBrace(source, open)
  writeFile(file, `${source.slice(0, open + 1)}\n${rendered}\n${source.slice(end)}`)
}

const bareName = (kind, prop) => prop.slice(2 + PREFIX[kind].length)

/** `--editorAreaWidth` belongs to the layout, not to either palette. */
function stripStructural (id) {
  for (const kind of ['ui', 'md']) {
    rewriteThemeFile(id, kind, decls => {
      const kept = decls.filter(decl => !STRUCTURAL.has(bareName(kind, decl.prop)))
      return kept.length === decls.length ? null : kept
    })
  }
}

/**
 * A declaration may reference a name the other axis owns (`--fmd-floatShadow`
 * used by a Markdown-only rule while `floatShadow` is chrome). Copying the
 * donor's value onto this axis keeps the reference intact and keeps the axis
 * independent; leaving it out resolves to nothing and drops the declaration.
 */
function promoteCrossAxis (id) {
  const files = { ui: `ui/${id}.css`, md: `md/${id}.css` }
  const known = {}
  const refs = {}
  for (const kind of ['ui', 'md']) {
    known[kind] = new Map()
    const css = fs.readFileSync(path.join(THEMES, files[kind]), 'utf8')
    for (const [name, value] of variablesOf(css)) known[kind].set(name.slice(PREFIX[kind].length), value)
    refs[kind] = referencedNames(css)
  }

  for (const kind of ['ui', 'md']) {
    const other = kind === 'ui' ? 'md' : 'ui'
    rewriteThemeFile(id, kind, decls => {
      const declared = new Set(decls.map(decl => bareName(kind, decl.prop)))
      const pending = [...refs[kind]]
      let changed = false
      while (pending.length) {
        const name = pending.shift()
        if (declared.has(name)) continue
        const donor = known[kind].get(name) ?? known[other].get(name)
        if (donor === undefined) {
          throw new Error(`${files[kind]}: --${PREFIX[kind]}${name} is referenced but no theme defines it`)
        }
        // Re-home the donor's own references so the copy inherits nothing.
        const value = donor.replace(/var\(\s*--(?:fui-|fmd-)([A-Za-z0-9_-]+)/g, (whole, ref) => {
          pending.push(ref)
          return `var(--${PREFIX[kind]}${ref}`
        })
        decls.push({ prop: `--${PREFIX[kind]}${name}`, value })
        declared.add(name)
        known[kind].set(name, value)
        changed = true
      }
      return changed ? decls : null
    })
  }
}

/** index.css owns the layout defaults the themes no longer declare. */
function ensureStructuralDefault () {
  const source = fs.readFileSync(INDEX_CSS, 'utf8')
  if (source.includes('--editorAreaWidth:')) return
  const open = source.indexOf('{', source.indexOf(':root'))
  const end = closingBrace(source, open)
  const line = '\n  /* Layout, set by the width preference; not part of either axis. */\n  --editorAreaWidth: 750px;'
  writeFile(INDEX_CSS, `${source.slice(0, end)}${line}\n${source.slice(end)}`)
}

function normalize () {
  for (const id of idsIn('ui')) {
    stripStructural(id)
    promoteCrossAxis(id)
    // A promotion can reveal a reference the donor itself made to a name that
    // only became known in this pass, so settle it in a second run.
    promoteCrossAxis(id)
  }
  ensureStructuralDefault()
}

if (migrate) {
  const legacy = fs
    .readdirSync(THEMES)
    .filter(name => name.endsWith('.theme.css'))
    .sort()
  if (!legacy.length) throw new Error('no legacy *.theme.css files left to migrate')
  for (const file of legacy) {
    const id = file.replace(/\.theme\.css$/, '')
    const result = splitTheme(id, fs.readFileSync(path.join(THEMES, file), 'utf8'))
    writeFile(path.join(THEMES, `ui/${id}.css`), result.uiCss)
    writeFile(path.join(THEMES, `md/${id}.css`), result.mdCss)
  }
  const light = migrateLight()
  if (light) {
    writeFile(path.join(THEMES, 'ui/light.css'), light.uiCss)
    writeFile(path.join(THEMES, 'md/light.css'), light.mdCss)
    writeFile(INDEX_CSS, light.index)
    console.log(`migrated ${legacy.length} themes, moved ${light.removed} light variables out of index.css`)
  } else {
    console.log(`migrated ${legacy.length} themes (light already migrated)`)
  }
}

normalize()
aggregate()
