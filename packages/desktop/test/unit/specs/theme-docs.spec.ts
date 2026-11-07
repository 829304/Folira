import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

import { THEMES } from '@/util/themeColor'

// The end-user theme page is published on the website, so it drifts silently:
// nothing in the build reads it. These assertions keep its table honest against
// the manifest the app actually ships. The path leaves the desktop package on
// purpose — that coupling is the point, and it breaks loudly if the site moves.
const doc = readFileSync(
  resolve(__dirname, '../../../../website/content/docs/end-user/THEMES.md'),
  'utf8'
)

const documentedNames = Array.from(doc.matchAll(/^\| (.+?) \| `([a-z0-9-]+)` \|/gm), match => [
  match[1],
  match[2]
])

const documentedIds = documentedNames.map(([, id]) => id)

const deletedIds = ['tokyo-night-storm', 'rose-pine-moon', 'cyberdream', 'nightfox']

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)

describe('the published theme page', () => {
  it('lists every shipped theme and nothing else', () => {
    expect(documentedIds.slice().sort()).toEqual(THEMES.map(theme => theme.id).sort())
  })

  it('spells every label the way the manifest does', () => {
    const documented = documentedNames.map(([label, id]) => ({ label, id })).sort(byLabel)
    const shipped = THEMES.map(theme => ({ label: theme.label, id: theme.id })).sort(byLabel)

    expect(documented).toEqual(shipped)
  })

  it('splits the list the way the manifest does', () => {
    const light = THEMES.filter(theme => theme.appearance === 'light').length
    const dark = THEMES.filter(theme => theme.appearance === 'dark').length

    expect(doc).toContain(`**${THEMES.length} built-in themes** — ${light} light and ${dark} dark`)
  })

  it('does not mention a theme that stopped shipping', () => {
    for (const id of deletedIds) {
      expect(doc).not.toContain(id)
    }
  })

  it('points at the preferences page rather than the removed Theme menu', () => {
    expect(doc).not.toContain('Theme** menu')
    expect(doc).not.toContain('src/main/menu')
  })
})
