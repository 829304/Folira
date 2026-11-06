import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only the OS event transport is replaced. Search IDs, dispatch and cleanup are real.
type Handler = (payload: unknown) => void
type Event = 'match' | 'progress' | 'done' | 'error' | 'cancelled'
let handlers: Record<Event, Set<Handler>>
const start = vi.fn()
const cancel = vi.fn()
const disposers: ReturnType<typeof vi.fn>[] = []
const emit = (event: Event, payload: unknown) => { for (const handler of [...handlers[event]]) handler(payload) }

beforeEach(() => {
  vi.resetModules()
  Object.assign(window, { path: { sep: '/' } })
  handlers = { match: new Set(), progress: new Set(), done: new Set(), error: new Set(), cancelled: new Set() }
  disposers.length = 0
  start.mockReset().mockResolvedValue(undefined)
  cancel.mockReset()
  const subscribe = (event: Event) => (handler: Handler) => {
    handlers[event].add(handler)
    const off = vi.fn(() => handlers[event].delete(handler))
    disposers.push(off)
    return off
  }
  Object.assign(window, {
    ripgrep: {
      start,
      cancel,
      onMatch: subscribe('match'),
      onProgress: subscribe('progress'),
      onDone: subscribe('done'),
      onError: subscribe('error'),
      onCancelled: subscribe('cancelled')
    }
  })
})
async function search(options = {}) {
  const { default: Searcher } = await import('@/node/ripgrepSearcher')
  const task = new Searcher().search(['/docs'], 'needle', options)
  return { task, id: start.mock.lastCall?.[0].searchId as string }
}
const expectClean = () => {
  expect(Object.values(handlers).every((set) => set.size === 0)).toBe(true)
  for (const off of disposers) expect(off).toHaveBeenCalledOnce()
}

describe('search request isolation and listener lifecycle', () => {
  it.each(['done', 'cancelled', 'error'] as const)('releases all five listeners after %s', async(event) => {
    const { task, id } = await search()
    const result = event === 'error' ? expect(task).rejects.toThrow('failed query') : expect(task).resolves.toBeUndefined()
    emit(event, { searchId: id, error: 'failed query' })
    await result
    expectClean()
  })

  it('cleans listeners if the native start request rejects', async() => {
    start.mockRejectedValue(new Error('cannot launch search'))
    const { task } = await search()
    await expect(task).rejects.toThrow('cannot launch search')
    expectClean()
  })

  it('keeps two concurrent searches isolated by ID', async() => {
    const firstMatch = vi.fn()
    const secondMatch = vi.fn()
    const first = await search({ didMatch: firstMatch })
    const second = await search({ didMatch: secondMatch })
    expect(first.id).not.toBe(second.id)
    emit('match', { searchId: first.id, payload: 'first' })
    emit('match', { searchId: second.id, payload: 'second' })
    expect(firstMatch.mock.calls).toEqual([['first']])
    expect(secondMatch.mock.calls).toEqual([['second']])
    emit('done', { searchId: first.id })
    expect(handlers.match.size).toBe(1)
    emit('done', { searchId: second.id })
    await Promise.all([first.task, second.task])
    expectClean()
  })

  it('ignores malformed and unrelated events without settling the active request', async() => {
    const match = vi.fn()
    const { task, id } = await search({ didMatch: match })
    emit('match', null)
    emit('match', { searchId: 'another', payload: 'wrong' })
    emit('done', { searchId: 'another' })
    expect(match).not.toHaveBeenCalled()
    expect(handlers.done.size).toBe(1)
    emit('done', { searchId: id })
    await task
    expectClean()
  })

  it.each(['match', 'progress'] as const)('a throwing %s callback cannot prevent later cleanup', async(event) => {
    const callback = vi.fn(() => { throw new Error('consumer failed') })
    const { task, id } = await search(event === 'match' ? { didMatch: callback } : { didSearchPaths: callback })
    expect(() => emit(event, { searchId: id, payload: 'result', num: 4 })).not.toThrow()
    expect(callback).toHaveBeenCalledOnce()
    emit('done', { searchId: id })
    await task
    expectClean()
  })

  it('sends cancellation once and waits for the matching cancellation acknowledgement', async() => {
    const { task, id } = await search()
    task.cancel()
    task.cancel()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(id)
    expect(handlers.cancelled.size).toBe(1)
    emit('cancelled', { searchId: id })
    await task
    expectClean()
  })

  it('strips callback functions and snapshots reactive options before IPC', async() => {
    const { reactive } = await import('vue')
    const options = reactive({ exclusions: ['node_modules'], didMatch: vi.fn() })
    const { task, id } = await search(options)
    options.exclusions.push('dist')
    expect(start.mock.lastCall?.[0].options).toEqual({ exclusions: ['node_modules'] })
    emit('done', { searchId: id })
    await task
  })

  it('ignores events delivered after the request has completed', async() => {
    const match = vi.fn()
    const { task, id } = await search({ didMatch: match })
    emit('done', { searchId: id })
    await task
    emit('match', { searchId: id, payload: 'late' })
    emit('error', { searchId: id, error: 'late failure' })
    expect(match).not.toHaveBeenCalled()
    expectClean()
  })

  it('quick-open file searches use files mode and an empty content pattern', async() => {
    const { FileSearcher } = await import('@/node/ripgrepSearcher')
    const task = new FileSearcher().search(['/docs'], 'filename', {})
    expect(start.mock.lastCall?.[0]).toMatchObject({ mode: 'files', pattern: '', directories: ['/docs'] })
    emit('done', { searchId: start.mock.lastCall?.[0].searchId })
    await task
    expectClean()
  })
})
