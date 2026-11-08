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

test('GitBook keeps shared code surfaces on the readable panel', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the desktop theme cascade in Chromium');
    const themeCss = ['base.css', 'ui/typora-gitbook.css', 'md/typora-gitbook.css']
        .map(path => read(`assets/themes/${path}`))
        .join('\n');
    await page.setContent(`<!doctype html><style>${themeCss}</style><div class="editor-wrapper">
<pre class="mu-code-block"><code class="mu-code">const a = 1</code></pre>
<pre class="mu-frontmatter">title: x</pre>
<div class="mu-html-container"><pre>&lt;b&gt;x&lt;/b&gt;</pre></div>
<div class="mu-math-container">a^2</div>
<div class="mu-diagram-container">A -&gt; B</div>
<span class="mu-inline-footnote-identifier"><a href="#">1</a></span>
</div>`);
    const style = (selector: string) => page.locator(selector).first().evaluate(el => {
        const computed = getComputedStyle(el);
        return { color: computed.color, background: computed.backgroundColor };
    });

    // Only the fenced block keeps the navy surface; the other consumers of
    // --codeBlockBgColor would otherwise keep the dark editor ink on it.
    expect(await style('.mu-code-block')).toEqual({ color: 'rgb(248, 248, 242)', background: 'rgb(24, 48, 85)' });
    for (const selector of ['.mu-frontmatter', '.mu-html-container', '.mu-math-container', '.mu-diagram-container']) {
        expect(await style(selector), selector).toEqual({
            color: 'rgb(59, 69, 78)',
            background: 'rgb(245, 247, 249)'
        });
    }
    expect(await style('.mu-inline-footnote-identifier')).toEqual({
        color: 'rgb(36, 42, 49)',
        background: 'rgb(245, 247, 249)'
    });
    expect(await style('.mu-inline-footnote-identifier a')).toEqual({
        color: 'rgb(59, 69, 78)',
        background: 'rgba(0, 0, 0, 0)'
    });
});

test('GitBook keeps the dark syntax palette out of the HTML source pane', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the desktop theme cascade in Chromium');
    const themeCss = [
        ...['base.css', 'ui/typora-gitbook.css', 'md/typora-gitbook.css'].map(path =>
            read(`assets/themes/${path}`)
        ),
        read('assets/themes/prismjs/typora-gitbook.theme.css')
    ].join('\n');
    await page.setContent(`<!doctype html><style>${themeCss}</style><div class="editor-wrapper">
<div class="mu-html-container"><pre><code><span class="token punctuation">&lt;</span><span class="token tag">div</span></code></pre></div>
<pre class="mu-code-block"><code class="mu-code"><span class="token punctuation">const</span></code></pre>
<pre class="preview"><code><span class="token punctuation">const</span></code></pre>
</div>`);
    const color = (selector: string) =>
        page.locator(selector).evaluate(el => getComputedStyle(el).color);

    // The light HTML source pane must not receive the dark palette's near-white
    // punctuation; the fenced block and the settings-preview `<pre>` still do.
    expect(await color('.mu-html-container .token.punctuation')).toBe('rgb(59, 69, 78)');
    expect(await color('.mu-html-container .token.tag')).toBe('rgb(59, 69, 78)');
    expect(await color('.mu-code-block .token.punctuation')).toBe('rgb(248, 248, 242)');
    expect(await color('.editor-wrapper > pre.preview .token.punctuation')).toBe('rgb(248, 248, 242)');
});

test('GitBook keeps find matches legible in the navy block', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the desktop theme cascade in Chromium');
    const themeCss = ['base.css', 'ui/typora-gitbook.css', 'md/typora-gitbook.css']
        .map(path => read(`assets/themes/${path}`))
        .join('\n');
    await page.setContent(`<!doctype html><style>${themeCss}</style><div class="editor-wrapper">
<pre class="mu-code-block"><code class="mu-code"><span class="mu-highlight">needle</span><span class="mu-selection">needle</span></code></pre>
</div>`);
    const style = (selector: string) =>
        page.locator(selector).evaluate(el => {
            const computed = getComputedStyle(el);
            return { color: computed.color, background: computed.backgroundColor };
        });

    expect(await style('.mu-highlight')).toEqual({
        color: 'rgb(248, 248, 242)',
        background: 'rgba(56, 132, 255, 0.55)'
    });
    expect(await style('.mu-selection')).toEqual({
        color: 'rgb(248, 248, 242)',
        background: 'rgba(157, 170, 182, 0.35)'
    });
});

test('GitBook deepens the default link on hover and keeps a custom --link-color', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the desktop theme cascade in Chromium');
    const themeCss = ['base.css', 'ui/typora-gitbook.css', 'md/typora-gitbook.css']
        .map(path => read(`assets/themes/${path}`))
        .join('\n');
    await page.setContent(`<!doctype html><style>${themeCss}</style><div class="editor-wrapper"><p><a id="link" href="#">link</a></p></div>`);
    const color = () => page.locator('#link').evaluate(el => getComputedStyle(el).color);

    expect(await color()).toBe('rgb(25, 104, 230)');
    await page.hover('#link');
    expect(await color(), 'the default hover must deepen to the Azure shade').toBe('rgb(0, 48, 124)');

    // The desktop mirrors a user-declared --link-color into the companion name
    // bindCustomProperties() uses; the theme must keep that colour on hover.
    await page.addStyleTag({
        content: '.editor-wrapper { --link-color: #123456; --folira-user-link-color: var(--link-color); }'
    });
    await page.mouse.move(0, 0);
    expect(await color()).toBe('rgb(18, 52, 86)');
    await page.hover('#link');
    expect(await color(), 'a custom --link-color must survive hover').toBe('rgb(18, 52, 86)');
});
