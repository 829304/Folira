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
 *
 * Content alone is not enough either: the first theme is fetched after the
 * markup is parsed, and revealing the window before that commit shows the
 * default palette for a frame. The splash therefore waits for both, bounded by
 * the same deadline as the safety net.
 */

/** Matches the `transition` on `#splash` in index.html. */
const FADE_MS = 180

/**
 * Long enough that no ordinary startup reaches it — the slowest trace on record
 * put the document on screen at 3 s — and short enough that a broken one is a
 * few seconds of blank window rather than a hang.
 */
const SAFETY_MS = 6000

/** Fixed once: the theme wait and the safety net count from the same instant. */
const deadlineAt = Date.now() + SAFETY_MS

let dismissed = false
let contentReady = false
let themeSettled = false

const hideSplash = (): void => {
  const splash = document.getElementById('splash')
  if (!splash) return

  splash.classList.add('is-done')
  // Removed rather than left transparent: a viewport-sized layer costs a
  // composite on every frame for as long as it is in the tree, and the point of
  // the whole exercise is the frames right after this one.
  window.setTimeout(() => splash.remove(), FADE_MS + 50)
}

/** Idempotent, and the only path that actually reveals the window. */
const reveal = (): void => {
  if (dismissed) return
  dismissed = true
  hideSplash()
}

let revealTimer: number | undefined

const revealWhenReady = (): void => {
  if (!contentReady) return

  if (themeSettled) {
    reveal()
    return
  }

  // A theme that never settles must not hold the window past the deadline the
  // safety net already promises, so the wait itself is bounded here.
  if (revealTimer !== undefined) return
  revealTimer = window.setTimeout(() => {
    revealTimer = undefined
    reveal()
  }, Math.max(0, deadlineAt - Date.now()))
}

/** Idempotent: several callers race to be the first content on screen. */
export const dismissSplash = (): void => {
  contentReady = true
  revealWhenReady()
}

/**
 * Release the theme half of the gate.
 *
 * Called by the first successful commit (`applyThemeSet`) and by a failure that
 * still owns the window: a theme that cannot be loaded must show the default
 * palette rather than keep the splash up.
 */
export const settleSplashTheme = (): void => {
  themeSettled = true
  revealWhenReady()
}

/** The safety net: straight out, no theme wait, no second deadline. */
export const forceDismissSplash = (): void => {
  reveal()
}

/** Arm the deadline. Call once, as early as the app can run code. */
export const armSplashSafetyNet = (): void => {
  window.setTimeout(forceDismissSplash, SAFETY_MS)
}
