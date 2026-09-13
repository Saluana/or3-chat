import { describe, expect, it } from 'vitest';
import { assertNoMaterialMaxRegression } from '../performance/comparison';

const budget = (actual: number, limit = 6_000) => ({
    actual,
    limit,
    direction: 'max' as const,
    passed: actual <= limit,
});

describe('same-host performance comparison', () => {
    it('accepts a candidate within ten percent when the base also misses the absolute budget', () => {
        expect(assertNoMaterialMaxRegression({ seedMs: budget(8_100) }, { seedMs: budget(8_000) })).toHaveLength(1);
    });

    it('rejects a material candidate regression', () => {
        expect(() => assertNoMaterialMaxRegression({ seedMs: budget(9_000) }, { seedMs: budget(8_000) })).toThrow('regressed');
    });

    it('rejects fallback when the same-host base passes the absolute budget', () => {
        expect(() => assertNoMaterialMaxRegression({ seedMs: budget(6_500) }, { seedMs: budget(5_900) })).toThrow('without a same-host base failure');
    });
});
