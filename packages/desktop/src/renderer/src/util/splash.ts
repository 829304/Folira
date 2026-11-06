/**
 * Takes down the loading screen that `index.html` paints.
 *
 * The splash is markup in the document rather than something the app renders,
 * because it exists to fill the stretch before the app can render anything (see
 * the comment on it in `index.html`). That makes taking it down a job for
 * whoever puts the first real content on screen, which differs by window: the
 * editor when the document is laid out, the recent screen when it appears, the
 * settings tree when it mounts.
 *
 * Every one of those is a "first" that may never happen — a document that fails
 * to parse, a bootstrap message that never arrives. So the safety net is not
 * optional: a splash that outlives its cause is a frozen app as far as anyone
 * watching can tell, and worse than no splash at all.
 */

/** Matches the `transition` on `#splash` in index.html. */
const FADE_MS = 180

/**
 * Long enough that no ordinary startup reaches it — the slowest trace on record
 * put the document on screen at 3 s — and short enough that a broken one is a
 * few seconds of blank window rather than a hang.
 */
const SAFETY_MS = 6000

let dismissed = false

/** Hide the splash now, without waiting for anything else. */
const hideSplash = (): void => {
  const splash = document.getElementById('splash')
  if (!splash) return

  splash.classList.add('is-done')
  // Removed rather than left transparent: a viewport-sized layer costs a
  // composite on every frame for as long as it is in the tree, and the point of
  // the whole exercise is the frames right after this one.
  window.setTimeout(() => splash.remove(), FADE_MS + 50)
}

/** Idempotent: several callers race to be the first content on screen. */
export const dismissSplash = (): void => {
  if (dismissed) return
  dismissed = true
  hideSplash()
}

// --- Theme readiness gate ---------------------------------------------------
//
// The first frame can reach the screen before its theme stylesheets have been
// fetched, which shows the default palette for a moment. The gate lets the
// splash cover that stretch, but only as a stretch: the deadline is fixed once,
// at module load, so a late or broken theme loader cannot hold the window
// inside the splash longer than the safety net already allows.

/** Fixed once: every wait below counts from the same instant. */
const deadlineAt = Date.now() + SAFETY_MS

let settleTheme: () => void = () => {}
let themeSettled = false
const themeReady = new Promise<void>((resolve) => {
  settleTheme = resolve
})

let gate: Promise<void> | null = null
let gateTimer: number | undefined

/** Release the gate: the first theme commit (or its failure) is in. */
export const settleSplashTheme = (): void => {
  themeSettled = true
  settleTheme()

  // A window that settles before anyone asks still leaves no timer behind.
  if (gateTimer !== undefined) {
    window.clearTimeout(gateTimer)
    gateTimer = undefined
  }
}

/**
 * Resolves when the first theme settles, or when the startup deadline passes.
 *
 * One promise serves every waiter, so a second caller cannot extend the wait.
 */
export const whenSplashThemeReady = (): Promise<void> => {
  if (gate) return gate
  if (themeSettled) return Promise.resolve()

  const remaining = Math.max(0, deadlineAt - Date.now())
  gate = Promise.race([
    themeReady,
    new Promise<void>((resolve) => {
      gateTimer = window.setTimeout(resolve, remaining)
    })
  ])

  return gate
}

/** The safety net: straight out, no theme wait, no second deadline. */
export const forceDismissSplash = (): void => {
  if (dismissed) return
  dismissed = true
  hideSplash()
}

/** Arm the deadline. Call once, as early as the app can run code. */
export const armSplashSafetyNet = (): void => {
  window.setTimeout(forceDismissSplash, SAFETY_MS)
}
