import { describe, it, expect } from 'vitest';
import { useTokenizer } from '../useTokenizer';

describe('local token estimates', () => {
    it('estimates single and batched text without requiring a worker', async () => {
        const { countTokens, countTokensBatch, isReady } = useTokenizer();
        expect(isReady.value).toBe(true);
        expect(await countTokens('hello world')).toBe(3);
        expect(await countTokens('')).toBe(0);
        expect(await countTokensBatch([
            { key: 'first', text: 'hello world' },
            { key: 'empty', text: '' },
            { key: 'other', text: 'abcd' },
        ])).toEqual({ first: 3, empty: 0, other: 1 });
    });
});
