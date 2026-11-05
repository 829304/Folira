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
  ui: string
  md: string
}>()

const host = ref<HTMLDivElement | null>(null)

// Rendering into a shadow root is what keeps these stylesheets off the
// settings page: the document only ever sees this one host element.
let shadow: ShadowRoot | null = null
let request = 0
let warned = false

const render = async (): Promise<void> => {
  const token = ++request
  const [ui, md, prism] = await Promise.all([
    loadUiCss(props.ui),
    loadMdCss(props.md),
    loadPrismCss(props.md)
  ])
  if (token !== request || !shadow) return

  if (!isPreviewLoadable(ui, md)) {
    // Documented failure mode: an unloadable stylesheet keeps the pair that is
    // already on screen. A preview is not worth an error dialog, and a blank
    // one would read as "this theme is broken".
    if (!warned) {
      warned = true
      console.warn(`[theme-preview] cannot load ${!ui ? props.ui : props.md}; keeping the rendered pair`)
    }
    return
  }

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

watch(() => [props.ui, props.md], render)

onBeforeUnmount(() => {
  shadow = null
})
</script>

<style scoped>
.theme-preview-host {
  display: block;
}
</style>
