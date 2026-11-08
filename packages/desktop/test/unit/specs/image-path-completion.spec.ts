import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askForImageAutoPath } from '@/tauri-bridge/image-path'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

beforeEach(() => { invoke.mockReset() })

const entries = [
  { file: 'screenshots', type: 'directory' },
  { file: '截图.webp', type: 'image' },
  { file: 'notes.md', type: '' },
  { file: '$RECYCLE.BIN', type: 'directory' }
]

describe('image path completion', () => {
  it('resolves a relative directory against the document and excludes non-images and system folders', async() => {
    invoke.mockResolvedValue(entries)
    const dispatch = vi.fn()
    await askForImageAutoPath({ id: 'relative', pathname: '/docs/note.md', src: 'assets/' }, dispatch)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('readdir_kinds', { path: '/docs/assets' })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::response-of-image-path-relative', [entries.slice(0, 2)])
  })

  it('keeps the absolute path and matches a partially typed Unicode filename', async() => {
    invoke.mockResolvedValue(entries)
    const dispatch = vi.fn()
    await askForImageAutoPath({ id: 'absolute', pathname: '/docs/note.md', src: 'C:/Pictures/截图' }, dispatch)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('readdir_kinds', { path: 'C:/Pictures' })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::response-of-image-path-absolute', [[entries[1]]])
  })

  it('replies with an empty list when a half-typed directory does not exist', async() => {
    invoke.mockRejectedValue(new Error('not found'))
    const dispatch = vi.fn()
    await askForImageAutoPath({ id: 'missing', pathname: '/docs/note.md', src: 'missing/image' }, dispatch)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::response-of-image-path-missing', [[]])
  })

  it('keeps overlapping results on their own reply channels when the older read finishes last', async() => {
    let complete!: (value: typeof entries) => void
    const slow = new Promise<typeof entries>((resolve) => { complete = resolve })
    invoke.mockReturnValueOnce(slow).mockResolvedValueOnce([entries[1]])
    const dispatch = vi.fn()
    const first = askForImageAutoPath({ id: 'old', pathname: '/docs/note.md', src: 'old/' }, dispatch)
    await askForImageAutoPath({ id: 'new', pathname: '/docs/note.md', src: 'new/' }, dispatch)
    complete([entries[0]])
    await first
    expect(dispatch.mock.calls).toEqual([
      ['mt::response-of-image-path-new', [[entries[1]]]],
      ['mt::response-of-image-path-old', [[entries[0]]]]
    ])
  })
})
