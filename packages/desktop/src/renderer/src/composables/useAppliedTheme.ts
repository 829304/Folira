import { watch, type Ref } from 'vue'

import { applyThemeSet } from '@/util/theme'
import { firstPaintTheme } from '@/util/themeSelection'

/**
 * Keep this window painted with the resolved theme.
 *
 * The URL hands over the id the previous frame used, which stands in until the
 * preferences file has been read. `applyThemeSet` owns request ordering and
 * deduplication, so this watcher never compares ids itself: two windows that
 * resolve to the same theme still each apply it once.
 */
export function useAppliedTheme(resolved: Ref<string>, loaded: Ref<boolean>): void {
  const cached = window.marktext?.initialTheme ?? null

  watch([resolved, loaded], ([theme, ready]) => {
    applyThemeSet(firstPaintTheme(theme, ready, cached), { settleSplash: ready })
  }, { immediate: true })
}
