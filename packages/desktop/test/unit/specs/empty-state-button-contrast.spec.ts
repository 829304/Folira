import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// #4774: the sidebar "Open Folder" and editor "New File" empty-state buttons
// styled their label as `color: var(--themeColor)` on
// `background-color: var(--itemBgColor)`. Neither is a contrast-controlled
// pairing, so the label was unreadable in several themes (e.g. ayu-light,
// everforest-light). Every theme already defines a contrast-tuned primary
// pairing (--buttonPrimaryFontColor / --buttonPrimaryBgColor) that drives the
// app-wide `.button-primary`. These buttons must be at least as readable as
// that standard primary button in EVERY built-in theme.

const __dirname = dirname(fileURLToPath(import.meta.url))
const RENDERER = resolve(__dirname, '../../../src/renderer/src')
const THEME_DIR = resolve(RENDERER, 'assets/themes')
// Themes are split per axis: the chrome palette lives in ui/, and base.css
// republishes it under the names the components read.
const UI_DIR = resolve(THEME_DIR, 'ui')
const BASE_CSS = resolve(THEME_DIR, 'base.css')

type Rgb = [number, number, number]
type Rgba = [number, number, number, number]

const parseVars = (css: string): Record<string, string> => {
  const vars: Record<string, string> = {}
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) vars[m[1]] = m[2].trim()
  return vars
}

/** Index of the comma that separates a var()'s name from its fallback, if any. */
const topLevelComma = (text: string): number => {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) return i
  }
  return -1
}

/** Expands the innermost var() so nested fallbacks like rgb() survive. */
const expandOnce = (text: string, vars: Record<string, string>): string => {
  const start = text.indexOf('var(')
  if (start < 0) return text
  let depth = 0
  let end = start + 3
  for (; end < text.length; end++) {
    if (text[end] === '(') depth++
    else if (text[end] === ')') {
      depth--
      if (depth === 0) break
    }
  }
  const inner = text.slice(start + 4, end)
  const comma = topLevelComma(inner)
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
  const fallback = comma < 0 ? '' : inner.slice(comma + 1).trim()
  const replacement = (vars[name] ?? fallback).trim()
  return text.slice(0, start) + replacement + text.slice(end + 1)
}

const resolveVar = (value: string, vars: Record<string, string>): string => {
  let v = value
  let guard = 0
  while (/var\(/.test(v) && guard++ < 20) {
    v = expandOnce(v, vars).trim()
  }
  return v
}

const toRgba = (raw: string): Rgba | null => {
  const str = raw.trim()
  let m: RegExpMatchArray | null
  if ((m = str.match(/^#([0-9a-fA-F]{3})$/))) {
    const h = m[1]
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
      1
    ]
  }
  if ((m = str.match(/^#([0-9a-fA-F]{6})$/))) {
    const h = m[1]
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1
    ]
  }
  if ((m = str.match(/^rgba?\(([^)]+)\)/))) {
    const p = m[1].split(',').map((s) => parseFloat(s.trim()))
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]
  }
  // Some themes use a gradient for the primary button background; the solid
  // stop is representative for a contrast estimate.
  if (/^linear-gradient/.test(str)) {
    const h = str.match(/#([0-9a-fA-F]{6})/)
    if (h) return toRgba('#' + h[1])
  }
  return null
}

// Composite a translucent colour over an opaque backdrop.
const over = (fg: Rgba, bg: Rgb): Rgb => {
  const a = fg[3]
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a)
  ]
}

const relLuminance = ([r, g, b]: Rgb): number => {
  const f = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const contrast = (a: Rgb, b: Rgb): number => {
  const l1 = relLuminance(a)
  const l2 = relLuminance(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

// Resolve a (foreground var, background var) pairing to its rendered WCAG
// contrast for a given theme, compositing any translucent colours over the
// surface the button sits on.
const pairContrast = (
  fgVar: string,
  bgVar: string,
  surfaceVar: string,
  vars: Record<string, string>
): number => {
  const surface = toRgba(resolveVar(`var(${surfaceVar})`, vars))
  const surfaceRgb: Rgb = surface ? [surface[0], surface[1], surface[2]] : [255, 255, 255]
  const bgRaw = toRgba(resolveVar(`var(${bgVar})`, vars))
  const fgRaw = toRgba(resolveVar(`var(${fgVar})`, vars))
  if (!bgRaw || !fgRaw) throw new Error(`unresolved colour ${fgVar}/${bgVar}`)
  const bg = bgRaw[3] < 1 ? over(bgRaw, surfaceRgb) : [bgRaw[0], bgRaw[1], bgRaw[2]] as Rgb
  const fg = fgRaw[3] < 1 ? over(fgRaw, bg) : [fgRaw[0], fgRaw[1], fgRaw[2]] as Rgb
  return contrast(fg, bg)
}

// Pull the foreground (color) and background-color custom-property names the
// empty-state button rule assigns, straight from the component's scoped CSS.
const extractButtonVars = (
  componentPath: string
): { fgVar: string; bgVar: string } => {
  const css = readFileSync(componentPath, 'utf8')
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(css))) {
    const selector = m[1]
    const body = m[2]
    if (!selector.includes('.is-text.is-has-bg')) continue
    if (/:hover|:focus/.test(selector)) continue
    const bg = body.match(/(?<![-\w])background-color:\s*var\(\s*(--[\w-]+)/)
    const fg = body.match(/(?<![-\w])color:\s*var\(\s*(--[\w-]+)/)
    if (bg && fg) return { fgVar: fg[1], bgVar: bg[1] }
  }
  throw new Error(`no .is-text.is-has-bg colour rule found in ${componentPath}`)
}

// Only the :root half of base.css matters here: the .editor-wrapper block
// re-binds the same names to the Markdown theme. Read the block itself instead
// of slicing at the selector — the file's header comment names it too.
const baseSource = readFileSync(BASE_CSS, 'utf8')
const baseRoot = /:root\s*\{([^}]*)\}/.exec(baseSource)?.[1] ?? ''
const baseVars = parseVars(baseRoot)
const themeFiles = readdirSync(UI_DIR).filter((f) => f.endsWith('.css'))

const COMPONENTS = [
  {
    name: 'Open Folder (sidebar/tree.vue)',
    path: resolve(RENDERER, 'components/sideBar/tree.vue'),
    surfaceVar: '--sideBarBgColor'
  },
  {
    name: 'New File (recent/index.vue)',
    path: resolve(RENDERER, 'components/recent/index.vue'),
    surfaceVar: '--editorBgColor'
  },
  {
    name: 'Open Folder (sideBar/search.vue no-data)',
    path: resolve(RENDERER, 'components/sideBar/search.vue'),
    surfaceVar: '--sideBarBgColor'
  }
]

describe('empty-state button readability (#4774)', () => {
  it('found theme files and base variables to test against', () => {
    expect(themeFiles.length).toBeGreaterThan(20)
    expect(baseVars['--buttonPrimaryFontColor']).toBeTruthy()
    expect(baseVars['--buttonPrimaryBgColor']).toBeTruthy()
  })

  for (const component of COMPONENTS) {
    it(`${component.name} label is at least as readable as the standard primary button, in every theme`, () => {
      const { fgVar, bgVar } = extractButtonVars(component.path)
      const failures: string[] = []

      for (const file of themeFiles) {
        // The theme file declares the axis-private names (`--fui-…`) that
        // base.css points at, so the two maps are merged as-is: a base value
        // such as `var(--fui-buttonPrimaryBgColor, #…)` resolves through the
        // entry the theme file contributes.
        const vars = {
          ...baseVars,
          ...parseVars(readFileSync(resolve(UI_DIR, file), 'utf8'))
        }
        const buttonContrast = pairContrast(fgVar, bgVar, component.surfaceVar, vars)
        const primaryContrast = pairContrast(
          '--buttonPrimaryFontColor',
          '--buttonPrimaryBgColor',
          component.surfaceVar,
          vars
        )
        // Equal is fine (the button reuses the primary pairing); only a
        // strictly-worse contrast than the standard primary button fails.
        if (buttonContrast < primaryContrast - 0.01) {
          failures.push(
            `${file.replace('.css', '')}: button ${buttonContrast.toFixed(2)} < primary ${primaryContrast.toFixed(2)}`
          )
        }
      }

      expect(failures, `\n  ${failures.join('\n  ')}\n`).toEqual([])
    })
  }
})

describe('primary button contrast in Notion and Typora GitBook', () => {
  const states = ['', 'Hover', 'Active']
  const cases = ['notion', 'typora-gitbook'].flatMap(theme => states.map(state => ({ theme, state, label: state || 'default' })))

  it.each(cases)('$theme primary button ($label) meets 4.5:1 for normal text', ({ theme, state, label }) => {
    const vars = { ...baseVars, ...parseVars(readFileSync(resolve(UI_DIR, `${theme}.css`), 'utf8')) }
    const ratio = pairContrast(
      `--buttonPrimaryFontColor${state}`,
      `--buttonPrimaryBgColor${state}`,
      '--editorBgColor',
      vars
    )
    expect(ratio, `${theme} ${label} primary button has ${ratio.toFixed(2)}:1 contrast`)
      .toBeGreaterThanOrEqual(4.5)
  })
})
