import { watch, type Ref } from 'vue'
import { applyTheme } from '@/util/theme'
import type { ThemePair } from '@/util/themeSelection'

/** Replace first-paint cache once preferences arrive, even for an unchanged ID. */
export function useAppliedTheme(pair: Ref<ThemePair>, loaded: Ref<boolean>) {
  let painted: ThemePair | null = null
  return watch([pair, loaded], ([next, ready]) => {
    if (!ready) return
    if (painted && painted.ui === next.ui && painted.md === next.md) return
    painted = { ui: next.ui, md: next.md }
    applyTheme(next)
  }, { immediate: true })
}
