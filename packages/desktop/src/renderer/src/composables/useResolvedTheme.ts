import { computed, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'

import { resolveThemeId } from '@/util/themeSelection'
import { usePreferencesStore } from '@/store/preferences'

/** The theme the preferences ask for, validated and ready to paint. */
export function useResolvedTheme(): ComputedRef<string> {
  const { theme } = storeToRefs(usePreferencesStore())

  return computed(() => resolveThemeId(theme.value))
}
