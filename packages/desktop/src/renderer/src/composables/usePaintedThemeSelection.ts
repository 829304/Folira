import { computed, type ComputedRef } from 'vue'
import { paintedTheme } from '@/util/theme'

/**
 * The theme this window is actually painting.
 *
 * The preference holds what the user asked for, which is not the same thing: a
 * window that fails to load the new theme keeps painting the previous one, and
 * another window may have picked a theme this one has not committed yet. The
 * settings page highlights and previews this value, so it never labels a theme
 * the editor is not showing.
 */
export const usePaintedThemeSelection = (): ComputedRef<string> =>
  computed(() => paintedTheme())
