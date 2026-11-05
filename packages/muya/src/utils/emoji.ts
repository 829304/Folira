import { CLASS_NAMES } from '../config';
import emojiByAlias from '../config/emojiAliases';

/**
 * Whether `text` names an emoji, and which character it is.
 *
 * Called while tokenizing `:alias:` and again while rendering it, so it has to
 * answer synchronously. It reads the alias map rather than the full emoji
 * table: callers need the character and nothing else, and the table's
 * descriptions, categories and search tags are 179 KB that only the picker
 * uses.
 */
export function validEmoji(text: string): { emoji: string } | undefined {
    // Plain property access would also resolve inherited names: `:constructor:`
    // and `:__proto__:` come back as functions or objects from the prototype,
    // pass an `=== undefined` test, and render as `[object Object]`.
    // `Object.hasOwn` needs Chrome 93; the engine builds for `chrome70`.
    // eslint-disable-next-line e18e/prefer-object-has-own -- the build target predates it
    if (!Object.prototype.hasOwnProperty.call(emojiByAlias, text))
        return undefined;

    return { emoji: emojiByAlias[text] };
}

export function checkEditEmoji(node: HTMLElement) {
    if (node && node.classList.contains(CLASS_NAMES.MU_EMOJI_MARKED_TEXT))
        return node;

    return false;
}
