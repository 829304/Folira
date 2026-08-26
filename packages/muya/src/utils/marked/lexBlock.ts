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

export function lexBlock(
    src: string,
    options: ILexOption = DEFAULT_OPTIONS,
): TLexedToken[] {
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
    // Both rules need a `$` at all. The block rule needs more: it matches
    // `$$\n…\n$$`, so any text it can match contains a newline immediately
    // followed by the closing delimiter. No `\n$`, no block math.
    //
    // Tested against the original `src`: front matter is stripped below, and a
    // superset with no `$` guarantees the remainder has none either.
    const inlineMathPossible = texMathDollars && src.includes('$');
    const blockMathPossible = inlineMathPossible && src.includes('\n$');

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
    tokens.push(...parsed);
    tokens = compatibleTaskList(tokens as Token[]);
    if (options.githubAlerts)
        normalizeGithubAlertTokens(tokens as Token[], lexer);
    m.walkTokens(tokens as Token[], walkTokens(options));

    // walkTokens and compatibleTaskList populate Muya fields absent from marked’s declared token types.
    return tokens as TLexedToken[];
}
