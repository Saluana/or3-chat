import { describe, expect, it } from 'vitest';
import { shouldResetBackgroundContent } from '../recovery';

describe('background recovery projection', () => {
    it('requires a full snapshot after a durable attempt changes', () => {
        expect(shouldResetBackgroundContent(1, 2, 500)).toBe(true);
        expect(shouldResetBackgroundContent(2, 2, 500)).toBe(false);
    });

    it('fails safe for an upgraded client with content but no stored attempt', () => {
        expect(shouldResetBackgroundContent(null, 2, 500)).toBe(true);
        expect(shouldResetBackgroundContent(null, 2, 0)).toBe(false);
    });
});
