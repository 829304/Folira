// The generator must resolve each theme half against its own axis. Merging the
// two files with the Markdown half last let a body `themeColor` stand in for the
// chrome one, so an explicit button hover whose literal happened to equal the
// body accent was rewritten to `var(--buttonPrimaryBgColor)` — and then resolved
// to the wrong chrome blue.
//
// This test runs the real generator (not a copy of its logic) twice on a
// temporary fixture: the chrome and the body are given different accents, while
// the chrome's explicit hover equals the body accent, which is the exact shape
// the old merge mis-read. The assertions there fail against the merged
// implementation: the first run rewrites the hover, which is the regression.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../../../../..')
const THEMES = resolve(REPO, 'packages/desktop/src/renderer/src/assets/themes')
const INDEX_CSS = resolve(REPO, 'packages/desktop/src/renderer/src/assets/styles/index.css')
const BUILD = resolve(REPO, 'packages/desktop/scripts/themes/build.mjs')

const fixtureRoot = mkdtempSync(join(tmpdir(), 'folira-themes-'))
const fixtureThemes = join(fixtureRoot, 'themes')

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
  })

/** Every file under `dir`, keyed by relative path, as a content hash. */
const treeHashes = (dir: string): Record<string, string> =>
  Object.fromEntries(
    listFiles(dir)
      .map((file) => [
        relative(dir, file).replace(/\\/g, '/'),
        createHash('sha256').update(readFileSync(file)).digest('hex')
      ])
      .sort(([left], [right]) => left.localeCompare(right))
  )

const replaceOnce = (css: string, from: string, to: string): string => {
  if (!css.includes(from)) throw new Error(`fixture source is missing: ${from}`)
  return css.replace(from, to)
}

/**
 * Copy the real light pair for `lightLiterals` and a fixture pair for the
 * regression. Both are modified through the generator's own inputs, not by
 * writing generated files.
 */
const writeFixture = (): void => {
  rmSync(fixtureThemes, { recursive: true, force: true })
  for (const axis of ['ui', 'md', 'prismjs']) {
    mkdirSync(join(fixtureThemes, axis), { recursive: true })
  }

  // `light` keeps the generator's built-in defaults resolvable.
  copyFileSync(join(THEMES, 'ui/light.css'), join(fixtureThemes, 'ui/light.css'))
  copyFileSync(join(THEMES, 'md/light.css'), join(fixtureThemes, 'md/light.css'))

  const ui = readFileSync(join(THEMES, 'ui/light.css'), 'utf8')
  writeFileSync(
    join(fixtureThemes, 'ui/fixture.css'),
    replaceOnce(
      replaceOnce(
        ui,
        '--fui-themeColor: rgba(33, 181, 111, 1);',
        '--fui-themeColor: #112233;'
      ),
      '--fui-buttonPrimaryBgColorHover: var(--buttonPrimaryBgColor);',
      '--fui-buttonPrimaryBgColorHover: #445566;'
    )
  )

  const md = readFileSync(join(THEMES, 'md/light.css'), 'utf8')
  writeFileSync(
    join(fixtureThemes, 'md/fixture.css'),
    replaceOnce(md, '--fmd-themeColor: rgba(33, 181, 111, 1);', '--fmd-themeColor: #445566;')
  )
}

const runGenerator = (): void => {
  execFileSync(process.execPath, [BUILD], {
    cwd: REPO,
    env: { ...process.env, FOLIRA_THEMES_DIR: fixtureThemes },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

const fixtureCss = (file: string): string => readFileSync(join(fixtureThemes, file), 'utf8')

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('theme generator axis isolation', () => {
  it('keeps an explicit chrome hover when a body token shares its value', () => {
    // The generator would write the checked-in index.css if it lacked the
    // structural default; make the precondition explicit so the run stays
    // read-only outside the fixture.
    expect(readFileSync(INDEX_CSS, 'utf8')).toContain('--editorAreaWidth:')

    writeFixture()
    const repoThemesBefore = treeHashes(THEMES)

    runGenerator()

    const uiAfterFirstRun = fixtureCss('ui/fixture.css')
    expect(uiAfterFirstRun).toMatch(/--fui-buttonPrimaryBgColorHover:\s*#445566;/)
    expect(uiAfterFirstRun).toMatch(/--fui-themeColor:\s*#112233;/)

    const hashesAfterFirstRun = treeHashes(fixtureThemes)
    runGenerator()
    expect(treeHashes(fixtureThemes)).toEqual(hashesAfterFirstRun)

    // Only the fixture directory may have changed.
    expect(treeHashes(THEMES)).toEqual(repoThemesBefore)
  }, 30_000)
})
