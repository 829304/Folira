import { describe, expect, it } from 'vitest';
import { validEmoji } from '../emoji';

// validEmoji sits on the `:alias` path, where the text comes straight from
// what the user typed. A plain property read would also answer for names on
// Object.prototype, so those must read as "not an alias", not as an emoji.
describe('validEmoji — alias lookup', () => {
    it('resolves a real alias', () => {
        const result = validEmoji('smile');

        expect(result).toBeDefined();
        expect(typeof result!.emoji).toBe('string');
        expect(result!.emoji.length).toBeGreaterThan(0);
    });

    it('rejects a name that only exists on the prototype', () => {
        expect(validEmoji('constructor')).toBeUndefined();
    });

    it('rejects __proto__', () => {
        expect(validEmoji('__proto__')).toBeUndefined();
    });

    it('rejects toString and hasOwnProperty', () => {
        expect(validEmoji('toString')).toBeUndefined();
        expect(validEmoji('hasOwnProperty')).toBeUndefined();
    });

    it('rejects an alias that is not in the table', () => {
        expect(validEmoji('definitely-not-an-emoji-alias')).toBeUndefined();
    });
});
