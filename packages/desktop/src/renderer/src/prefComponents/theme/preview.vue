<template>
  <div
    ref="host"
    class="theme-preview-host"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import baseCss from '@/assets/themes/base.css?inline'
import { loadMdCss, loadPrismCss, loadUiCss } from '@/util/themeColor'
import { composePreviewCss, isPreviewLoadable, PREVIEW_SAMPLE } from '@/util/themePreview'

import chromeCss from './preview.css?inline'

const props = defineProps<{
  theme: string
}>()

const host = ref<HTMLDivElement | null>(null)

// Rendering into a shadow root is what keeps these stylesheets off the
// settings page: the document only ever sees this one host element.
let shadow: ShadowRoot | null = null
let request = 0
let warned = false

// A preview is not worth an error dialog, and a blank one reads as "this theme
// is broken", so every failure ends with the theme already on screen still
// there. The first one is worth a line in the console; repeats would only
// repeat themselves on every hover.
const keep = (theme: string, error?: unknown): void => {
  if (warned) return
  warned = true
  console.warn(`[theme-preview] cannot load ${theme}; keeping the rendered theme`, error)
}

const render = async (): Promise<void> => {
  const token = ++request
  let ui: string
  let md: string
  let prism: string
  try {
    ;[ui, md, prism] = await Promise.all([
      loadUiCss(props.theme),
      loadMdCss(props.theme),
      loadPrismCss(props.theme)
    ])
  } catch (error) {
    if (token === request) keep(props.theme, error)
    return
  }
  if (token !== request || !shadow) return

  // A missing stylesheet resolves to an empty string rather than rejecting, so
  // the rejection path above is not the only way a theme can arrive unusable.
  if (!isPreviewLoadable(props.theme, ui, md, prism)) {
    keep(props.theme)
    return
  }

  // A theme's files arrive together: replacing the shadow contents only after
  // all three have loaded is what keeps a failed or superseded request from
  // leaving the sample with one theme's frame around another's body.
  const sheet = document.createElement('style')
  sheet.textContent = composePreviewCss({ base: baseCss, ui, md, prism, chrome: chromeCss })

  const page = document.createElement('div')
  page.className = 'editor-wrapper'
  page.innerHTML = PREVIEW_SAMPLE

  shadow.replaceChildren(sheet, page)
}

onMounted(() => {
  if (!host.value) return
  shadow = host.value.attachShadow({ mode: 'open' })
  render()
})

watch(() => props.theme, render)

onBeforeUnmount(() => {
  shadow = null
})
</script>

<style scoped>
.theme-preview-host {
  display: block;
}
</style>
