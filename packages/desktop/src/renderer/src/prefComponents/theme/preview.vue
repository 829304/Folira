<template>
  <div class="theme-preview">
    <h1>Folira</h1>
    <p>
      The quick brown fox jumps over the lazy dog. <strong>Bold</strong>,
      <em>italic</em>, a <a href="#">link</a> and <code>inline code</code>.
    </p>
    <blockquote>
      <p>A quote renders with its own border and colour.</p>
    </blockquote>
    <ul>
      <li>First item</li>
      <li>Second item with <code>code</code></li>
    </ul>
    <table>
      <thead>
        <tr><th>Column</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>Row</td><td>42</td></tr>
      </tbody>
    </table>
    <pre><code>const sum = 1 + 1</code></pre>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'

import baseCss from '@/assets/themes/base.css?inline'
import { loadMdCss, loadUiCss } from '@/util/themeColor'
import { composePreviewCss } from '@/util/themePreview'

const props = defineProps<{
  ui: string
  md: string
}>()

let host: HTMLStyleElement | null = null
let request = 0

const render = async (): Promise<void> => {
  const token = ++request
  const [ui, md] = await Promise.all([loadUiCss(props.ui), loadMdCss(props.md)])
  if (token !== request || !host) return

  host.textContent = composePreviewCss(baseCss, ui, md)
}

onMounted(async () => {
  host = document.createElement('style')
  host.dataset.folira = 'theme-preview'
  document.head.append(host)
  await render()
})

watch(() => [props.ui, props.md], render)

onBeforeUnmount(() => {
  host?.remove()
  host = null
})
</script>

<style scoped>
.theme-preview {
  --preview-gap: 10px;

  padding: 18px 20px;
  border-radius: 10px;
  background: var(--editorBgColor, #fff);
  color: var(--editorColor, #333);
  font-size: 14px;
  line-height: 1.7;
  border: 1px solid var(--tableBorderColor, rgba(128, 128, 128, 0.25));
  overflow: hidden;
}

h1 {
  margin: 0 0 var(--preview-gap);
  color: var(--h1Color, #333);
  font-size: 22px;
}

p {
  margin: 0 0 var(--preview-gap);
}

a {
  color: var(--linkColor, #218e63);
}

code {
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--codeBgColor, rgba(0, 0, 0, 0.06));
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
}

blockquote {
  margin: 0 0 var(--preview-gap);
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--blockquoteBorderColor, #ddd);
  color: var(--blockquoteTextColor, #666);
}

ul {
  margin: 0 0 var(--preview-gap);
  padding-left: 20px;
}

li::marker {
  color: var(--listMarkerColor, #999);
}

table {
  width: 100%;
  margin: 0 0 var(--preview-gap);
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 4px 8px;
  border: 1px solid var(--tableBorderColor, rgba(128, 128, 128, 0.25));
  text-align: left;
}

pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--codeBlockBgColor, rgba(0, 0, 0, 0.05));
  overflow: hidden;
}

pre code {
  padding: 0;
  background: none;
  font-size: 12.5px;
}
</style>
