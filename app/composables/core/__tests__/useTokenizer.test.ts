import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope } from 'vue';

describe('useTokenizer - SSR fallback', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns a token count for valid text', async () => {
        const { useTokenizer } = await import('../useTokenizer');

        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        const count = await tokenizer.countTokens('hello world');

        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);

        scope.stop();
    });

    it('handles empty string without error', async () => {
        const { useTokenizer } = await import('../useTokenizer');

        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        const count = await tokenizer.countTokens('');

        expect(count).toBe(0);

        scope.stop();
    });

    it('handles multiple sequential calls', async () => {
        const { useTokenizer } = await import('../useTokenizer');

        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        const count1 = await tokenizer.countTokens('first');
        const count2 = await tokenizer.countTokens('second');
        const count3 = await tokenizer.countTokens('third');

        expect(typeof count1).toBe('number');
        expect(typeof count2).toBe('number');
        expect(typeof count3).toBe('number');

        scope.stop();
    });
});
