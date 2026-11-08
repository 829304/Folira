import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadIndex, search, type IndexedPage } from '../src/lib/docs-search'

function page(overrides: Partial<IndexedPage> = {}): IndexedPage {
  return {
    slug: 'example', href: '/docs/example', title: 'Example', tab: 'user', tabLabel: 'User',
    group: 'Guide', headings: [], body: '', ...overrides
  }
}

test('blank queries return no documents even when the index is populated', () => {
  assert.deepEqual(search(' \t\n ', [page({ body: 'text' })]), [])
})

test('an exact title ranks above a prefix and a body-only match regardless of case', () => {
  const body = page({ slug: 'body', body: 'Pick a theme to set the palette' })
  const prefix = page({ slug: 'prefix', title: 'Theme editor' })
  const exact = page({ slug: 'exact', title: 'THEME' })
  assert.deepEqual(search(' theme ', [body, prefix, exact]).map(hit => hit.page.slug), ['exact', 'prefix', 'body'])
})

test('a heading match carries its anchor even if the body also matches', () => {
  const result = search('offline', [page({
    body: 'Export offline using the settings below',
    headings: [{ id: 'offline-export', text: 'Offline export', depth: 2 }]
  })])
  assert.equal(result[0]?.headingId, 'offline-export')
})

test('body snippets escape markup while preserving the matching text inside mark', () => {
  const result = search('palette', [page({ body: '<img src=x onerror=alert(1)> Palette & "preview"' })])
  assert.equal(
    result[0]?.snippetHtml,
    '&lt;img src=x onerror=alert(1)&gt; <mark>Palette</mark> &amp; &quot;preview&quot;'
  )
})

test('snippet cropping keeps the highlight and marks both omitted ends', () => {
  const result = search('needle', [page({ body: `${'a'.repeat(90)}needle${'b'.repeat(90)}` })])
  assert.equal(result[0]?.snippetHtml, `…${'a'.repeat(50)}<mark>needle</mark>${'b'.repeat(50)}…`)
})

test('the forty-result limit is applied after ranking', () => {
  const pages = Array.from({ length: 45 }, (_, index) => page({ slug: `body-${index}`, body: 'theme' }))
  pages.push(page({ slug: 'exact', title: 'Theme' }))
  const result = search('theme', pages)
  assert.equal(result.length, 40)
  assert.equal(result[0]?.page.slug, 'exact')
})

test('index loading shares an in-flight request and retries after a failed response', async(t) => {
  const index = [page()]
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  let attempts = 0
  const fetch = t.mock.method(globalThis, 'fetch', async() => {
    if (++attempts === 1) return pending
    return Response.json(index)
  })

  const first = loadIndex()
  const second = loadIndex()
  assert.equal(fetch.mock.callCount(), 1)
  finish(new Response('', { status: 503 }))
  for (const result of await Promise.allSettled([first, second])) {
    assert.equal(result.status, 'rejected')
  }
  assert.deepEqual(await loadIndex(), index)
  assert.deepEqual(await loadIndex(), index)
  assert.equal(fetch.mock.callCount(), 2)
})
