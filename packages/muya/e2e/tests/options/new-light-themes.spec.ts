import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const renderer = new URL('../../../../desktop/src/renderer/src/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, renderer), 'utf8');
const muya = new URL('../../../src/', import.meta.url);
const readMuya = (path: string) => readFileSync(new URL(path, muya), 'utf8');

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
        .side-bar .left-column svg { color: var(--iconColor); }
        .side-bar input.rename { color: var(--sideBarColor); background: var(--inputBgColor); }
    </style>
    <div class="title-bar" id="titlebar">theme-sample.md</div>
    <div class="side-bar" id="sidebar">
        <div class="left-column"><svg id="sidebar-icon" width="16" height="16"></svg></div>
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
            iconColor: style('#sidebar-icon').color,
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
    expect(result.iconColor).toBe('rgb(195, 200, 203)');
    expect(result.titleBarColor).toBe('#5c5f62');
    expect(result.titleBarTheme).toBe('#be2f34');
    expect(result.renameBackground).toBe('rgba(255, 255, 255, 0.08)');
    expect(result.renameColor).toBe('rgb(215, 217, 218)');
});

test('iA Writer Light centers only h1 and uses logical start for lower headings', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
    await page.setContent(`<!doctype html><style>${cssFor('ia-writer-light')}</style>
        <div class="editor-wrapper" dir="ltr"><h1>Chapter</h1><h2>Section</h2><h3>Subsection</h3></div>
        <div class="editor-wrapper" dir="rtl"><h1>الفصل</h1><h2 id="rtl-h2">القسم</h2><h3>القسم الفرعي</h3></div>`);
    const result = await page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        const ltr = document.querySelector('.editor-wrapper[dir="ltr"]')!;
        const rtl = document.querySelector('.editor-wrapper[dir="rtl"]')!;
        const ltrStyle = (selector: string) => getComputedStyle(ltr.querySelector(selector)!);
        const rtlStyle = (selector: string) => getComputedStyle(rtl.querySelector(selector)!);
        const rtlH2 = rtl.querySelector('#rtl-h2')!;
        const range = document.createRange();
        range.selectNodeContents(rtlH2);
        const text = range.getBoundingClientRect();
        const box = rtlH2.getBoundingClientRect();
        return {
            ltrH1: ltrStyle('h1').textAlign,
            ltrH2: ltrStyle('h2').textAlign,
            ltrH3: ltrStyle('h3').textAlign,
            rtlH1: rtlStyle('h1').textAlign,
            rtlH2: rtlStyle('h2').textAlign,
            rtlH3: rtlStyle('h3').textAlign,
            rtlDirection: style('.editor-wrapper[dir="rtl"] h2').direction,
            rtlTextStartsOnRight: text.left > box.left + box.width / 2,
        };
    });
    expect(result).toEqual({
        ltrH1: 'center',
        ltrH2: 'start',
        ltrH3: 'start',
        rtlH1: 'center',
        rtlH2: 'start',
        rtlH3: 'start',
        rtlDirection: 'rtl',
        rtlTextStartsOnRight: true,
    });
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

const CODE_SEARCH_HIGHLIGHTS = {
    'ia-writer-light': 'rgb(201, 201, 201)',
    'paper-sepia': 'rgba(157, 67, 16, 0.28)',
} as const;

for (const theme of ['ia-writer-light', 'paper-sepia']) {
    test(`${theme} makes the active find match visible inside a code block`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
        await page.setContent(`<!doctype html><style>${cssFor(theme)}
            .mu-code-block { background: var(--codeBlockBgColor); }
            .mu-highlight { background: var(--highlightColor); }
            .mu-selection { background: var(--selectionColor); }
        </style>
        <div class="editor-wrapper"><pre class="mu-code-block"><code class="mu-code">
            <span class="mu-highlight">needle</span><span class="mu-selection">needle</span>
        </code></pre></div>`);
        const colors = await page.evaluate(() => {
            const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
            return {
                block: style('.mu-code-block').backgroundColor,
                active: style('.mu-highlight').backgroundColor,
                other: style('.mu-selection').backgroundColor,
            };
        });
        expect(colors.active).toBe(CODE_SEARCH_HIGHLIGHTS[theme]);
        expect(colors.active).not.toBe(colors.block);
        expect(colors.active).not.toBe(colors.other);
    });
}

for (const theme of ['bear', 'ia-writer-light', 'paper-sepia']) {
    test(`${theme} keeps list indentation on the inline-start edge in RTL`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
        await page.setContent(`<!doctype html><style>${readMuya('assets/styles/blockSyntax.css')}${cssFor(theme)}</style>
            <div class="editor-wrapper" dir="ltr"><ul class="mu-bullet-list"><li>one</li></ul></div>
            <div class="editor-wrapper" dir="rtl"><ul class="mu-bullet-list"><li>one</li></ul></div>`);
        const padding = await page.evaluate(() => {
            const style = (selector: string) => {
                const computed = getComputedStyle(document.querySelector(selector)!);
                return { left: computed.paddingLeft, right: computed.paddingRight };
            };
            return {
                ltr: style('.editor-wrapper[dir="ltr"] .mu-bullet-list'),
                rtl: style('.editor-wrapper[dir="rtl"] .mu-bullet-list'),
            };
        });
        expect(padding.ltr).toEqual({ left: '32px', right: '0px' });
        expect(padding.rtl).toEqual({ left: '0px', right: '32px' });
    });
}

for (const theme of ['bear', 'ia-writer-light', 'paper-sepia']) {
    test(`${theme} honors a paragraph-scoped custom --linkColor at rest and on hover`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
        await page.setContent(`<!doctype html><style>${cssFor(theme)}</style>
            <div class="editor-wrapper"><p class="local"><a id="local-link" href="#">local</a></p></div>`);
        // This is the companion declaration bindCustomProperties() adds when a
        // user sheet declares --linkColor on the paragraph.
        await page.addStyleTag({
            content: '.editor-wrapper .local { --linkColor: #007500; --folira-user-linkColor: var(--linkColor); }'
        });
        const color = () => page.locator('#local-link').evaluate(el => getComputedStyle(el).color);

        await page.mouse.move(0, 0);
        expect(await color(), 'a local --linkColor must apply before hover too').toBe('rgb(0, 117, 0)');
        await page.hover('#local-link');
        expect(await color(), 'a local --linkColor must still apply on hover').toBe('rgb(0, 117, 0)');
    });
}

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

const LINK_DEFAULTS = {
    bear: { normal: 'rgb(190, 47, 52)', hover: 'rgb(158, 37, 42)' },
    'ia-writer-light': { normal: 'rgb(26, 26, 26)', hover: 'rgb(0, 0, 0)' },
    'paper-sepia': { normal: 'rgb(157, 67, 16)', hover: 'rgb(127, 52, 9)' },
} as const;

for (const theme of ['bear', 'ia-writer-light', 'paper-sepia']) {
    test(`${theme} keeps both custom link spellings through a real hover`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Checks the theme cascade in Chromium');
        await page.setContent(`<!doctype html><style>${cssFor(theme)}</style>
            <div class="editor-wrapper"><p><a id="link" href="#">link</a></p></div>`);
        const color = () => page.locator('#link').evaluate(el => getComputedStyle(el).color);
        const defaults = LINK_DEFAULTS[theme];

        await page.mouse.move(0, 0);
        expect(await color()).toBe(defaults.normal);
        await page.hover('#link');
        expect(await color()).toBe(defaults.hover);

        // bindCustomProperties() mirrors a user's camel-case --linkColor into
        // --folira-user-linkColor; the hover rule has to read that mirror.
        const camel = await page.addStyleTag({
            content: ':root { --linkColor: #007500; --folira-user-linkColor: var(--linkColor); }'
        });
        await page.mouse.move(0, 0);
        expect(await color()).toBe('rgb(0, 117, 0)');
        await page.hover('#link');
        expect(await color(), 'custom --linkColor must survive hover').toBe('rgb(0, 117, 0)');
        await camel.evaluate(el => el.remove());

        // The kebab alias gets its own mirror; it still has to win over the
        // theme's default hover colour.
        await page.addStyleTag({
            content: ':root { --link-color: #007500; --folira-user-link-color: var(--link-color); }'
        });
        await page.mouse.move(0, 0);
        expect(await color()).toBe('rgb(0, 117, 0)');
        await page.hover('#link');
        expect(await color(), 'custom --link-color must survive hover').toBe('rgb(0, 117, 0)');
    });
}
