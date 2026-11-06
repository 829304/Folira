import type { EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const css = vi.hoisted(() => ({ ui: vi.fn(), md: vi.fn(), prism: vi.fn() }))
const splash = vi.hoisted(() => ({ settle: vi.fn() }))
vi.mock('@/util/themeColor', async(importOriginal) => ({
  ...await importOriginal<object>(), loadUiCss: css.ui, loadMdCss: css.md, loadPrismCss: css.prism
}))
vi.mock('@/util/splash', () => ({ settleSplashTheme: splash.settle }))

const settle = async() => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = () => {
  let release!: (value: string) => void
  const promise = new Promise<string>((resolve) => { release = resolve })
  return { promise, release }
}

let scope: EffectScope | undefined

beforeEach(() => {
  vi.resetModules()
  Object.assign(window, {
    path: { sep: '/' },
    electron: { ipcRenderer: { send: vi.fn(), on: vi.fn() } },
    marktext: {}
  })
  document.head.innerHTML = ''
  document.body.className = ''
  localStorage.clear()
  css.ui.mockReset().mockResolvedValue(':root { --ui: initial; }')
  css.md.mockReset().mockResolvedValue('.editor-wrapper { --md: initial; }')
  css.prism.mockResolvedValue('.token { color: red; }')
  splash.settle.mockReset()
})

afterEach(() => {
  scope?.stop()
  delete (window as { marktext?: unknown }).marktext
})

async function startup() {
  const vue = await import('vue')
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
  const store = (await import('@/store/preferences')).usePreferencesStore()
  const { useResolvedTheme } = await import('@/composables/useResolvedTheme')
  const { useAppliedTheme } = await import('@/composables/useAppliedTheme')

  scope = vue.effectScope()
  scope.run(() => useAppliedTheme(useResolvedTheme(), vue.toRef(store, 'preferencesLoaded')))

  return { store, vue }
}

describe('theme preference arrival and stylesheet completion', () => {
  it('applies the cached theme first and the stored one once it arrives', async() => {
    (window as { marktext?: { initialTheme?: string | null } }).marktext = { initialTheme: 'dark' }
    css.ui.mockImplementation(async(id: string) => `:root { --ui: ${id}; }`)

    const { store, vue } = await startup()
    await settle()
    expect(document.getElementById('ag-theme-ui')?.innerHTML).toContain('dark')

    store.LOAD_STORED_PREFERENCES({ theme: 'nord' })
    await vue.nextTick()
    await settle()
    expect(document.getElementById('ag-theme-ui')?.innerHTML).toContain('nord')
  })

  it('holds the splash for the stored theme rather than the cached one', async() => {
    (window as { marktext?: { initialTheme?: string | null } }).marktext = { initialTheme: 'dark' }
    css.ui.mockImplementation(async(id: string) => `:root { --ui: ${id}; }`)

    const { store, vue } = await startup()
    await settle()
    // The first commit is a guess taken from the cache; lifting the splash here
    // would paint the window on a theme the file may already contradict.
    expect(splash.settle).not.toHaveBeenCalled()

    store.LOAD_STORED_PREFERENCES({ theme: 'nord' })
    await vue.nextTick()
    await settle()
    expect(splash.settle).toHaveBeenCalledTimes(1)
  })

  it('does not repaint when the stored theme is the one already shown', async() => {
    const { store, vue } = await startup()
    await settle()
    expect(css.ui).toHaveBeenCalledTimes(1)

    store.LOAD_STORED_PREFERENCES({ theme: 'light' })
    await vue.nextTick()
    await settle()
    expect(css.ui).toHaveBeenCalledTimes(1)
  })

  it('ignores every sheet from a superseded selection', async() => {
    const { applyThemeSet } = await import('@/util/theme')
    const stale = deferred()
    css.ui.mockReturnValueOnce(stale.promise).mockResolvedValue('/* newest */')

    applyThemeSet('light').catch(() => undefined)
    await expect(applyThemeSet('dark')).resolves.toBe('applied')
    stale.release('/* obsolete */')
    await settle()

    expect(document.getElementById('ag-theme-ui')?.innerHTML).toContain('newest')
    expect(document.getElementById('ag-theme-ui')?.innerHTML).not.toContain('obsolete')
  })

  it.each(['ui', 'md', 'prism'] as const)('retains existing %s styles when the next load fails', async(axis) => {
    const { applyThemeSet } = await import('@/util/theme')
    await applyThemeSet('light')

    const { UI_THEME_STYLE_ID, MD_THEME_STYLE_ID, PRISM_STYLE_ID } = await import('@/config')
    const id = { ui: UI_THEME_STYLE_ID, md: MD_THEME_STYLE_ID, prism: PRISM_STYLE_ID }[axis]
    const before = document.getElementById(id)?.innerHTML
    expect(before).toBeTruthy()

    css[axis].mockRejectedValueOnce(new Error('stylesheet unavailable'))
    await expect(applyThemeSet('dark')).resolves.toBe('failed')
    expect(document.getElementById(id)?.innerHTML).toBe(before)
  })

  it('falls back to the default theme when the stored id is unknown', async() => {
    const { store, vue } = await startup()
    css.ui.mockImplementation(async(id: string) => `:root { --ui: ${id}; }`)

    store.LOAD_STORED_PREFERENCES({ theme: 'gone' })
    await vue.nextTick()
    await settle()

    expect(css.ui).toHaveBeenLastCalledWith('light')
  })
})
