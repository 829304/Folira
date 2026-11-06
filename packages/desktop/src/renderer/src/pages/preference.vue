<template>
  <div class="pref-container">
    <title-bar v-if="showCustomTitleBar" />
    <side-bar />
    <div
      class="pref-content"
      :class="{ frameless: titleBarStyle === 'custom' || isOsx }"
    >
      <div
        v-if="!showCustomTitleBar"
        class="title-bar"
      />
      <router-view class="pref-setting" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, nextTick, getCurrentInstance } from 'vue'
import { usePreferencesStore } from '@/store/preferences'
import { storeToRefs } from 'pinia'
import TitleBar from '@/prefComponents/common/titlebar.vue'
import SideBar from '@/prefComponents/sideBar/index.vue'
import { applyTheme } from '@/util/theme'
import { useResolvedThemePair } from '@/composables/useResolvedThemePair'
import { useAppliedTheme } from '@/composables/useAppliedTheme'
import { isOsx } from '@/util'
import { registerSettingsComponents } from '@/prefComponents/settingsComponents'
import { dismissSplash } from '@/util/splash'

// The settings tree's own Element Plus components, registered here rather than
// at startup so the editor window does not pay for them. Setup runs before this
// component and its router children render, which is when Vue resolves tags.
registerSettingsComponents(getCurrentInstance()!.appContext.app)

// Store
const preferencesStore = usePreferencesStore()

// Computed properties
const { titleBarStyle } = storeToRefs(preferencesStore)

// This window is chrome, but it renders the editor preview and the theme
// picker, so it resolves through the same function the editor uses — otherwise
// the two windows could show different pairs for the same preferences.
const activeTheme = useResolvedThemePair()

const showCustomTitleBar = computed<boolean>(() => {
  // Always show the custom title bar on macOS to provide a close button
  if (isOsx) {
    return true
  }
  return titleBarStyle.value === 'custom'
})

// Watchers
// Same shape as the editor: the URL pair paints the first frame, and the store
// replaces it once its file has been read — including when the stored pair
// happens to equal the cached one, which never changes the computed value.
const { preferencesLoaded } = storeToRefs(preferencesStore)
useAppliedTheme(activeTheme, preferencesLoaded)
// Lifecycle
onMounted(() => {
  nextTick(() => {
    const initialPair = window.marktext?.initialThemePair
    // The URL pair is what the last frame showed; the resolved pair is what the
    // preferences file asks for. Prefer the stored one when it has already been
    // read, and keep the URL pair only for the first paint.
    applyTheme({
      ui: preferencesLoaded.value ? activeTheme.value.ui : initialPair?.ui || activeTheme.value.ui,
      md: preferencesLoaded.value ? activeTheme.value.md : initialPair?.md || activeTheme.value.md
    })

    preferencesStore.ASK_FOR_USER_PREFERENCE()
    // This window shares `index.html`, and therefore its loading screen, with
    // the editor. Its own first content is the settings tree, which is here.
    dismissSplash()
  })
})
</script>

<style>
.pref-container {
  --prefSideBarWidth: 220px;

  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  display: flex;
  background: var(--editorBgColor);

  & h1,
  & h2,
  & h3,
  & h4,
  & h5,
  & h6 {
    color: var(--editorColor);
    font-weight: 500;
    line-height: 1.4;
  }

  & h4 {
    margin: 0;
    font-size: 18px;
  }

  & h5 {
    font-size: 15px;
  }

  & h6 {
    font-size: 15px;
  }

  & .notes {
    display: block;
    margin: 8px 0 0;
    font-style: italic;
    font-size: 12px;
    color: var(--editorColor80);
  }

  & .pref-content {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    max-width: calc(100vw - var(--prefSideBarWidth));
    & .title-bar {
      width: 100%;
      height: var(--titleBarHeight);
      position: fixed;
      top: 0;
      right: 0;
      -webkit-app-region: drag;
    }
    & .pref-setting {
      padding: 50px 40px;
      padding-top: var(--titleBarHeight);
      flex: 1;
      height: calc(100vh - var(--titleBarHeight));
      overflow: auto;
    }
    & span,
    & div,
    & h1,
    & h2,
    & h3,
    & h4,
    & h5,
    & h6 {
      user-select: none;
    }
  }
  & .pref-content.frameless .pref-setting {
    /* Move the scrollbar below the titlebar */
    margin-top: var(--titleBarHeight);
    padding-top: 0;
  }
}
</style>
