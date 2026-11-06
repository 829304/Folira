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

const gone = async(): Promise<boolean> => {
  await vi.advanceTimersByTimeAsync(FADE_MS + 50)
  return document.getElementById('splash') === null
}

describe('the splash gate', () => {
  it('reveals when both the content and the first theme are in', async() => {
    const { dismissSplash, settleSplashTheme } = await import('@/util/splash')

    dismissSplash()
    expect(splash.classList.contains('is-done')).toBe(false)

    settleSplashTheme()
    expect(splash.classList.contains('is-done')).toBe(true)
    await expect(gone()).resolves.toBe(true)
  })

  it('stays up while only content is ready', async() => {
    const { dismissSplash } = await import('@/util/splash')

    dismissSplash()
    await vi.advanceTimersByTimeAsync(SAFETY_MS - 1)

    expect(splash.classList.contains('is-done')).toBe(false)
  })

  it('stays up while only the theme is ready', async() => {
    const { settleSplashTheme } = await import('@/util/splash')

    settleSplashTheme()
    await vi.advanceTimersByTimeAsync(SAFETY_MS - 1)

    expect(splash.classList.contains('is-done')).toBe(false)
  })

  it('opens at the deadline when the theme never settles', async() => {
    const { dismissSplash } = await import('@/util/splash')

    dismissSplash()
    await vi.advanceTimersByTimeAsync(SAFETY_MS - 1)
    expect(splash.classList.contains('is-done')).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(splash.classList.contains('is-done')).toBe(true)
  })

  it('counts the deadline from load, not from the first dismiss', async() => {
    const { dismissSplash } = await import('@/util/splash')

    // Spend most of the budget before any content is ready.
    await vi.advanceTimersByTimeAsync(SAFETY_MS - 500)
    dismissSplash()

    await vi.advanceTimersByTimeAsync(500)
    expect(splash.classList.contains('is-done')).toBe(true)
  })

  it('hides the splash when the safety net fires', async() => {
    const { armSplashSafetyNet } = await import('@/util/splash')

    armSplashSafetyNet()
    await vi.advanceTimersByTimeAsync(SAFETY_MS)

    expect(splash.classList.contains('is-done')).toBe(true)
    await expect(gone()).resolves.toBe(true)
  })

  it('hides the splash at once when forced', async() => {
    const { forceDismissSplash } = await import('@/util/splash')

    forceDismissSplash()

    expect(splash.classList.contains('is-done')).toBe(true)
    await expect(gone()).resolves.toBe(true)
  })

  it('survives a second settle and a second dismiss', async() => {
    const { settleSplashTheme, forceDismissSplash, dismissSplash } = await import('@/util/splash')

    expect(() => {
      settleSplashTheme()
      settleSplashTheme()
      forceDismissSplash()
      dismissSplash()
    }).not.toThrow()

    await expect(gone()).resolves.toBe(true)
  })
})
