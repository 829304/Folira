import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const renderer = new URL('../../../../desktop/src/renderer/src/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, renderer), 'utf8');

const manifest = JSON.parse(read('assets/themes/manifest.json')) as Array<{ id: string; prism: string }>;
const prismFor = (id: string): string => {
    const prism = manifest.find(theme => theme.id === id)?.prism;
    if (!prism)
        throw new Error(`The manifest has no prism for ${id}`);
    return read(`assets/themes/prismjs/${prism}.theme.css`);
};

const cssFor = (theme: string): string => [
    read('assets/themes/base.css'),
    read(`assets/themes/ui/${theme}.css`),
    read(`assets/themes/md/${theme}.css`),
    prismFor(theme),
].join('\n');

const contrast = (foreground: string, background: string): number => {
    const parse = (value: string): number[] => {
        const hex = /^#([0-9a-f]{6})$/i.exec(value);
        if (hex) {
            return [0, 2, 4].map(index => Number.parseInt(hex[1].slice(index, index + 2), 16) / 255);
        }
        const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
        if (!rgb)
            throw new Error(`cannot parse ${value}`);
        return rgb.slice(1, 4).map(channel => Number(channel) / 255);
    };
    const luminance = (value: string): number => {
        const channels = parse(value).map(channel =>
            channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        );
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test('Bear keeps the graphite sidebar scoped away from the light title bar', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
    await page.setContent(`<!doctype html><style>${cssFor('bear')}
        .title-bar { background: var(--editorBgColor); }
        .side-bar { background: var(--sideBarBgColor); color: var(--sideBarColor); }
        .side-bar input.rename { color: var(--sideBarColor); background: var(--inputBgColor); }
    </style>
    <div class="title-bar" id="titlebar">theme-sample.md</div>
    <div class="side-bar" id="sidebar">
        <div class="side-bar-file current"><span>current.md</span></div>
        <input class="rename" value="rename.md">
    </div>`);

    const result = await page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        const side = style('#sidebar');
        const title = style('#titlebar');
        const rename = style('.rename');
        return {
            sideBackground: side.backgroundColor,
            sideColor: side.color,
            sideTheme: side.getPropertyValue('--themeColor').trim(),
            sideHighlight: side.getPropertyValue('--highlightThemeColor').trim(),
            titleBarColor: title.getPropertyValue('--sideBarColor').trim(),
            titleBarTheme: title.getPropertyValue('--themeColor').trim(),
            renameBackground: rename.backgroundColor,
            renameColor: rename.color,
        };
    });

    expect(result.sideBackground).toBe('rgb(46, 50, 53)');
    expect(result.sideColor).toBe('rgb(215, 217, 218)');
    expect(result.sideTheme).toBe('#ff9a9e');
    expect(result.sideHighlight).toBe('#ff9a9e');
    expect(result.titleBarColor).toBe('#5c5f62');
    expect(result.titleBarTheme).toBe('#be2f34');
    expect(result.renameBackground).toBe('rgba(255, 255, 255, 0.08)');
    expect(result.renameColor).toBe('rgb(215, 217, 218)');
});

test('iA Writer Light centers only the first heading', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
    await page.setContent(`<!doctype html><style>${cssFor('ia-writer-light')}</style>
        <div class="editor-wrapper"><h1>Chapter</h1><h2>Section</h2><h3>Subsection</h3></div>`);
    const aligns = await page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return {
            h1: style('h1').textAlign,
            h2: style('h2').textAlign,
            h3: style('h3').textAlign,
        };
    });
    expect(aligns).toEqual({ h1: 'center', h2: 'left', h3: 'left' });
});

test('Paper / Sepia keeps the code palette above 4.5:1 on the Flexoki panel', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
    await page.setContent(`<!doctype html><style>${cssFor('paper-sepia')}</style>
        <div class="editor-wrapper"><pre class="mu-code-block"><code class="mu-code">
          <span class="token keyword">const</span> <span class="token comment">// note</span>
          <span class="token string">'value'</span>
        </code></pre></div>`);
    const colors = await page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return {
            body: style('.editor-wrapper').backgroundColor,
            block: style('.mu-code-block').backgroundColor,
            keyword: style('.token.keyword').color,
            comment: style('.token.comment').color,
            string: style('.token.string').color,
        };
    });
    expect(colors.body).toBe('rgb(242, 240, 229)');
    expect(colors.block).toBe('rgb(230, 228, 217)');
    expect(contrast(colors.keyword, colors.block)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.comment, colors.block)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.string, colors.block)).toBeGreaterThanOrEqual(4.5);
});

for (const theme of ['bear', 'ia-writer-light', 'paper-sepia']) {
    test(`${theme} lets custom CSS recolour the inline pill and keyword`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
        await page.setContent(`<!doctype html><style>${cssFor(theme)}</style>
            <div class="editor-wrapper">
                <p><code>inline</code></p>
                <pre class="mu-code-block"><code class="mu-code"><span class="token keyword">const</span></code></pre>
            </div>
            <style>
                .editor-wrapper { --codeBgColor: #123456; }
                .editor-wrapper .token.keyword { color: #7c3aed; }
            </style>`);
        const result = await page.evaluate(() => {
            const code = getComputedStyle(document.querySelector('.editor-wrapper p code')!);
            const keyword = getComputedStyle(document.querySelector('.token.keyword')!);
            return {
                codeBackground: code.backgroundColor,
                keywordColor: keyword.color,
            };
        });
        expect(result.codeBackground).toBe('rgb(18, 52, 86)');
        expect(result.keywordColor).toBe('rgb(124, 58, 237)');
    });
}
