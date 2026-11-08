import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const renderer = new URL('../../../../desktop/src/renderer/src/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, renderer), 'utf8');

// Reuse the sample and settings-page CSS so changes to the actual preview
// content, breakpoints or zoom are part of the measurement.
const sample = read('util/themePreview.ts').match(/PREVIEW_SAMPLE = `([\s\S]*?)`/)?.[1];
const settingsCss = read('prefComponents/theme/index.vue').match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!sample || !settingsCss)
    throw new Error('The theme preview fixture could not load the settings sample or its CSS');

for (const theme of ['github-light', 'typora-gitbook']) {
    test(`${theme} shows the entire code sample in the default settings viewport`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Measures the settings layout in Chromium');
        await page.setViewportSize({ width: 950, height: 650 });
        await page.setContent(`<!doctype html><style>${settingsCss}</style><section class="pref-theme"><div id="preview"></div></section>`);
        const css = [
            ...['base.css', `ui/${theme}.css`, `md/${theme}.css`].map(path =>
                read(`assets/themes/${path}`).replace(/:root\b/g, ':host'),
            ),
            read(`assets/themes/prismjs/${theme}.theme.css`),
            read('prefComponents/theme/preview.css'),
        ].join('\n');
        const bounds = await page.locator('#preview').evaluate((host, { css, sample }) => {
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<style>${css}</style><div class="editor-wrapper">${sample}</div>`;
            const code = shadow.querySelector('.sample-code code');
            if (!code)
                throw new Error('The settings preview sample has no code block');
            const range = document.createRange();
            range.selectNodeContents(code);
            const text = range.getBoundingClientRect();
            const frame = host.getBoundingClientRect();
            return {
                textHeight: text.height,
                textBottom: text.bottom - frame.top,
                clipBottom: host.clientTop + host.clientHeight,
            };
        }, { css, sample });

        expect(bounds.textHeight, 'the code sample must be displayed').toBeGreaterThan(0);
        expect(bounds.textBottom, 'the final code line must fit inside the clipping frame').toBeLessThanOrEqual(bounds.clipBottom);
    });
}
