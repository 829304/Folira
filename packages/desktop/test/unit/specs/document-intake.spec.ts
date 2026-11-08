import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const open = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => open(...args) }))

beforeEach(() => {
  vi.resetModules()
  Object.assign(window, { path: { sep: '/' }, electron: { ipcRenderer: { send: vi.fn(), on: vi.fn() } } })
  invoke.mockReset().mockResolvedValue(undefined)
  open.mockReset().mockResolvedValue(null)
})

async function project() {
  const bridge = await import('@/tauri-bridge/project')
  const preferences = await import('@/tauri-bridge/preferences')
  return { ...bridge, ...preferences }
}

const root = '/项目'
const folder = { pathname: `${root}/notes`, name: 'notes', isDirectory: true, isFile: false, isMarkdown: false }
const file = { pathname: `${root}/notes/a.md`, name: 'a.md', isDirectory: false, isFile: true, isMarkdown: true, birthTime: 1, mtimeMs: 2 }

describe('opening a project folder', () => {
  it('replays parents before children using metadata alone and keeps scan and watch exclusions aligned', async() => {
    const bridge = await project()
    bridge.rememberStoredPreferences({ treePathExcludePatterns: ['node_modules', '**/drafts/**'] })
    invoke.mockImplementation(async(command: string) => command === 'scan_project' ? [folder, file] : undefined)
    const dispatch = vi.fn()
    await bridge.loadProjectTree(root, dispatch)

    const options = { path: root, exclusions: ['node_modules', '**/drafts/**'] }
    expect(invoke.mock.calls).toEqual([['scan_project', options], ['watch_project', options]])
    expect(invoke.mock.invocationCallOrder[1]).toBeLessThan(dispatch.mock.invocationCallOrder[0])
    expect(dispatch.mock.calls).toEqual([
      ['mt::update-object-tree', [{ type: 'addDir', change: { ...folder, isCollapsed: true, folders: [], files: [] } }]],
      ['mt::update-object-tree', [{ type: 'add', change: file }]]
    ])
  })

  it('shows a scan failure without emitting a partial tree or arming a watch', async() => {
    const bridge = await project()
    invoke.mockRejectedValue(new Error('permission denied'))
    const dispatch = vi.fn()
    await bridge.loadProjectTree(root, dispatch)
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['scan_project'])
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::show-notification', [expect.objectContaining({
      type: 'error', message: expect.stringContaining('permission denied')
    })])
  })

  it('keeps the scanned tree usable when only live watching fails', async() => {
    const bridge = await project()
    invoke.mockResolvedValueOnce([folder, file]).mockRejectedValueOnce(new Error('watch limit'))
    const dispatch = vi.fn()
    await bridge.loadProjectTree(root, dispatch)
    expect(dispatch.mock.calls.map(([, args]) => args[0].type)).toEqual(['addDir', 'add'])
  })

  it('a cancelled folder picker keeps the current project intact', async() => {
    const bridge = await project()
    const dispatch = vi.fn()
    await bridge.askForOpenProject(dispatch)
    expect(open).toHaveBeenCalledExactlyOnceWith({ directory: true })
    expect(dispatch).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('importing a document', () => {
  it('opens the converted content as an untitled tab so Save cannot overwrite the source', async() => {
    const { askForImportFile } = await import('@/tauri-bridge/import')
    open.mockResolvedValue('/文档/笔记.DOCX')
    invoke.mockResolvedValueOnce(true).mockResolvedValueOnce('# 转换后的笔记\n')
    const dispatch = vi.fn()
    await askForImportFile(dispatch)
    expect(invoke.mock.calls).toEqual([
      ['command_exists', { name: 'pandoc' }], ['pandoc_to_markdown', { path: '/文档/笔记.DOCX' }]
    ])
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::open-new-tab', [{ markdown: '# 转换后的笔记\n' }, {}, true])
  })

  it('reports missing Pandoc without trying to convert or opening a tab', async() => {
    const { importWithPandoc } = await import('@/tauri-bridge/import')
    invoke.mockResolvedValue(false)
    const dispatch = vi.fn()
    await importWithPandoc('/docs/source.docx', dispatch)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('command_exists', { name: 'pandoc' })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::pandoc-not-exists', [expect.any(Object)])
  })

  it('reports the file and cause of a failed conversion', async() => {
    const { importWithPandoc } = await import('@/tauri-bridge/import')
    invoke.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('corrupt document'))
    const dispatch = vi.fn()
    await importWithPandoc('/docs/source.docx', dispatch)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::show-notification', [expect.objectContaining({
      type: 'error', message: expect.stringContaining('corrupt document')
    })])
    expect(dispatch.mock.calls[0][1][0].message).toContain('/docs/source.docx')
  })

  it('rejects a non-text conversion response without opening a broken tab', async() => {
    const { importWithPandoc } = await import('@/tauri-bridge/import')
    invoke.mockResolvedValueOnce(true).mockResolvedValueOnce(null)
    const dispatch = vi.fn()
    await importWithPandoc('/docs/source.docx', dispatch)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('mt::show-notification', [expect.objectContaining({ type: 'error' })])
  })
})
