/**
 * Small CSS readers shared by the theme tooling.
 *
 * The theme sources are hand-written, flat CSS: one `:root` (or
 * `.editor-wrapper`) block of custom properties followed by a handful of
 * plain rules. A full parser would be overkill, but a regex over the whole
 * file would confuse a `;` inside `rgb(...)` with the end of a declaration,
 * so brace and paren depth are tracked explicitly.
 */

export const MD_SCOPE = '.editor-wrapper'

export const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

export function matchBrace (source, open) {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error(`unbalanced braces at ${open}`)
}

export function parseBlocks (source) {
  const blocks = []
  let cursor = 0
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor)
    if (open < 0) break
    const close = matchBrace(source, open)
    blocks.push({ selector: source.slice(cursor, open).trim(), body: source.slice(open + 1, close) })
    cursor = close + 1
  }
  return blocks
}

export function parseDeclarations (body) {
  const pieces = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ';' && depth === 0) {
      const piece = body.slice(start, i).trim()
      if (piece) pieces.push(piece)
      start = i + 1
    }
  }
  const tail = body.slice(start).trim()
  if (tail) pieces.push(tail)
  return pieces.map(piece => {
    const colon = piece.indexOf(':')
    return {
      prop: piece.slice(0, colon).trim(),
      value: piece.slice(colon + 1).trim().replace(/\s+/g, ' ')
    }
  })
}

/** Split a `var()` argument list on the first comma that is not nested. */
function splitArguments (inner) {
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) return [inner.slice(0, i), inner.slice(i + 1)]
  }
  return [inner, null]
}

/**
 * Expand every `var()` in a value, recursively. A regex cannot do this: the
 * fallback of `var(--a, var(--b, x))` itself contains a `)`, so the closing
 * paren has to be found by counting depth.
 */
export function expandVars (value, lookup, seen = new Set()) {
  let result = ''
  let cursor = 0
  for (;;) {
    const start = value.indexOf('var(', cursor)
    if (start < 0) return result + value.slice(cursor)
    result += value.slice(cursor, start)
    let depth = 0
    let end = start + 3
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++
      else if (value[end] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    const [rawName, rawFallback] = splitArguments(value.slice(start + 4, end))
    const name = rawName.trim().replace(/^--/, '')
    const resolved = lookup(name, seen)
    if (resolved !== null) result += resolved
    else if (rawFallback !== null) result += expandVars(rawFallback.trim(), lookup, seen)
    else result += 'initial'
    cursor = end + 1
  }
}

/** Resolve `var()` chains against a flat name → value map, for literal output. */
export function resolveValue (map, name, seen = new Set()) {
  if (!map.has(name)) return null
  if (seen.has(name)) return 'initial'
  const next = new Set(seen).add(name)
  return expandVars(
    map.get(name),
    (ref, trail) => (map.has(ref) && !trail.has(ref) ? resolveValue(map, ref, trail) : null),
    next
  )
}

/** Read the custom properties a stylesheet declares, without their `--`. */
export function variablesOf (css) {
  const found = new Map()
  for (const match of stripComments(css).matchAll(/(?:^|(?<=[;{]))\s*--([A-Za-z0-9_-]+)\s*:\s*([^;{}]+);/gm)) {
    found.set(match[1], match[2].trim().replace(/\s+/g, ' '))
  }
  return found
}

/** The handful of colours a theme card draws. */
export const SWATCH_NAMES = {
  ui: ['editorBgColor', 'editorColor', 'sideBarBgColor', 'themeColor', 'buttonPrimaryBgColor'],
  md: ['editorBgColor', 'editorColor', 'h1Color', 'linkColor', 'codeBlockBgColor', 'blockquoteBorderColor']
}

/**
 * Resolve the card swatches for one theme.
 *
 * Each half starts from its own palette: `editorColor` means the chrome in one
 * file and the page in the other, so keeping the maps apart is what stops a
 * Markdown swatch from silently taking the interface colour. The Markdown side
 * then resolves against a merged view: its own declarations win, while a
 * reference that leaves the file (e.g. `--fmd-linkColor: var(--themeColor)`)
 * lands on the interface palette, mirroring how base.css publishes the shared
 * names inside `.editor-wrapper`. The merge only covers shapes both halves can
 * resolve together — a swatch missing from both axes, or one whose chain
 * dangles, still throws instead of painting `initial`.
 */
export function swatchesOf (uiLiterals, mdLiterals, id) {
  const mdView = new Map([...uiLiterals, ...mdLiterals])
  const pick = (literals, names) => {
    const picked = {}
    for (const name of names) {
      const value = resolveValue(literals, name)
      if (value === null || value === 'initial') {
        throw new Error(`${id}: cannot resolve ${name} for the card swatches`)
      }
      picked[name] = value.trim()
    }
    return picked
  }

  return {
    ui: pick(uiLiterals, SWATCH_NAMES.ui),
    md: pick(mdView, SWATCH_NAMES.md)
  }
}
