// The OS light/dark preference, as a ref the theme resolver can read.
//
// One module-level listener serves every window: the query only changes when
// the user changes it, so there is nothing to gain from subscribing per
// component, and a single ref keeps the editor and the settings window on the
// same answer.

import { computed, ref, type Ref } from 'vue'

import type { Appearance } from '@/util/themeSelection'

const STATE_URL = '(prefers-color-scheme: dark)'
const appearance = ref<Appearance>('light')

const query = (): MediaQueryList | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null

  try {
    return window.matchMedia(STATE_URL)
  } catch {
    return null
  }
}

const read = (): Appearance => (query()?.matches ? 'dark' : 'light')

let subscribed = false

const subscribe = (): void => {
  if (subscribed) return
  subscribed = true

  appearance.value = read()
  const media = query()
  if (!media) return

  const onChange = (): void => {
    appearance.value = read()
  }
  // Older WebViews only have `addListener`; both are optional chained so a
  // missing implementation cannot break the first render.
  media.addEventListener?.('change', onChange)
  media.addListener?.(onChange)
}

/** Read the OS appearance and keep it current. Safe to call repeatedly. */
export function useSystemAppearance(): Ref<Appearance> {
  subscribe()

  return computed(() => appearance.value)
}
