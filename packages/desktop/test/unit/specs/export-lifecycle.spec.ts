import { beforeEach, describe, expect, it, vi } from 'vitest'
const invoke = vi.fn()
const save = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }))
beforeEach(() => {
  vi.resetModules()
  Object.assign(window, { path: { sep: '/' }, electron: { ipcRenderer: { send: vi.fn(), on: vi.fn() } }, print: vi.fn() })
  invoke.mockReset().mockResolvedValue(undefined)
  save.mockReset().mockResolvedValue('/exports/result.html')
})
const load = () => import('@/tauri-bridge/export')
const payload = { type: 'styledHtml' as const, content: '<h1>中文😀</h1>', pathname: '/docs/source.md' }

describe('export completion and print restoration', () => {
  it('writes the complete HTML to the chosen path before reporting success', async() => {
    const { exportDocument } = await load()
    let release!: () => void
    const write = new Promise<void>((resolve) => { release = resolve })
    let started!: () => void
    const writing = new Promise<void>((resolve) => { started = resolve })
    invoke.mockImplementation(() => { started(); return write })
    const dispatch = vi.fn()
    const exporting = exportDocument(payload, dispatch)
    await writing
    expect(invoke).toHaveBeenCalledWith('write_file', { path: '/exports/result.html', data: payload.content })
    expect(dispatch).not.toHaveBeenCalled()
    release()
    await exporting
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::export-success', [{ type: 'styledHtml', filePath: '/exports/result.html' }])
  })

  it('a failed HTML write reports failure and never success', async() => {
    const { exportDocument } = await load()
    invoke.mockRejectedValue(new Error('disk full'))
    const dispatch = vi.fn()
    await exportDocument(payload, dispatch)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::show-notification', [expect.objectContaining({ type: 'error', message: expect.stringContaining('disk full') })])
  })

  it('cancelling the export dialog writes nothing and reports nothing', async() => {
    const { exportDocument } = await load()
    save.mockResolvedValue(null)
    const dispatch = vi.fn()
    await exportDocument(payload, dispatch)
    expect(invoke).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('missing HTML is rejected before opening a save dialog', async() => {
    const { exportDocument } = await load()
    const dispatch = vi.fn()
    await exportDocument({ type: 'styledHtml' }, dispatch)
    expect(save).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith('mt::show-notification', [expect.objectContaining({ type: 'error' })])
  })

  it.each([
    { input: payload, expected: '/docs/source.html' },
    { input: { type: 'styledHtml' as const, content: '<p>x</p>', title: '草稿' }, expected: '草稿.html' }
  ])('suggests $expected without changing the selected destination', async({ input, expected }) => {
    const { exportDocument } = await load()
    await exportDocument(input, vi.fn())
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expected }))
    expect(invoke).toHaveBeenCalledWith('write_file', expect.objectContaining({ path: '/exports/result.html' }))
  })

  it.each([false, true])('PDF always restores the editor when print throws=%s', async(throws) => {
    const { exportDocument } = await load()
    if (throws) vi.mocked(window.print).mockImplementation(() => { throw new Error('printer offline') })
    const dispatch = vi.fn()
    await exportDocument({ type: 'pdf' }, dispatch)
    expect(window.print).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::print-service-clearup', [])
    expect(save).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('plain print restores the editor after the system dialog returns', async() => {
    const { printDocument } = await load()
    const dispatch = vi.fn()
    printDocument(dispatch)
    expect(window.print).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::print-service-clearup', [])
  })
})
