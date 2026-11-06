import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loader = vi.hoisted(() => ({ ui: vi.fn(), md: vi.fn(), prism: vi.fn(), entry: vi.fn() }))
const notify = vi.hoisted(() => vi.fn())
const splash = vi.hoisted(() => ({ settle: vi.fn() }))

vi.mock('@/util/themeColor', async(importOriginal) => ({
  ...await importOriginal<object>(),
  loadUiCss: loader.ui,
  loadMdCss: loader.md,
  loadPrismCss: loader.prism,
  getTheme: loader.entry
}))
vi.mock('@/util/splash', () => ({ settleSplashTheme: splash.settle }))
vi.mock('@/services/notification', () => ({ default: { notify } }))
vi.mock('@/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>): string =>
    params ? `${key}:${String(params.theme)}` : key
}))

const deferred = () => {
  let release!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((resolve, _reject) => {
    release = resolve
    reject = _reject
  })

  return { promise, release, reject }
}

const sheet = (id: string): string => document.getElementById(id)?.innerHTML ?? ''

let ids: { ui: string; md: string; prism: string }

beforeEach(async() => {
  vi.resetModules()
  document.head.innerHTML = ''
  document.body.className = ''
  window.localStorage.clear()
  notify.mockReset().mockResolvedValue(undefined)
  splash.settle.mockReset()
  loader.entry.mockReset().mockReturnValue({ appearance: 'light', prism: 'default' })
  loader.ui.mockReset().mockResolvedValue(':root { --ui: light; }')
  loader.md.mockReset().mockResolvedValue('.editor-wrapper { --md: light; }')
  loader.prism.mockReset().mockResolvedValue('.token { color: light; }')

  // `@/config` reads the platform separator at module load.
  Object.assign(window, { path: { sep: '/' } })

  const config = await import('@/config')
  ids = { ui: config.UI_THEME_STYLE_ID, md: config.MD_THEME_STYLE_ID, prism: config.PRISM_STYLE_ID }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('applying one complete theme', () => {
  it('commits all three sheets before publishing the theme', async() => {
    const { applyThemeSet, appliedTheme } = await import('@/util/theme')

    await expect(applyThemeSet('light')).resolves.toBe('applied')

    expect(appliedTheme.value).toBe('light')
    expect(sheet(ids.ui)).toContain('--ui: light')
    expect(sheet(ids.md)).toContain('--md: light')
    expect(sheet(ids.prism)).toContain('color: light')
    expect(document.querySelector(`#${ids.ui}`)?.getAttribute('data-theme')).toBe('light')
    expect(splash.settle).toHaveBeenCalledTimes(1)
  })

  it('leaves the previous theme in place when a sheet cannot be imported', async() => {
    const { applyThemeSet, appliedTheme } = await import('@/util/theme')
    await applyThemeSet('light')

    loader.md.mockRejectedValueOnce(new Error('network'))
    await expect(applyThemeSet('dark')).resolves.toBe('failed')

    expect(appliedTheme.value).toBe('light')
    expect(sheet(ids.ui)).toContain('--ui: light')
    expect(sheet(ids.md)).toContain('--md: light')
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'error' })
  })

  it('opens the splash gate on a failure too', async() => {
    const { applyThemeSet } = await import('@/util/theme')
    loader.md.mockRejectedValueOnce(new Error('network'))

    await expect(applyThemeSet('dark')).resolves.toBe('failed')

    expect(splash.settle).toHaveBeenCalledTimes(1)
  })

  it('treats an empty syntax sheet as a missing resource', async() => {
    const { applyThemeSet, appliedTheme } = await import('@/util/theme')
    loader.prism.mockResolvedValue('   ')

    await expect(applyThemeSet('light')).resolves.toBe('failed')

    expect(appliedTheme.value).toBeNull()
    expect(sheet(ids.ui)).toBe('')
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
  })

  it('accepts a theme that declares no syntax palette', async() => {
    const { applyThemeSet, appliedTheme } = await import('@/util/theme')
    loader.entry.mockReturnValue({ appearance: 'light', prism: null })
    loader.prism.mockResolvedValue('')

    await expect(applyThemeSet('plain')).resolves.toBe('applied')

    expect(appliedTheme.value).toBe('plain')
    expect(sheet(ids.prism)).toBe('')
    expect(notify).not.toHaveBeenCalled()
  })

  it('reuses a committed theme without fetching it again', async() => {
    const { applyThemeSet } = await import('@/util/theme')

    await applyThemeSet('light')
    await applyThemeSet('light')

    expect(loader.ui).toHaveBeenCalledTimes(1)
    expect(loader.md).toHaveBeenCalledTimes(1)
    expect(loader.prism).toHaveBeenCalledTimes(1)
  })

  it('retires the attempt in flight even when the answer is already painted', async() => {
    const { applyThemeSet, appliedTheme } = await import('@/util/theme')
    await applyThemeSet('light')

    const ui = deferred()
    const md = deferred()
    const prism = deferred()
    loader.ui.mockReturnValueOnce(ui.promise)
    loader.md.mockReturnValueOnce(md.promise)
    loader.prism.mockReturnValueOnce(prism.promise)

    const dark = applyThemeSet('dark')
    await expect(applyThemeSet('light')).resolves.toBe('applied')

    ui.release(':root { --ui: dark; }')
    md.release('.editor-wrapper { --md: dark; }')
    prism.release('.token { color: dark; }')

    await expect(dark).resolves.toBe('superseded')
    expect(appliedTheme.value).toBe('light')
    expect(sheet(ids.ui)).toContain('--ui: light')
    expect(sheet(ids.ui)).not.toContain('dark')
  })

  it('lets the newest selection win when the sheets settle out of order', async() => {
    const { applyThemeSet, appliedTheme } = await import('@/util/theme')
    const slow = [deferred(), deferred(), deferred()]
    const newest = [deferred(), deferred(), deferred()]
    loader.ui.mockReturnValueOnce(slow[0].promise).mockReturnValueOnce(newest[0].promise)
    loader.md.mockReturnValueOnce(slow[1].promise).mockReturnValueOnce(newest[1].promise)
    loader.prism.mockReturnValueOnce(slow[2].promise).mockReturnValueOnce(newest[2].promise)

    const b = applyThemeSet('dark')
    const c = applyThemeSet('dracula')

    newest[0].release(':root { --ui: dracula; }')
    newest[1].release('.editor-wrapper { --md: dracula; }')
    newest[2].release('.token { color: dracula; }')
    await expect(c).resolves.toBe('applied')

    slow[0].release(':root { --ui: dark; }')
    slow[1].release('.editor-wrapper { --md: dark; }')
    slow[2].release('.token { color: dark; }')
    await expect(b).resolves.toBe('superseded')

    expect(appliedTheme.value).toBe('dracula')
    expect(sheet(ids.ui)).toContain('dracula')
    expect(sheet(ids.ui)).not.toContain('dark')
  })

  it('keeps a superseded failure quiet', async() => {
    const { applyThemeSet } = await import('@/util/theme')
    const stale = deferred()
    loader.ui.mockReturnValueOnce(stale.promise)

    const first = applyThemeSet('dark')
    await expect(applyThemeSet('light')).resolves.toBe('applied')

    stale.reject(new Error('gone'))
    await expect(first).resolves.toBe('superseded')
    expect(notify).not.toHaveBeenCalled()
    expect(splash.settle).toHaveBeenCalledTimes(1)
  })

  it('returns the failure without waiting for the notice to be answered', async() => {
    const { applyThemeSet } = await import('@/util/theme')
    // A notification that fades away never answers; the failure must not wait.
    notify.mockReturnValueOnce(new Promise(() => {}))
    loader.ui.mockRejectedValueOnce(new Error('broken'))

    await expect(applyThemeSet('dark')).resolves.toBe('failed')

    expect(splash.settle).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
  })

  it('asks whether the attempt is still current before showing the notice', async() => {
    const { announceThemeFailure } = await import('@/util/theme')
    const states = [true, false]

    announceThemeFailure('dark', () => Boolean(states.shift()))
    await vi.waitFor(() => expect(states).toHaveLength(0))

    // The first answer came before the notice module was ready; the second one
    // saw a newer theme and kept the failure quiet.
    expect(notify).not.toHaveBeenCalled()
  })

  it('survives a rejected notice', async() => {
    const { applyThemeSet } = await import('@/util/theme')
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    notify.mockRejectedValueOnce(new Error('no toast'))
    loader.ui.mockRejectedValueOnce(new Error('broken'))

    await expect(applyThemeSet('dark')).resolves.toBe('failed')
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[theme] cannot report the failure:', expect.any(Error)))

    warn.mockRestore()
  })

  it('applies again after a failure', async() => {
    const { applyThemeSet, appliedTheme } = await import('@/util/theme')
    loader.md.mockRejectedValueOnce(new Error('flaky'))

    await expect(applyThemeSet('nord')).resolves.toBe('failed')
    await expect(applyThemeSet('nord')).resolves.toBe('applied')
    expect(appliedTheme.value).toBe('nord')
  })

  it('creates the theme slots before the custom stylesheet', async() => {
    const custom = document.createElement('style')
    custom.id = 'custom-styles'
    document.head.appendChild(custom)

    const { applyThemeSet } = await import('@/util/theme')
    await applyThemeSet('light')

    const order = Array.from(document.head.querySelectorAll('style')).map(element => element.id)
    expect(order).toEqual([ids.ui, ids.md, ids.prism, 'custom-styles'])
  })

  it('moves a slot appended elsewhere back before the custom stylesheet', async() => {
    const custom = document.createElement('style')
    custom.id = 'custom-styles'
    document.head.appendChild(custom)
    // What the pair path used to leave behind: appended after the user's sheet.
    const slot = document.createElement('style')
    slot.id = ids.ui
    document.head.appendChild(slot)

    const { applyThemeSet } = await import('@/util/theme')
    await applyThemeSet('light')

    const order = Array.from(document.head.querySelectorAll('style')).map(element => element.id)
    expect(order).toEqual([ids.ui, ids.md, ids.prism, 'custom-styles'])
  })
})
