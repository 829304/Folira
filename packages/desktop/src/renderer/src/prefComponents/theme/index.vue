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

      <div class="search-row">
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
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import { usePaintedThemeSelection } from '@/composables/usePaintedThemeSelection'
import { applyThemeSet } from '@/util/theme'
import { THEMES, type ThemeEntry } from '@/util/themeColor'
import ThemePreview from './preview.vue'

const { t } = useI18n()
const preferenceStore = usePreferencesStore()
const { customCss } = storeToRefs(preferenceStore)

// The card shows what this window is actually painting, not the choice it is
// aiming at: another window may have picked a theme whose sheets fail to load
// here, and the preference stays that target while the paint stays the old one.
const selectedTheme = usePaintedThemeSelection()

const hovered = ref<string | null>(null)
// Hovering a card repaints the preview only; the saved theme comes back the
// moment the pointer leaves, so a look never rewrites a preference.
const previewTheme = computed(() => hovered.value ?? selectedTheme.value)

const query = ref('')
const visibleThemes = computed<ThemeEntry[]>(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return THEMES

  return THEMES.filter(
    theme => theme.id.includes(needle) || theme.label.toLowerCase().includes(needle)
  )
})

const swatch = (entry: ThemeEntry, axis: 'ui' | 'md', name: string): string =>
  entry.swatches[axis]?.[name] ?? 'transparent'

const selectTheme = async (id: string): Promise<void> => {
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

  & .pref-theme-header {
    position: sticky;
    top: 0;
    z-index: 2;
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

  & .search-row {
    display: flex;
    margin: 4px 0 12px;
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
