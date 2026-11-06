import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SAFETY_MS = 6000
const FADE_MS = 180

let splash: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  document.body.innerHTML = '<div id="splash">Folira</div>'
  splash = document.getElementById('splash') as HTMLElement
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the splash theme gate', () => {
  it('opens as soon as the first theme settles', async() => {
    const { settleSplashTheme, whenSplashThemeReady } = await import('@/util/splash')

    const ready = whenSplashThemeReady()
    settleSplashTheme()

    await expect(ready).resolves.toBeUndefined()
  })

  it('opens at the deadline when no theme ever arrives', async() => {
    const { whenSplashThemeReady } = await import('@/util/splash')

    let opened = false
    const ready = whenSplashThemeReady().then(() => {
      opened = true
    })

    await vi.advanceTimersByTimeAsync(SAFETY_MS - 1)
    expect(opened).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await ready
    expect(opened).toBe(true)
  })

  it('counts the deadline from load, not from the first wait', async() => {
    const { whenSplashThemeReady } = await import('@/util/splash')

    // Spend most of the budget before anyone asks for the gate.
    await vi.advanceTimersByTimeAsync(SAFETY_MS - 500)

    let opened = false
    const ready = whenSplashThemeReady().then(() => {
      opened = true
    })

    await vi.advanceTimersByTimeAsync(500)
    await ready
    expect(opened).toBe(true)
  })

  it('lets everyone through when the theme settled before any wait', async() => {
    const { settleSplashTheme, whenSplashThemeReady } = await import('@/util/splash')

    settleSplashTheme()

    await expect(whenSplashThemeReady()).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('serves every waiter from one promise', async() => {
    const { whenSplashThemeReady } = await import('@/util/splash')

    expect(whenSplashThemeReady()).toBe(whenSplashThemeReady())
  })

  it('hides the splash when the safety net fires', async() => {
    const { armSplashSafetyNet } = await import('@/util/splash')

    armSplashSafetyNet()
    await vi.advanceTimersByTimeAsync(SAFETY_MS)

    expect(splash.classList.contains('is-done')).toBe(true)
    await vi.advanceTimersByTimeAsync(FADE_MS + 50)
    expect(document.getElementById('splash')).toBeNull()
  })

  it('hides the splash at once when forced', async() => {
    const { forceDismissSplash } = await import('@/util/splash')

    forceDismissSplash()

    expect(splash.classList.contains('is-done')).toBe(true)
    await vi.advanceTimersByTimeAsync(FADE_MS + 50)
    expect(document.getElementById('splash')).toBeNull()
  })

  it('survives a second settle and a second dismiss', async() => {
    const { settleSplashTheme, forceDismissSplash, dismissSplash } = await import('@/util/splash')

    expect(() => {
      settleSplashTheme()
      settleSplashTheme()
      forceDismissSplash()
      dismissSplash()
    }).not.toThrow()

    await vi.advanceTimersByTimeAsync(FADE_MS + 50)
    expect(document.getElementById('splash')).toBeNull()
  })

  it('still hides the splash through the legacy entry point', async() => {
    const { dismissSplash } = await import('@/util/splash')

    dismissSplash()

    expect(splash.classList.contains('is-done')).toBe(true)
    await vi.advanceTimersByTimeAsync(FADE_MS + 50)
    expect(document.getElementById('splash')).toBeNull()
  })
})
