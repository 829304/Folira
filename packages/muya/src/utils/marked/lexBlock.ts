import type { Token } from 'marked';
import type { IFrontmatterToken, ILexOption, TLexedToken } from './types';
import { Marked } from 'marked';
import compatibleTaskList from './compatibleTaskList';
import fancyListsExtension, { endListItemsAtFancyMarkers } from './extensions/fancyLists';
import footnoteExtension from './extensions/footnote';
import githubAlertsExtension, { normalizeGithubAlertTokens } from './extensions/githubAlerts';
import mathExtension, { doubleBackslashMathExtension, gfmMathExtension, singleBackslashMathExtension } from './extensions/math';
import multilineBlockquoteExtension from './extensions/multilineBlockquote';
import referenceDefinitionTabs from './extensions/referenceDefinitionTabs';
import fm from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import { restoreCodeTabs } from './restoreCodeTabs';
import walkTokens from './walkTokens';

function isBlank(char: string): boolean {
    return char === ' ' || char === '\t';
}

function skipBlanks(line: string, end: number, from: number): number {
    let i = from;
    while (i < end && isBlank(line[i]))
        i++;

    return i;
}

/** Skips `>` markers and the blanks around them; returns the first real char. */
function skipBlockquotePrefixes(line: string, end: number): number {
    let i = 0;
    for (;;) {
        i = skipBlanks(line, end, i);
        if (i >= end || line[i] !== '>')
            return i;
        i++;
    }
}

/** Skips one list marker in front of block content, if the line has one. */
function skipListMarker(line: string, end: number, from: number): number {
    if (from >= end)
        return from;

    const marker = line[from];
    if (marker === '-' || marker === '+' || marker === '*') {
        if (from + 1 < end && isBlank(line[from + 1]))
            return skipBlanks(line, end, from + 1);

        return from;
    }

    if (marker < '0' || marker > '9')
        return from;

    let digits = from;
    while (digits < end && line[digits] >= '0' && line[digits] <= '9')
        digits++;

    if (digits + 1 >= end)
        return from;

    const delimiter = line[digits];
    if ((delimiter !== '.' && delimiter !== ')') || !isBlank(line[digits + 1]))
        return from;

    return skipBlanks(line, end, digits + 1);
}

/**
 * True when `line` is a math delimiter (`$` or `$$`) that may open a block,
 * ignoring block-container prefixes.
 *
 * Scanned rather than matched: a regex for the prefixes re-reads the same run
 * of blanks on every iteration, which backtracks quadratically on a long blank
 * line, and this runs once per line of every document containing a `$`.
 */
function isBlockMathOpener(line: string): boolean {
    const end = line.endsWith('\r') ? line.length - 1 : line.length;
    const start = skipListMarker(line, end, skipBlockquotePrefixes(line, end));

    if (start >= end || line[start] !== '$')
        return false;

    let i = start + 1;
    if (i < end && line[i] === '$')
        i++;

    return skipBlanks(line, end, i) === end;
}

function hasBlockMathOpener(src: string): boolean {
    for (const line of src.split('\n')) {
        if (line.includes('$') && isBlockMathOpener(line))
            return true;
    }

    return false;
}

export function lexBlock(
    src: string,
    options: ILexOption = DEFAULT_OPTIONS,
): TLexedToken[] {
    // The desktop normalises file contents before handing them to the engine,
    // but direct consumers (new Muya + setContent, tests) can pass CRLF. Marked
    // only treats LF as a block newline, so a table would otherwise lex as a
    // plain paragraph. Collapse CRLF and lone CR the same way read_markdown_file
    // does on disk.
    src = src.replace(/\r\n?/g, '\n');
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, frontMatter, footnote, multilineBlockquote, fancyLists } = options;
    let tokens: (Token | IFrontmatterToken)[] = [];

    // Per-call Marked instances prevent enabled extensions leaking into later calls.
    const m = new Marked(referenceDefinitionTabs());

    // Register only the math rules this document could possibly need. marked
    // consults every registered extension's `start()` on the *whole* remaining
    // source at each token boundary, and `blockKatex.start` is an
    // `indexOf('\n$')` that scans to the end when there is nothing to find —
    // once per block over a shrinking document, which is quadratic. A math-free
    // 4 MB file spent 11.2 s in `lexBlock` with both rules registered and 0.7 s
    // with neither.
    //
    // Both rules need a `$` at all. The block rule needs a line that is only
    // `$` or `$$` once its container prefixes are stripped — a quoted or
    // list-indented one still counts.
    //
    // Tested against the original `src`: front matter is stripped below, and a
    // superset with no `$` guarantees the remainder has none either.
    const inlineMathPossible = texMathDollars && src.includes('$');
    // Candidate detection for the block rule: a line that holds nothing but
    // `$` or `$$` once its container prefixes (blockquote `>`, a list marker)
    // are stripped can open block math, and the tokenizer decides the rest.
    // Erring towards registering the rule is deliberate: a missed opener
    // silently turns a formula into a paragraph, while a false positive only
    // costs one `indexOf` per token boundary in documents that have a `$`.
    const blockMathPossible = inlineMathPossible && hasBlockMathOpener(src);

    if (inlineMathPossible) {
        m.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: false,
                inline: true,
                block: blockMathPossible,
            }),
        );
    }

    if (texMathGfm) {
        m.use(
            gfmMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (texMathSingleBackslash) {
        m.use(
            singleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (texMathDoubleBackslash) {
        m.use(
            doubleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    // The footnote rule is the same trap as the math rules above, and takes the
    // same way out. Its `start()` runs `/\n\[\^…\]:/` against the whole
    // remaining source at every block boundary, so a document with no footnotes
    // pays a full scan per block — quadratic in the document. A 593 KB file with
    // none opened in 6.0 s with the rule registered and 4.5 s without, and its
    // cost per KB stopped climbing with size.
    //
    // The block rule and its `start()` both need the literal `[^`, so a source
    // without it cannot produce a footnote token. Tested against the original
    // `src` for the same reason the math checks are: front matter is stripped
    // below, and a superset without `[^` guarantees the remainder has none.
    if (footnote && src.includes('[^')) {
        m.use(footnoteExtension());
    }

    m.use(multilineBlockquoteExtension(multilineBlockquote === true));

    if (fancyLists)
        m.use(fancyListsExtension());

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            tokens.push(token);
            src = newSrc;
        }
    }

    // Lexer must receive this instance’s defaults to see its registered extensions.
    m.use(githubAlertsExtension(options.githubAlerts === true));
    const lexer = new m.Lexer(m.defaults);
    if (fancyLists)
        endListItemsAtFancyMarkers(lexer);
    const parsed = lexer.blockTokens(src);
    if (src.includes('\t'))
        restoreCodeTabs(parsed, src);
    // Appended one token at a time: `push(...parsed)` passes every token as a
    // separate argument, and a document dense in short paragraphs (70k of them
    // in ~210 KB) exceeds the engine argument limit and throws
    // `RangeError: Maximum call stack size exceeded` before the stream exists.
    // The front matter token stays ahead of the body, hence appending to the
    // accumulator instead of replacing it.
    for (const token of parsed)
        tokens.push(token);
    tokens = compatibleTaskList(tokens as Token[]);
    if (options.githubAlerts)
        normalizeGithubAlertTokens(tokens as Token[], lexer);
    m.walkTokens(tokens as Token[], walkTokens(options));

    // walkTokens and compatibleTaskList populate Muya fields absent from marked’s declared token types.
    return tokens as TLexedToken[];
}
