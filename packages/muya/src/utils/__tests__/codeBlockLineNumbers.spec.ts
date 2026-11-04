// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { CLASS_NAMES } from '../../config';
import {
    cancelLineNumberReposition,
    computeLineCount,
    LINE_NUMBERS_ROWS_CLASS,
    lineNumbersWrapperHTML,
    repositionLineNumberSpans,
    scheduleLineNumberReposition,
    syncLineNumbersSpans,
} from '../codeBlockLineNumbers';

describe('computeLineCount', () => {
    it('counts 1 for empty string', () => {
        expect(computeLineCount('')).toBe(1);
    });

    it('counts 1 for a single line without trailing newline', () => {
        expect(computeLineCount('hello')).toBe(1);
    });

    it('counts N for N-1 inner newlines', () => {
        expect(computeLineCount('a\nb')).toBe(2);
        expect(computeLineCount('a\nb\nc')).toBe(3);
        expect(computeLineCount('a\nb\nc\nd')).toBe(4);
    });

    it('adds one extra visible row for a trailing newline', () => {
        expect(computeLineCount('a\n')).toBe(2);
        expect(computeLineCount('a\nb\n')).toBe(3);
    });

    it('treats a lone newline as two visible rows', () => {
        expect(computeLineCount('\n')).toBe(2);
    });

    it('does not collapse consecutive blank lines', () => {
        expect(computeLineCount('a\n\nb')).toBe(3);
        expect(computeLineCount('a\n\n\nb')).toBe(4);
    });
});

describe('lineNumbersWrapperHTML', () => {
    it('emits an empty wrapper (rows are filled lazily by syncLineNumbersSpans)', () => {
        const html = lineNumbersWrapperHTML();
        expect(html).toContain(`class="${LINE_NUMBERS_ROWS_CLASS}"`);
        expect(html).toContain('contenteditable="false"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).not.toContain('<span></span>');
    });

    it('uses the public class name constant', () => {
        expect(LINE_NUMBERS_ROWS_CLASS).toBe('mu-line-numbers-rows');
    });
});

describe('syncLineNumbersSpans', () => {
    let wrapper: HTMLElement;

    beforeEach(() => {
        wrapper = document.createElement('span');
    });

    it('appends N spans when starting from empty', () => {
        syncLineNumbersSpans(wrapper, 3);
        expect(wrapper.childElementCount).toBe(3);
        expect(wrapper.querySelectorAll('span').length).toBe(3);
    });

    it('is a no-op when the count already matches', () => {
        syncLineNumbersSpans(wrapper, 5);
        const before = wrapper.innerHTML;
        syncLineNumbersSpans(wrapper, 5);
        expect(wrapper.innerHTML).toBe(before);
        expect(wrapper.childElementCount).toBe(5);
    });

    it('adds only the delta when growing (does not rebuild)', () => {
        syncLineNumbersSpans(wrapper, 3);
        const firstSpan = wrapper.firstElementChild;
        syncLineNumbersSpans(wrapper, 5);
        expect(wrapper.childElementCount).toBe(5);
        expect(wrapper.firstElementChild).toBe(firstSpan);
    });

    it('removes from the tail when shrinking', () => {
        syncLineNumbersSpans(wrapper, 5);
        const firstSpan = wrapper.firstElementChild;
        syncLineNumbersSpans(wrapper, 2);
        expect(wrapper.childElementCount).toBe(2);
        expect(wrapper.firstElementChild).toBe(firstSpan);
    });

    it('handles count 0 by removing all children', () => {
        syncLineNumbersSpans(wrapper, 4);
        syncLineNumbersSpans(wrapper, 0);
        expect(wrapper.childElementCount).toBe(0);
    });
});

describe('repositionLineNumberSpans', () => {
    it('keeps the only line of an empty code block flush with the top', () => {
        const wrapper = document.createElement('span');
        syncLineNumbersSpans(wrapper, 1);
        const codeEl = document.createElement('code');

        repositionLineNumberSpans(wrapper, codeEl);

        expect((wrapper.children[0] as HTMLElement).style.top).toBe('0px');
    });

    it('anchors line numbers to the first line so the line-box leading cancels', () => {
        const wrapper = document.createElement('span');
        syncLineNumbersSpans(wrapper, 3);
        const codeEl = document.createElement('code');
        codeEl.appendChild(document.createTextNode('a\nb\nc'));

        // happy-dom performs no layout. Emulate three stacked lines whose
        // measured tops carry a constant line-box leading offset (110, 140,
        // 170). The gutter must use the first line as its origin — not the
        // wrapper rect — so that leading cancels and line 1 sits at 0px.
        const tops = [110, 140, 170];
        let call = 0;
        const rangeProto = Range.prototype as unknown as {
            getBoundingClientRect: () => { top: number };
        };
        const origRangeRect = rangeProto.getBoundingClientRect;
        rangeProto.getBoundingClientRect = () => ({ top: tops[call++] });
        // The wrapper's own rect must no longer influence the result.
        (wrapper as unknown as { getBoundingClientRect: () => { top: number } })
            .getBoundingClientRect = () => ({ top: 999 });

        try {
            repositionLineNumberSpans(wrapper, codeEl);
        }
        finally {
            rangeProto.getBoundingClientRect = origRangeRect;
        }

        expect((wrapper.children[0] as HTMLElement).style.top).toBe('0px');
        expect((wrapper.children[1] as HTMLElement).style.top).toBe('30px');
        expect((wrapper.children[2] as HTMLElement).style.top).toBe('60px');
    });

    it('measures the trailing break instead of stacking a line height', () => {
        // With wrap on, the last logical line spans several visual rows, so
        // `previous top + line height` lands inside it. CodeBlockContent puts a
        // break element on the line after a final newline; its box is the
        // number the row needs.
        const wrapper = document.createElement('span');
        syncLineNumbersSpans(wrapper, 3);
        const codeEl = document.createElement('code');
        codeEl.appendChild(document.createTextNode('a\nb\n'));
        const trailing = document.createElement('span');
        trailing.className = CLASS_NAMES.MU_TRAILING_BREAK;
        trailing.appendChild(document.createElement('br'));
        codeEl.appendChild(trailing);

        const tops = [100, 140];
        let call = 0;
        const rangeProto = Range.prototype as unknown as {
            getBoundingClientRect: () => { top: number };
        };
        const origRangeRect = rangeProto.getBoundingClientRect;
        rangeProto.getBoundingClientRect = () => ({ top: tops[call++] });
        (trailing as unknown as { getBoundingClientRect: () => { top: number } })
            .getBoundingClientRect = () => ({ top: 180 });

        try {
            repositionLineNumberSpans(wrapper, codeEl);
        }
        finally {
            rangeProto.getBoundingClientRect = origRangeRect;
        }

        expect((wrapper.children[2] as HTMLElement).style.top).toBe('80px');
    });
});

describe('scheduleLineNumberReposition', () => {
    /** Watches reads and writes across several blocks at once. */
    function watchOrder(wrappers: HTMLElement[]): { order: string[]; restore: () => void } {
        const order: string[] = [];
        const rangeProto = Range.prototype as unknown as {
            getBoundingClientRect: () => { top: number };
        };
        const origRangeRect = rangeProto.getBoundingClientRect;
        rangeProto.getBoundingClientRect = () => {
            order.push('read');
            return { top: 0 };
        };
        const spans: HTMLElement[] = [];
        for (const wrapper of wrappers) {
            for (const span of Array.from(wrapper.children) as HTMLElement[]) {
                // happy-dom 21 keeps style behind a proxy that rejects
                // defineProperty, so the accessor goes on the element: a
                // shadowing style getter that logs writes and forwards
                // everything else to the real declaration.
                const real = span.style;
                const watched = new Proxy(real, {
                    get: (target, prop) => Reflect.get(target, prop, target),
                    set: (target, prop, value) => {
                        if (prop === 'top')
                            order.push('write');
                        return Reflect.set(target, prop, value, target);
                    },
                });
                Object.defineProperty(span, 'style', { configurable: true, get: () => watched });
                spans.push(span);
            }
        }

        const restore = () => {
            rangeProto.getBoundingClientRect = origRangeRect;
            for (const span of spans)
                Reflect.deleteProperty(span, 'style');
        };

        return { order, restore };
    }

    function makeBlock(): { wrapper: HTMLElement; codeEl: HTMLElement } {
        const wrapper = document.createElement('span');
        syncLineNumbersSpans(wrapper, 3);
        const codeEl = document.createElement('code');
        codeEl.appendChild(document.createTextNode('a\nb\nc'));

        return { wrapper, codeEl };
    }

    it('measures every queued block before positioning any of them', async () => {
        // Separating the two passes within one block leaves one forced layout
        // per block, and opening a document resizes every code block at once —
        // still quadratic, and measurably so: 16.6 ms/KB at 220 blocks against
        // 23.6 at 880. Batching the whole set into one frame flattened it.
        //
        // As with the single-block case, interleaving the blocks again would
        // produce identical output. Only the call order shows it.
        const blocks = [makeBlock(), makeBlock(), makeBlock()];
        const { order, restore } = watchOrder(blocks.map(b => b.wrapper));

        try {
            for (const { wrapper, codeEl } of blocks)
                scheduleLineNumberReposition(wrapper, codeEl);

            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        finally {
            restore();
        }

        expect(order).toContain('read');
        expect(order).toContain('write');
        expect(order.indexOf('write'), 'a block was positioned before another was measured')
            .toBeGreaterThan(order.lastIndexOf('read'));
    });

    it('does not position a block that was cancelled before the frame ran', async () => {
        const kept = makeBlock();
        const dropped = makeBlock();

        scheduleLineNumberReposition(kept.wrapper, kept.codeEl);
        scheduleLineNumberReposition(dropped.wrapper, dropped.codeEl);
        cancelLineNumberReposition(dropped.wrapper);

        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

        expect((kept.wrapper.children[0] as HTMLElement).style.top).toBe('0px');
        expect((dropped.wrapper.children[0] as HTMLElement).style.top).toBe('');
    });
});
