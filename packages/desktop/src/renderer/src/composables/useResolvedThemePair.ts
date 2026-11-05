// The pair of themes the current preferences resolve to.
//
// Every window needs it — the editor for its body palette and charts, the
// settings window for the picker, the shell for the chrome. Sharing one
// computed keeps them from drifting apart and keeps the "follow the system"
// logic in a single place.

import { computed, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'

import { usePreferencesStore } from '@/store/preferences'
import { useSystemAppearance } from './useSystemAppearance'
import { resolveThemePair, type ThemePair } from '@/util/themeSelection'

export function useResolvedThemePair(): ComputedRef<ThemePair> {
  const store = usePreferencesStore()
  const {
    theme,
    uiTheme,
    mdTheme,
    followSystemTheme,
    lightModeTheme,
    darkModeTheme,
    lightUiTheme,
    lightMdTheme,
    darkUiTheme,
    darkMdTheme
  } = storeToRefs(store)
  const systemAppearance = useSystemAppearance()

  return computed(() =>
    resolveThemePair(
      {
        theme: theme.value,
        uiTheme: uiTheme.value,
        mdTheme: mdTheme.value,
        followSystemTheme: followSystemTheme.value,
        lightModeTheme: lightModeTheme.value,
        darkModeTheme: darkModeTheme.value,
        lightUiTheme: lightUiTheme.value,
        lightMdTheme: lightMdTheme.value,
        darkUiTheme: darkUiTheme.value,
        darkMdTheme: darkMdTheme.value
      },
      systemAppearance.value
    )
  )
}
