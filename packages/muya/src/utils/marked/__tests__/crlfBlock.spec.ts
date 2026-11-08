import { describe, expect, it } from 'vitest';

import { MarkdownToState } from '../../../state/markdownToState';
import { lexBlock } from '../lexBlock';

// The desktop command normalises CRLF before the engine sees it, but the
// engine's own entry points (`new Muya`, `setContent`) accept raw Markdown.
// Marked's block lexer only recognises LF as a newline, which used to turn a
// GFM table into one paragraph of pipe text.
const TABLE = '| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n';

describe('crlf block lexing', () => {
    it('lexes a GFM table when the source uses CRLF line endings', () => {
        const tokens = lexBlock(TABLE);

        expect(tokens.some(token => token.type === 'table')).toBe(true);
    });

    it('builds the table state through MarkdownToState from CRLF input', () => {
        const states = new MarkdownToState().generate(TABLE);

        expect(states.some(state => state.name === 'table')).toBe(true);
    });

    it('keeps LF input working', () => {
        const tokens = lexBlock(TABLE.replace(/\r\n/g, '\n'));

        expect(tokens.some(token => token.type === 'table')).toBe(true);
    });
});
