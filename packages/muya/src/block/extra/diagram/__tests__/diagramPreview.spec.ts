// @vitest-environment happy-dom
import type { Muya } from '../../../../muya';
import type { IDiagramMeta, IDiagramState } from '../../../../state/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../../../config';
import I18n from '../../../../i18n';
import { en } from '../../../../locales/en';
import { zhCN } from '../../../../locales/zh-CN';
import DiagramPreview from '../diagramPreview';

// The diagram renderer (`utils/diagram` default export) dynamically imports
// heavy renderer packages (mermaid / vega / flowchart) that don't load under
// happy-dom. We mock it so:
//   - the "valid" path never runs (we only characterize empty + error states),
//   - the "invalid" path can throw a controlled message we assert is sanitized.
const loadRendererMock = vi.fn();
vi.mock('../../../../utils/diagram', () => ({
    default: (...args: unknown[]) => loadRendererMock(...args),
}));

const bootedHosts: HTMLElement[] = [];

afterEach(() => {
    while (bootedHosts.length) bootedHosts.pop()!.remove();
    document.body.querySelectorAll('div[style*="-10000px"]').forEach(node => node.remove());
    loadRendererMock.mockReset();
});

// Build a structurally-typed fake `Muya` carrying only what DiagramPreview
// touches: an `i18n` with `.t(key)` and `options` with the diagram themes.
function makeFakeMuya(locale = en): { muya: Muya; i18n: I18n } {
    const muya = {
        options: {
            mermaidTheme: 'default',
            vegaTheme: 'default',
            sequenceTheme: 'hand',
        },
    } as unknown as Muya;
    const i18n = new I18n(muya, locale);
    (muya as unknown as { i18n: I18n }).i18n = i18n;
    return { muya, i18n };
}

function makeState(text: string, type: IDiagramMeta['type'] = 'mermaid'): IDiagramState {
    return {
        name: 'diagram',
        text,
        meta: { lang: 'yaml', type },
    };
}

// DiagramPreview's constructor fires `update()` unawaited. To get a
// deterministic DOM, construct it, then await our own `update()` call.
function makePreview(text: string, type: IDiagramMeta['type'] = 'mermaid', locale = en) {
    const { muya, i18n } = makeFakeMuya(locale);
    const preview = new DiagramPreview(muya, makeState(text, type));
    bootedHosts.push(preview.domNode!);
    return { preview, muya, i18n };
}

describe('diagramPreview — empty state', () => {
    it('renders the empty-state class + localized "Empty Diagram" for empty code', async () => {
        const { preview } = makePreview('');
        await preview.update('');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain(`class="${CLASS_NAMES.MU_EMPTY}"`);
        expect(CLASS_NAMES.MU_EMPTY).toBe('mu-empty');
        expect(html).toContain('Empty Diagram');
    });

    it('localizes the empty-state label via i18n (zh-CN)', async () => {
        const { preview } = makePreview('', 'mermaid', zhCN);
        await preview.update('');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain(`class="${CLASS_NAMES.MU_EMPTY}"`);
        expect(html).toContain('空图表');
    });
});

describe('diagramPreview — invalid / error state', () => {
    it('renders the error class + localized "Invalid Diagram Code" when the renderer throws', async () => {
        loadRendererMock.mockRejectedValue(new Error('Unknown diagram name mermaid'));
        const { preview } = makePreview('graph TD; A-->B');
        await preview.update('graph TD; A-->B');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain('class="mu-diagram-error"');
        expect(html).toContain('Invalid Diagram Code');
        expect(html).toContain('class="mu-diagram-error-detail"');
        expect(html).toContain('Unknown diagram name mermaid');
    });

    it('sanitizes the error detail (escapes embedded HTML so no raw tag survives)', async () => {
        loadRendererMock.mockRejectedValue(new Error('boom <img src=x onerror=alert(1)>'));
        const { preview } = makePreview('graph TD; A-->B');
        await preview.update('graph TD; A-->B');

        const detail = preview.domNode!.querySelector('.mu-diagram-error-detail')!;
        expect(detail).not.toBeNull();
        expect(detail.querySelector('img')).toBeNull();
        expect(preview.domNode!.querySelector('img')).toBeNull();
        expect(detail.textContent).toContain('boom');
    });

    it('localizes the error label via i18n (zh-CN)', async () => {
        loadRendererMock.mockRejectedValue(new Error('nope'));
        const { preview } = makePreview('graph TD; A-->B', 'mermaid', zhCN);
        await preview.update('graph TD; A-->B');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain('class="mu-diagram-error"');
        expect(html).toContain('图表渲染失败');
    });
});

describe('diagramPreview — clickHandler routing', () => {
    it.each(['svg', 'img'])('opens a successfully rendered %s while reading', async (tag) => {
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    target.innerHTML = `<${tag} width="10" height="10"></${tag}>`;
                },
            }),
        });
        const { preview, muya } = makePreview('', 'flowchart');
        const emit = vi.fn();
        Object.assign(muya, { isReadOnly: true, eventCenter: { emit } });
        await preview.update('st=>start: go');
        preview.domNode!.click();

        expect(emit).toHaveBeenCalledExactlyOnceWith('preview-diagram', {
            type: 'flowchart',
            code: 'st=>start: go',
            preview: preview.domNode,
            label: muya.i18n.t('Diagram'),
        });
    });

    it('does not infer successful rendering from injected DOM', () => {
        const { preview, muya } = makePreview('');
        const emit = vi.fn();
        Object.assign(muya, { isReadOnly: true, eventCenter: { emit } });
        preview.domNode!.innerHTML = '<svg></svg>';
        preview.domNode!.click();
        expect(emit).not.toHaveBeenCalled();
    });

    it('resets preview eligibility during loading and after failure or empty content', async () => {
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    target.innerHTML = '<svg width="10" height="10"></svg>';
                },
            }),
        });
        const { preview, muya } = makePreview('', 'flowchart');
        const emit = vi.fn();
        Object.assign(muya, { isReadOnly: true, eventCenter: { emit } });
        await preview.update('valid');
        preview.domNode!.click();
        expect(emit).toHaveBeenCalledTimes(1);
        emit.mockClear();
        loadRendererMock.mockRejectedValue(new Error('invalid'));
        const pending = preview.update('invalid');
        preview.domNode!.click();
        await pending;
        preview.domNode!.click();
        await preview.update('');
        preview.domNode!.click();
        expect(emit).not.toHaveBeenCalled();
    });

    it('preventDefault + stopPropagation + setCursor(0,0) on the parent first content', () => {
        const { preview } = makePreview('');
        const setCursor = vi.fn();
        const cursorBlock = { setCursor };
        const parent = {
            firstContentInDescendant: vi.fn(() => cursorBlock),
        };
        preview.parent = parent as unknown as DiagramPreview['parent'];

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        preview.clickHandler(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(parent.firstContentInDescendant).toHaveBeenCalledTimes(1);
        expect(setCursor).toHaveBeenCalledWith(0, 0);
    });

    it('still preventDefault/stopPropagation but does not throw when parent is null', () => {
        const { preview } = makePreview('');
        preview.parent = null;

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        expect(() => preview.clickHandler(event)).not.toThrow();
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('does not throw when parent has no content (firstContentInDescendant returns null)', () => {
        const { preview } = makePreview('');
        const parent = {
            firstContentInDescendant: vi.fn(() => null),
        };
        preview.parent = parent as unknown as DiagramPreview['parent'];

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        expect(() => preview.clickHandler(event)).not.toThrow();
        expect(parent.firstContentInDescendant).toHaveBeenCalledTimes(1);
    });
});

// Pins that the diagram-theme options flow from muya.options through
// renderDiagram into the underlying renderer call (not just that the
// default options carry the right value — diagramFlowchartSequence.spec
// only asserts MUYA_DEFAULT_OPTIONS.sequenceTheme === 'hand').
describe('diagramPreview — renderer theme pass-through', () => {
    // The constructor fires update() unawaited, so assert on lastCall — our
    // explicit update() (after mutating the option) is always the latest.
    it('passes sequenceTheme into the sequence renderer drawSVG options (simple)', async () => {
        const drawSVG = vi.fn();
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG }) });

        const { preview, muya } = makePreview('Alice->Bob: Hi', 'sequence');
        muya.options.sequenceTheme = 'simple';
        await preview.update('Alice->Bob: Hi');

        expect(drawSVG).toHaveBeenCalled();
        expect(drawSVG.mock.lastCall![1]).toMatchObject({ theme: 'simple' });
    });

    it('defaults sequenceTheme to the muya option value (hand) when unchanged', async () => {
        const drawSVG = vi.fn();
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG }) });

        const { preview } = makePreview('Alice->Bob: Hi', 'sequence');
        await preview.update('Alice->Bob: Hi');

        expect(drawSVG).toHaveBeenCalled();
        expect(drawSVG.mock.lastCall![1]).toMatchObject({ theme: 'hand' });
    });

    it('passes vegaTheme + ast:true into the vega-lite renderer options', async () => {
        const render = vi.fn();
        loadRendererMock.mockResolvedValue(render);

        const { preview, muya } = makePreview('{}', 'vega-lite');
        muya.options.vegaTheme = 'dark';
        await preview.update('{"mark":"bar"}');

        expect(render).toHaveBeenCalled();
        expect(render.mock.lastCall![2]).toMatchObject({
            theme: 'dark',
            ast: true,
            actions: false,
            tooltip: false,
            renderer: 'svg',
        });
    });
});

describe('diagramPreview — accessible name', () => {
    it('marks a rendered diagram as an image named by its <title>', async () => {
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    target.innerHTML = '<svg width="10" height="10"><title>Order flow</title></svg>';
                },
            }),
        });

        const { preview } = makePreview('st=>start: go', 'flowchart');
        await preview.update('st=>start: go');

        expect(preview.domNode!.getAttribute('role')).toBe('img');
        expect(preview.domNode!.getAttribute('aria-label')).toBe('Order flow');
    });

    it('falls back to the localized diagram label', async () => {
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    target.innerHTML = '<svg width="10" height="10"></svg>';
                },
            }),
        });

        const { preview, i18n } = makePreview('st=>start: go', 'flowchart', zhCN);
        await preview.update('st=>start: go');

        expect(preview.domNode!.getAttribute('aria-label')).toBe(i18n.t('Diagram'));
        expect(i18n.t('Diagram')).not.toBe('Diagram');
    });

    it('leaves the error state readable instead of hiding it behind role="img"', async () => {
        loadRendererMock.mockRejectedValue(new Error('boom'));

        const { preview } = makePreview('graph TD', 'mermaid');
        await preview.update('graph TD');

        expect(preview.domNode!.getAttribute('role')).toBeNull();
        expect(preview.domNode!.getAttribute('aria-label')).toBeNull();
    });

    it('leaves the empty state readable', async () => {
        const { preview } = makePreview('', 'mermaid');
        await preview.update('');

        expect(preview.domNode!.getAttribute('role')).toBeNull();
        expect(preview.domNode!.getAttribute('aria-label')).toBeNull();
    });

    it('drops a stale name when a working diagram is edited into a broken one', async () => {
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    target.innerHTML = '<svg width="10" height="10"><title>Order flow</title></svg>';
                },
            }),
        });

        const { preview } = makePreview('st=>start: go', 'flowchart');
        await preview.update('st=>start: go');
        expect(preview.domNode!.getAttribute('aria-label')).toBe('Order flow');

        loadRendererMock.mockRejectedValue(new Error('boom'));
        await preview.update('nonsense');

        expect(preview.domNode!.getAttribute('role')).toBeNull();
        expect(preview.domNode!.getAttribute('aria-label')).toBeNull();
    });
});

// Start empty so the constructor cannot create an unobserved render request.
// Renderer loading is controlled explicitly; no real Mermaid or animation frame.
// An update that finishes after a newer one started must not touch the preview.
describe('diagramPreview — overlapping updates', () => {
    function renderer(title: string) {
        return {
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    target.innerHTML = `<svg width="10" height="10"><title>${title}</title></svg>`;
                },
            }),
        };
    }

    it('keeps the newest diagram when an older renderer finishes last', async () => {
        let release!: (value: ReturnType<typeof renderer>) => void;
        const oldRenderer = new Promise<ReturnType<typeof renderer>>((resolve) => {
            release = resolve;
        });
        loadRendererMock.mockReturnValueOnce(oldRenderer).mockResolvedValue(renderer('New'));
        const { preview } = makePreview('', 'flowchart');

        const oldUpdate = preview.update('old');
        await preview.update('new');
        expect(preview.domNode!.querySelector('title')?.textContent).toBe('New');
        release(renderer('Old'));
        await oldUpdate;

        expect(preview.domNode!.querySelector('title')?.textContent).toBe('New');
        expect(preview.domNode!.getAttribute('aria-label')).toBe('New');
    });

    it('ignores an old failure after a newer render succeeds', async () => {
        let reject!: (error: Error) => void;
        const oldRenderer = new Promise<never>((_resolve, rejectPromise) => {
            reject = rejectPromise;
        });
        loadRendererMock.mockReturnValueOnce(oldRenderer).mockResolvedValue(renderer('New'));
        const { preview } = makePreview('', 'flowchart');

        const oldUpdate = preview.update('old');
        await preview.update('new');
        reject(new Error('old request failed'));
        await oldUpdate;

        expect(preview.domNode!.querySelector('.mu-diagram-error')).toBeNull();
        expect(preview.domNode!.querySelector('title')?.textContent).toBe('New');
    });

    it('keeps empty content empty when an earlier render completes', async () => {
        let release!: (value: ReturnType<typeof renderer>) => void;
        const oldRenderer = new Promise<ReturnType<typeof renderer>>((resolve) => {
            release = resolve;
        });
        loadRendererMock.mockReturnValueOnce(oldRenderer);
        const { preview, muya } = makePreview('', 'flowchart');
        const emit = vi.fn();
        Object.assign(muya, { isReadOnly: true, eventCenter: { emit } });

        const oldUpdate = preview.update('old');
        await preview.update('');
        release(renderer('Old'));
        await oldUpdate;
        preview.domNode!.click();

        expect(preview.domNode!.querySelector(`.${CLASS_NAMES.MU_EMPTY}`)).not.toBeNull();
        expect(preview.domNode!.querySelector('svg')).toBeNull();
        expect(emit).not.toHaveBeenCalled();
    });
});

// Raphael measures text once the fonts are ready, so `drawSVG` can return before
// the `<svg>` exists. Publishing the staging node straight away moved an empty
// container away and left the drawing in a node nothing rendered.
describe('diagramPreview — drawing deferred by font loading', () => {
    it('publishes the svg once it appears after drawSVG returned', async () => {
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    setTimeout(() => {
                        target.innerHTML = '<svg width="10" height="10"><title>Late</title></svg>';
                    }, 0);
                },
            }),
        });

        const { preview } = makePreview('st=>start: go', 'flowchart');
        await preview.update('st=>start: go');

        expect(preview.domNode!.querySelector('svg')).toBeNull();

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(preview.domNode!.querySelector('title')?.textContent).toBe('Late');
        expect(preview.domNode!.getAttribute('aria-label')).toBe('Late');
    });

    it('drops the late drawing when a newer update has taken over', async () => {
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    setTimeout(() => {
                        target.innerHTML = '<svg width="10" height="10"><title>Old</title></svg>';
                    }, 0);
                },
            }),
        });

        const { preview } = makePreview('', 'flowchart');
        await preview.update('old');
        await preview.update('');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(preview.domNode!.querySelector('svg')).toBeNull();
        expect(preview.domNode!.querySelector(`.${CLASS_NAMES.MU_EMPTY}`)).not.toBeNull();
    });

    it('takes the offscreen node away when a newer update supersedes the wait', async () => {
        // A renderer that never draws keeps the staging node alive until the next
        // edit; the wait must remove it, or every keystroke leaves one behind.
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG: () => {} }) });

        const { preview } = makePreview('st=>start: go', 'flowchart');
        await preview.update('st=>start: go');

        const waiting = document.body.querySelectorAll('div[style*="-10000px"]');
        expect(waiting).toHaveLength(1);

        await preview.update('');

        expect(waiting[0].isConnected).toBe(false);
        expect(document.body.querySelectorAll('div[style*="-10000px"]')).toHaveLength(0);
    });

    it('shows a readable error at the deadline instead of loading forever', async () => {
        vi.useFakeTimers();
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG: () => {} }) });

        const { preview, i18n } = makePreview('st=>start: go', 'flowchart');
        await preview.update('st=>start: go');
        expect(preview.domNode!.textContent).toBe(i18n.t('Loading...'));

        await vi.advanceTimersByTimeAsync(5000);

        expect(preview.domNode!.querySelector('.mu-diagram-error')).not.toBeNull();
        expect(preview.domNode!.textContent).toContain(i18n.t('Diagram Timed Out'));
        expect(document.body.querySelectorAll('div[style*="-10000px"]')).toHaveLength(0);
        vi.useRealTimers();
    });
});

// These regressions intentionally assert the required behavior with ordinary it().
// Fake time crosses the actual 2s cleanup and 3s font fallback boundaries.
describe('diagramPreview — slow fonts and staging cancellation regressions', () => {
    let targets: HTMLElement[];
    let previews: DiagramPreview[];

    beforeEach(() => {
        vi.useFakeTimers();
        targets = [];
        previews = [];
        loadRendererMock.mockResolvedValue({
            parse: () => ({
                drawSVG: (target: HTMLElement) => {
                    targets.push(target);
                },
            }),
        });
    });

    afterEach(async () => {
        // Cancel through the public update path, even after an assertion failed.
        for (const preview of previews)
            await preview.update('');
        // A failed leak assertion must not leave an observer or staging node behind.
        for (const target of targets)
            target.remove();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    function waitingPreview() {
        const result = makePreview('', 'flowchart');
        previews.push(result.preview);
        return result;
    }

    function draw(target: HTMLElement, title: string) {
        target.innerHTML = `<svg width="10" height="10"><title>${title}</title></svg>`;
    }

    it('publishes a delayed drawing before cleanup (control)', async () => {
        const { preview } = waitingPreview();
        await preview.update('first');
        expect(targets).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1500);
        draw(targets[0], 'Within deadline');
        await vi.advanceTimersByTimeAsync(0);
        expect(preview.domNode!.querySelector('title')?.textContent).toBe('Within deadline');
        expect(targets[0].isConnected).toBe(false);
    });

    it('a drawing after the 3s font fallback cannot leave the preview permanently loading', async () => {
        const { preview, i18n } = waitingPreview();
        await preview.update('slow font');
        await vi.advanceTimersByTimeAsync(3100);
        draw(targets[0], 'Font fallback finished');
        await vi.advanceTimersByTimeAsync(0);
        // Either publish the late SVG, or expose a recoverable render error.
        // Removing the target while leaving Loading... forever is never valid.
        expect(preview.domNode!.querySelector('svg, .mu-diagram-error')).not.toBeNull();
        expect(preview.domNode!.textContent).not.toBe(i18n.t('Loading...'));
    });

    it('a renderer that never draws eventually leaves a readable error instead of Loading', async () => {
        const { preview, i18n } = waitingPreview();
        await preview.update('never drawn');
        await vi.advanceTimersByTimeAsync(10000);
        expect(preview.domNode!.querySelector('.mu-diagram-error')).not.toBeNull();
        expect(preview.domNode!.textContent).not.toBe(i18n.t('Loading...'));
    });

    it.each(['empty', 'replacement'])('cancelling for %s detaches the old staging node immediately', async (next) => {
        const { preview } = waitingPreview();
        await preview.update('old');
        const old = targets[0];
        expect(old.isConnected).toBe(true);
        await preview.update(next === 'empty' ? '' : 'new');
        expect(old.isConnected).toBe(false);
        if (next === 'replacement') {
            draw(targets[1], 'New');
            await vi.advanceTimersByTimeAsync(0);
            expect(preview.domNode!.querySelector('title')?.textContent).toBe('New');
        }
    });

    it('a cancelled late font callback cannot leave an offscreen SVG attached to body', async () => {
        const { preview } = waitingPreview();
        await preview.update('old');
        const old = targets[0];
        await preview.update('');
        draw(old, 'Cancelled drawing');
        await vi.advanceTimersByTimeAsync(10000);
        expect(document.body.contains(old)).toBe(false);
        expect(preview.domNode!.querySelector(`.${CLASS_NAMES.MU_EMPTY}`)).not.toBeNull();
        expect(preview.domNode!.querySelector('svg')).toBeNull();
    });

    it('repeated edits followed by clearing leave no staging nodes or timers', async () => {
        const { preview } = waitingPreview();
        for (const code of ['one', 'two', 'three'])
            await preview.update(code);
        await preview.update('');
        expect(targets).toHaveLength(3);
        expect(targets.filter(target => target.isConnected)).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('diagramPreview — a render that never settles', () => {
    it('shows the deadline error and removes the offscreen node', async () => {
        vi.useFakeTimers();
        // mermaid is the path that awaits the renderer, so a promise that never
        // resolves is the shape a hung renderer has here.
        loadRendererMock.mockResolvedValue({
            parse: () => ({}),
            initialize: () => {},
            render: () => new Promise(() => {}),
        });

        const { preview, i18n } = makePreview('graph TD; A-->B', 'mermaid');
        void preview.update('graph TD; A-->B');
        for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();

        expect(preview.domNode!.textContent).toBe(i18n.t('Loading...'));

        // The deadline has been running since the staging node was created, so a
        // render that never settles still ends in a readable error.
        await vi.advanceTimersByTimeAsync(5000);

        expect(preview.domNode!.textContent).toContain(i18n.t('Diagram Timed Out'));
        expect(document.body.querySelectorAll('div[style*="-10000px"]')).toHaveLength(0);
        vi.useRealTimers();
    });
});
