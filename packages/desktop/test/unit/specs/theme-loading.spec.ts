import type { EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const css = vi.hoisted(() => ({ ui: vi.fn(), md: vi.fn(), prism: vi.fn() }))
vi.mock('@/util/themeColor', async(importOriginal) => ({
  ...await importOriginal<object>(), loadUiCss: css.ui, loadMdCss: css.md, loadPrismCss: css.prism
}))
const settle = async() => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const deferred = () => {
  let release!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((resolve, _reject) => { release = resolve; reject = _reject })
  return { promise, release, reject }
}
let scope: EffectScope | undefined
beforeEach(() => {
  vi.resetModules()
  Object.assign(window, { path: { sep: '/' }, electron: { ipcRenderer: { send: vi.fn(), on: vi.fn() } } })
  document.head.innerHTML = ''
  document.body.className = ''
  localStorage.clear()
  css.ui.mockReset().mockResolvedValue(':root { --ui: initial; }')
  css.md.mockReset().mockResolvedValue(':root { --md: initial; }')
  css.prism.mockReset().mockResolvedValue('.token { color: red; }')
})
afterEach(() => { scope?.stop() })

async function startup() {
  const vue = await import('vue')
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
  const store = (await import('@/store/preferences')).usePreferencesStore()
  const { useAppliedTheme } = await import('@/composables/useAppliedTheme')
  const { resolveThemePair } = await import('@/util/themeSelection')
  const pair = vue.computed(() => resolveThemePair(store, 'light'))
  scope = vue.effectScope()
  scope.run(() => useAppliedTheme(pair, vue.toRef(store, 'preferencesLoaded')))
  return { store, vue }
}

describe('theme preference arrival and stylesheet completion', () => {
  it('replaces cached paint with stored preferences', async() => {
    const { applyTheme } = await import('@/util/theme')
    applyTheme({ ui: 'dark', md: 'dark' })
    await settle()
    css.ui.mockResolvedValue(':root { --ui: stored; }')
    const { store, vue } = await startup()
    store.LOAD_STORED_PREFERENCES({ followSystemTheme: false, theme: 'light' })
    await vue.nextTick()
    await settle()
    expect(document.getElementById('ag-theme-ui')?.innerHTML).toContain('stored')
  })

  it('applies loaded preferences even when resolving the same default theme ID', async() => {
    const { store, vue } = await startup()
    expect(css.ui).not.toHaveBeenCalled()
    store.LOAD_STORED_PREFERENCES({})
    await vue.nextTick()
    await settle()
    expect(css.ui).toHaveBeenCalledExactlyOnceWith('light')
    expect(document.head.textContent).toContain('--ui: initial')
  })

  it.each(['ui', 'md', 'prism'] as const)('ignores late %s CSS from an earlier theme selection', async(axis) => {
    const { applyTheme } = await import('@/util/theme')
    const old = deferred()
    css[axis].mockReturnValueOnce(old.promise).mockResolvedValue('/* newest */')
    applyTheme({ ui: 'light', md: 'light' })
    applyTheme({ ui: 'dark', md: 'dark' })
    await settle()
    old.release('/* obsolete */')
    await settle()
    const { UI_THEME_STYLE_ID, MD_THEME_STYLE_ID, PRISM_STYLE_ID } = await import('@/config')
    const id = { ui: UI_THEME_STYLE_ID, md: MD_THEME_STYLE_ID, prism: PRISM_STYLE_ID }[axis]
    expect(document.getElementById(id)?.innerHTML).toContain('newest')
    expect(document.getElementById(id)?.innerHTML).not.toContain('obsolete')
  })

  it.each(['ui', 'md', 'prism'] as const)('retains existing %s styles when the next load fails', async(axis) => {
    const { applyTheme } = await import('@/util/theme')
    applyTheme({ ui: 'light', md: 'light' })
    await settle()
    const { UI_THEME_STYLE_ID, MD_THEME_STYLE_ID, PRISM_STYLE_ID } = await import('@/config')
    const id = { ui: UI_THEME_STYLE_ID, md: MD_THEME_STYLE_ID, prism: PRISM_STYLE_ID }[axis]
    const before = document.getElementById(id)?.innerHTML
    expect(before).toBeTruthy()
    css[axis].mockRejectedValueOnce(new Error('stylesheet unavailable'))
    applyTheme({ ui: 'dark', md: 'dark' })
    await settle()
    expect(document.getElementById(id)?.innerHTML).toBe(before)
  })
})
