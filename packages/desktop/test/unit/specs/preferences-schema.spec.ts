// The settings search builds its category key from the description.
//
// `getTranslatedSearchContent` splits `Category--Label` on the double hyphen and
// looks up `preferences.search.categories.<category>`. A single hyphen leaves the
// whole sentence as the category, so the key never resolves and the fallback logs
// a warning in a console nobody reads — which is how four entries shipped that way.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SCHEMA = resolve(__dirname, '../../../src/shared/preferences-schema.json')

type SchemaEntry = { description: string }

const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as Record<string, SchemaEntry>

const searchable = Object.entries(schema).filter(
  ([, entry]) => !entry.description.endsWith('--internal')
)

describe('preferences schema descriptions', () => {
  it('separates the category from the label with a double hyphen', () => {
    const withoutSeparator = searchable
      .filter(([, entry]) => !entry.description.includes('--'))
      .map(([key]) => key)

    expect(withoutSeparator).toEqual([])
  })

  it('names a category the search sidebar can translate', () => {
    const locales = JSON.parse(
      readFileSync(resolve(__dirname, '../../../static/locales/en.json'), 'utf8')
    ) as { preferences: { search: { categories: Record<string, string> } } }
    const known = new Set(Object.keys(locales.preferences.search.categories))

    const unknown = searchable
      .map(([key, entry]) => [key, entry.description.split('--')[0].toLowerCase()] as const)
      .filter(([, category]) => !known.has(category))
      .map(([key, category]) => `${key}: ${category}`)

    expect(unknown).toEqual([])
  })
})
