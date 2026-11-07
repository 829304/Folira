<template>
  <div class="pref-theme">
    <h4>{{ t('preferences.theme.title') }}</h4>

    <!-- The preview used to scroll away with the grid, so hovering or tabbing
         to a card near the bottom repainted something outside the viewport.
         Keeping it in a sticky header means the sample is always visible while
         the cards scroll under it. -->
    <div class="pref-theme-header">
      <section class="preview-section">
        <h6 class="section-title">
          {{ t('preferences.theme.preview') }}
        </h6>
        <theme-preview :theme="previewTheme" />
      </section>

      <!-- The tabs only change what the list browses. Keeping them on the search
           row leaves the header's own chrome (and therefore the preview height,
           zoom and scroll padding) untouched. -->
      <div class="filter-row">
        <div
          class="theme-tabs"
          role="tablist"
          :aria-label="t('preferences.theme.title')"
        >
          <button
            v-for="option of appearanceTabs"
            :key="option.value"
            type="button"
            role="tab"
            class="theme-tab"
            :class="{ active: tab === option.value }"
            :aria-selected="tab === option.value"
            :tabindex="tab === option.value ? 0 : -1"
            @click="setTab(option.value)"
            @keydown="moveTabFocus($event, option.value)"
          >
            {{ t(option.labelKey) }}
          </button>
        </div>
        <input
          v-model="query"
          class="search-input"
          type="search"
          :placeholder="t('preferences.theme.searchThemes')"
        >
      </div>
    </div>

    <div class="theme-grid">
      <button
        v-for="entry of visibleThemes"
        :key="entry.id"
        type="button"
        class="theme-card"
        :class="{ active: entry.id === selectedTheme }"
        @click="selectTheme(entry.id)"
        @mouseenter="hovered = entry.id"
        @mouseleave="hovered = null"
        @focus="hovered = entry.id"
        @blur="hovered = null"
      >
        <span
          class="theme-swatch"
          :style="{ background: swatch(entry, 'ui', 'editorBgColor') }"
        >
          <span
            class="theme-swatch-page"
            :style="{ background: swatch(entry, 'md', 'editorBgColor') }"
          >
            <span
              class="theme-swatch-heading"
              :style="{ background: swatch(entry, 'md', 'h1Color') }"
            />
            <span
              class="theme-swatch-line"
              :style="{ background: swatch(entry, 'md', 'editorColor') }"
            />
            <span
              class="theme-swatch-link"
              :style="{ background: swatch(entry, 'md', 'linkColor') }"
            />
            <span
              class="theme-swatch-code"
              :style="{ background: swatch(entry, 'md', 'codeBlockBgColor') }"
            />
          </span>
        </span>
        <span class="theme-name">{{ entry.label }}</span>
      </button>
    </div>
    <p
      v-if="visibleThemes.length === 0"
      class="empty"
    >
      {{ t('preferences.theme.noThemes') }}
    </p>

    <div class="custom-css">
      <div class="description">
        {{ t('preferences.theme.customCss') }}
      </div>
      <textarea
        class="custom-css-input"
        rows="10"
        :value="customCss"
        @change="
          (event: Event) =>
            setPreference('customCss')((event.target as HTMLTextAreaElement).value)
        "
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import { usePaintedThemeSelection } from '@/composables/usePaintedThemeSelection'
import { applyThemeSet } from '@/util/theme'
import {
  appearanceOf,
  matchThemes,
  themesOf,
  type ThemeAppearance
} from '@/util/themeCatalog'
import { THEMES, type ThemeEntry } from '@/util/themeColor'
import ThemePreview from './preview.vue'

const { t } = useI18n()
const preferenceStore = usePreferencesStore()
const { customCss } = storeToRefs(preferenceStore)

// The card shows what this window is actually painting, not the choice it is
// aiming at: another window may have picked a theme whose sheets fail to load
// here, and the preference stays that target while the paint stays the old one.
const selectedTheme = usePaintedThemeSelection()

// The tab only filters the list, so it opens on the theme already on screen:
// the appearance of the painted theme, the same computed the cards highlight.
// Reading the preference here would open the target tab while a failed commit
// still paints the previous look. `tabTouched` keeps the tab following commits
// made after mount (another window, the first preferences load) until the user
// chooses a tab themselves.
const tabTouched = ref(false)
const tab = ref<ThemeAppearance>(appearanceOf(selectedTheme.value))

watch(selectedTheme, (id) => {
  if (!tabTouched.value) tab.value = appearanceOf(id)
})

const appearanceTabs: ReadonlyArray<{ value: ThemeAppearance; labelKey: string }> = [
  { value: 'light', labelKey: 'preferences.theme.lightThemes' },
  { value: 'dark', labelKey: 'preferences.theme.darkThemes' }
]

const hovered = ref<string | null>(null)
// Hovering a card repaints the preview only; the saved theme comes back the
// moment the pointer leaves, so a look never rewrites a preference.
const previewTheme = computed(() => hovered.value ?? selectedTheme.value)

const setTab = (next: ThemeAppearance): void => {
  tab.value = next
  tabTouched.value = true
  // The card that owned the hover preview has just been filtered out of the
  // grid, so its mouseleave/blur never fires; without this the preview would
  // keep showing the theme from the tab the user just left.
  hovered.value = null
}

const moveTabFocus = (event: KeyboardEvent, current: ThemeAppearance): void => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()

  // Two tabs: either arrow wraps onto the other one.
  const next: ThemeAppearance = current === 'light' ? 'dark' : 'light'
  setTab(next)

  // Roving tabindex keeps only the selected tab in the Tab order, so the arrow
  // key has to move focus together with the selection.
  const tabButtons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>(
    '[role="tab"]'
  )
  tabButtons?.[appearanceTabs.findIndex(option => option.value === next)]?.focus()
}

const query = ref('')
// One query, two tabs: the grid is the current appearance filtered by the same
// search term, and switching tabs keeps the term.
const visibleThemes = computed<ThemeEntry[]>(() =>
  matchThemes(themesOf(THEMES, tab.value), query.value)
)

const swatch = (entry: ThemeEntry, axis: 'ui' | 'md', name: string): string =>
  entry.swatches[axis]?.[name] ?? 'transparent'

const selectTheme = async (id: string): Promise<void> => {
  // A card selection is not a tab switch: pin the tab so the commit's later
  // selectedTheme update cannot move the user off the list they are browsing.
  tabTouched.value = true

  const result = await applyThemeSet(id)
  // A failure or a newer selection leaves the previous theme on screen, so it
  // must leave the previous preference in place as well.
  if (result === 'applied') {
    preferenceStore.SET_SINGLE_PREFERENCE({ type: 'theme', value: id })
  }
}

const setPreference = (type: keyof PreferencesState) => (value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}
</script>

<style>
.pref-theme {
  max-width: 620px;

  /* One number drives the whole sticky header: the preview's shadow stylesheet
     reads --theme-preview-height, the header's height is that plus its own
     chrome, and scroll-padding keeps a focused card below it. To change the
     height, edit --theme-preview-height only; the totals follow from it.
     The 84px chrome is the title row, the search box, the 8px top padding and
     the bottom border, measured in the settings window — not estimated. */
  --theme-preview-height: 216px; /* total 300px */
  --theme-preview-zoom: 0.45;
  --theme-header-height: calc(var(--theme-preview-height) + 84px);
  scroll-padding-top: calc(var(--theme-header-height) + 8px);

  /* Short windows trade preview height for grid space. The header follows the
     same value, so the two cannot drift apart. The shorter frames crop the
     sample's tail (the display rules live in preview.css's media queries) and
     raise the zoom because fewer blocks have to fit. The 176px frame keeps the
     code block — it is the only place the Prism palette shows in the preview —
     and drops the table and list; the 140px frame drops the code block too.
     0.58 is measured against the cropped samples: it keeps body text at 8.1px
     while the visible blocks still fit both frames. */
  @media (max-height: 760px) {
    --theme-preview-height: 176px; /* total 260px */
    --theme-preview-zoom: 0.58;
  }

  @media (max-height: 640px) {
    --theme-preview-height: 140px; /* total 224px */
    --theme-preview-zoom: 0.58;
  }

  & .pref-theme-header {
    position: sticky;
    top: 0;
    z-index: 2;
    box-sizing: border-box;
    /* A real height, not a minimum: the sticky header must match the variable
       exactly, or the reserved space below it is silently wrong. */
    height: var(--theme-header-height);
    padding-top: 8px;
    background: var(--editorBgColor);
    border-bottom: 1px solid var(--tableBorderColor);
  }

  & .section-title {
    margin: 4px 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--editorColor);
  }

  & .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 12px;
  }

  & .theme-tabs {
    display: flex;
    flex: none;
    gap: 2px;
  }

  & .theme-tab {
    padding: 5px 10px;
    font-size: 13px;
    color: var(--editorColor50);
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;

    &:focus-visible {
      border: var(--buttonBorder);
      outline: none;
    }

    &.active {
      color: var(--themeColor);
      background: var(--itemBgColor);
      border: var(--buttonBorder);
    }
  }

  & .search-input {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    font-size: 13px;
    color: var(--editorColor);
    background: var(--inputBgColor);
    border: 1px solid var(--buttonBorder);
    border-radius: 6px;
    outline: none;

    &:focus {
      border-color: var(--themeColor);
    }
  }

  & .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 12px;
    margin-top: 14px;
  }

  & .theme-card {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 6px;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 9px;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      border-color: var(--buttonBorderHover);
      background: var(--itemBgColor);
      outline: none;
    }

    &.active {
      border-color: var(--themeColor);
      background: var(--itemBgColor);
    }
  }

  & .theme-name {
    padding: 0 2px;
    overflow: hidden;
    font-size: 12px;
    color: var(--editorColor);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  & .theme-swatch {
    display: block;
    height: 74px;
    padding: 10px;
    overflow: hidden;
    border: 1px solid var(--tableBorderColor);
    border-radius: 6px;
  }

  & .theme-swatch-page {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    padding: 10px;
    border-radius: 4px;
  }

  & .theme-swatch-heading,
  & .theme-swatch-line,
  & .theme-swatch-link,
  & .theme-swatch-code {
    display: block;
    border-radius: 3px;
  }

  & .theme-swatch-heading {
    width: 52%;
    height: 7px;
  }

  & .theme-swatch-line {
    width: 82%;
    height: 4px;
    opacity: 0.55;
  }

  & .theme-swatch-link {
    width: 34%;
    height: 4px;
    opacity: 0.8;
  }

  & .theme-swatch-code {
    width: 100%;
    height: 14px;
    margin-top: auto;
    opacity: 0.9;
  }

  & .empty {
    margin: 8px 2px;
    font-size: 12.5px;
    color: var(--editorColor50);
  }

  & .custom-css {
    margin-top: 26px;
  }

  & .custom-css-input {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
    color: var(--editorColor);
    background: var(--inputBgColor);
    border: 1px solid var(--buttonBorder);
    border-radius: 6px;
    resize: vertical;
  }
}
</style>
