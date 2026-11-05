<template>
  <div class="pref-theme">
    <h4>{{ t('preferences.theme.title') }}</h4>

    <Bool
      :description="t('preferences.theme.followSystemTheme')"
      :bool="followSystemTheme"
      :on-change="setPreference('followSystemTheme')"
    />

    <section class="preview-section">
      <h6 class="section-title">
        {{ t('preferences.theme.preview') }}
      </h6>
      <theme-preview
        :ui="previewPair.ui"
        :md="previewPair.md"
      />
    </section>

    <template v-if="followSystemTheme">
      <compound>
        <template #head>
          <h6 class="section-title">
            {{ t('preferences.theme.interfaceTheme') }}
          </h6>
        </template>
        <template #children>
          <cur-select
            :description="t('preferences.theme.lightModeTheme')"
            :value="lightUiTheme || lightModeTheme"
            :options="uiOptions"
            :on-change="setPreference('lightUiTheme')"
          />
          <cur-select
            :description="t('preferences.theme.darkModeTheme')"
            :value="darkUiTheme || darkModeTheme"
            :options="uiOptions"
            :on-change="setPreference('darkUiTheme')"
          />
        </template>
      </compound>

      <compound>
        <template #head>
          <h6 class="section-title">
            {{ t('preferences.theme.markdownTheme') }}
          </h6>
        </template>
        <template #children>
          <cur-select
            :description="t('preferences.theme.lightModeTheme')"
            :value="lightMdTheme || lightModeTheme"
            :options="mdOptions"
            :on-change="setPreference('lightMdTheme')"
          />
          <cur-select
            :description="t('preferences.theme.darkModeTheme')"
            :value="darkMdTheme || darkModeTheme"
            :options="mdOptions"
            :on-change="setPreference('darkMdTheme')"
          />
        </template>
      </compound>
    </template>

    <template v-else>
      <div class="filter-row">
        <input
          v-model="query"
          class="search-input"
          type="search"
          :placeholder="t('preferences.theme.searchThemes')"
        >
        <div class="appearance-filter">
          <button
            v-for="option of APPEARANCE_FILTERS"
            :key="option.value"
            type="button"
            class="filter-button"
            :class="{ active: appearanceFilter === option.value }"
            @click="appearanceFilter = option.value"
          >
            {{ t(option.label) }}
          </button>
        </div>
      </div>

      <section class="axis-section">
        <h6 class="section-title">
          {{ t('preferences.theme.interfaceTheme') }}
        </h6>
        <div class="theme-grid">
          <button
            v-for="entry of visibleUiThemes"
            :key="entry.id"
            type="button"
            class="theme-card"
            :class="{ active: entry.id === savedPair.ui }"
            @click="setAxisTheme('uiTheme', entry.id)"
            @mouseenter="hovered = { ...savedPair, ui: entry.id }"
            @mouseleave="hovered = null"
            @focus="hovered = { ...savedPair, ui: entry.id }"
            @blur="hovered = null"
          >
            <span
              class="ui-swatch"
              :style="{ background: swatch(entry, 'ui', 'editorBgColor') }"
            >
              <span
                class="ui-swatch-side"
                :style="{ background: swatch(entry, 'ui', 'sideBarBgColor') }"
              />
              <span class="ui-swatch-body">
                <span
                  class="ui-swatch-heading"
                  :style="{ background: swatch(entry, 'ui', 'editorColor') }"
                />
                <span
                  class="ui-swatch-line"
                  :style="{ background: swatch(entry, 'ui', 'editorColor') }"
                />
                <span
                  class="ui-swatch-button"
                  :style="{ background: swatch(entry, 'ui', 'buttonPrimaryBgColor') }"
                />
              </span>
            </span>
            <span class="theme-name">{{ entry.label }}</span>
          </button>
        </div>
        <p
          v-if="visibleUiThemes.length === 0"
          class="empty"
        >
          {{ t('preferences.theme.noThemes') }}
        </p>
      </section>

      <section class="axis-section">
        <h6 class="section-title">
          {{ t('preferences.theme.markdownTheme') }}
        </h6>
        <div class="theme-grid">
          <button
            v-for="entry of visibleMdThemes"
            :key="entry.id"
            type="button"
            class="theme-card"
            :class="{ active: entry.id === savedPair.md }"
            @click="setAxisTheme('mdTheme', entry.id)"
            @mouseenter="hovered = { ...savedPair, md: entry.id }"
            @mouseleave="hovered = null"
            @focus="hovered = { ...savedPair, md: entry.id }"
            @blur="hovered = null"
          >
            <span
              class="md-swatch"
              :style="{ background: swatch(entry, 'md', 'editorBgColor') }"
            >
              <span
                class="md-swatch-heading"
                :style="{ background: swatch(entry, 'md', 'h1Color') }"
              />
              <span
                class="md-swatch-line"
                :style="{ background: swatch(entry, 'md', 'editorColor') }"
              />
              <span
                class="md-swatch-link"
                :style="{ background: swatch(entry, 'md', 'linkColor') }"
              />
              <span
                class="md-swatch-code"
                :style="{ background: swatch(entry, 'md', 'codeBlockBgColor') }"
              />
            </span>
            <span class="theme-name">{{ entry.label }}</span>
          </button>
        </div>
        <p
          v-if="visibleMdThemes.length === 0"
          class="empty"
        >
          {{ t('preferences.theme.noThemes') }}
        </p>
      </section>
    </template>

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
import { THEMES, type ThemeEntry } from '@/util/themeColor'
import { useResolvedThemePair } from '@/composables/useResolvedThemePair'
import type { ThemePair } from '@/util/themeSelection'
import Bool from '../common/bool/index.vue'
import CurSelect from '../common/select/index.vue'
import Compound from '../common/compound/index.vue'
import ThemePreview from './preview.vue'
import type { PrefSelectOption } from '../common/types'

type AppearanceFilter = 'all' | 'light' | 'dark'

const APPEARANCE_FILTERS: ReadonlyArray<{ value: AppearanceFilter; label: string }> = [
  { value: 'all', label: 'preferences.theme.allThemes' },
  { value: 'light', label: 'preferences.theme.lightThemes' },
  { value: 'dark', label: 'preferences.theme.darkThemes' }
]

const { t } = useI18n()
const preferenceStore = usePreferencesStore()
const {
  followSystemTheme,
  lightModeTheme,
  darkModeTheme,
  lightUiTheme,
  lightMdTheme,
  darkUiTheme,
  darkMdTheme,
  customCss
} = storeToRefs(preferenceStore)

const savedPair = useResolvedThemePair()
const hovered = ref<ThemePair | null>(null)
// Hovering a card repaints the preview only; the saved pair comes back the
// moment the pointer leaves, so a look never rewrites a preference.
const previewPair = computed<ThemePair>(() => hovered.value ?? savedPair.value)

const query = ref('')
const appearanceFilter = ref<AppearanceFilter>('all')

const optionsFor = (entries: ThemeEntry[]): PrefSelectOption<string>[] =>
  entries.map(entry => ({ label: entry.label, value: entry.id }))

const uiOptions = optionsFor(THEMES)
const mdOptions = optionsFor(THEMES)

const matching = (axis: 'ui' | 'md'): ThemeEntry[] => {
  const needle = query.value.trim().toLowerCase()

  return THEMES.filter(theme => {
    if (appearanceFilter.value !== 'all' && theme.appearance !== appearanceFilter.value) return false
    if (!needle) return true
    // The axis list is the same set of ids; filter on what the card claims to
    // draw so a search never offers a theme with a missing swatch.
    const colour = theme.swatches[axis]?.editorBgColor ?? ''

    return theme.id.includes(needle) || theme.label.toLowerCase().includes(needle) || colour.includes(needle)
  })
}

const visibleUiThemes = computed(() => matching('ui'))
const visibleMdThemes = computed(() => matching('md'))

const swatch = (entry: ThemeEntry, axis: 'ui' | 'md', name: string): string =>
  entry.swatches[axis]?.[name] ?? 'transparent'

const setPreference = (type: keyof PreferencesState) => (value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}

const setAxisTheme = (type: 'uiTheme' | 'mdTheme', id: string): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value: id })
}
</script>

<style>
.pref-theme {
  max-width: 620px;

  & .section-title {
    margin: 22px 0 10px;
    font-size: 14px;
    font-weight: 600;
    color: var(--editorColor);
  }

  & .preview-section {
    margin-top: 6px;
  }

  & .filter-row {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 22px 0 8px;
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

  & .appearance-filter {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 7px;
    background: var(--inputBgColor);
  }

  & .filter-button {
    padding: 4px 10px;
    font-size: 12px;
    color: var(--editorColor80);
    background: none;
    border: none;
    border-radius: 5px;
    cursor: pointer;

    &.active {
      color: var(--buttonPrimaryFontColor);
      background: var(--themeColor);
    }
  }

  & .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 12px;
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

  & .ui-swatch {
    display: flex;
    height: 74px;
    overflow: hidden;
    border: 1px solid var(--tableBorderColor);
    border-radius: 6px;
  }

  & .ui-swatch-side {
    width: 26%;
  }

  & .ui-swatch-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    padding: 12px 10px;
  }

  & .ui-swatch-heading,
  & .ui-swatch-line,
  & .ui-swatch-button {
    display: block;
    border-radius: 3px;
    opacity: 0.75;
  }

  & .ui-swatch-heading {
    width: 46%;
    height: 5px;
  }

  & .ui-swatch-line {
    width: 72%;
    height: 4px;
    opacity: 0.35;
  }

  & .ui-swatch-button {
    width: 34px;
    height: 10px;
    margin-top: auto;
    border-radius: 5px;
  }

  & .md-swatch {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 74px;
    padding: 12px 10px;
    overflow: hidden;
    border: 1px solid var(--tableBorderColor);
    border-radius: 6px;
  }

  & .md-swatch-heading,
  & .md-swatch-line,
  & .md-swatch-link,
  & .md-swatch-code {
    display: block;
    border-radius: 3px;
  }

  & .md-swatch-heading {
    width: 52%;
    height: 7px;
  }

  & .md-swatch-line {
    width: 82%;
    height: 4px;
    opacity: 0.55;
  }

  & .md-swatch-link {
    width: 34%;
    height: 4px;
    opacity: 0.8;
  }

  & .md-swatch-code {
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
