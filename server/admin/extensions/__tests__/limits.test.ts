/* @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveExtensionInstallLimits } from '../install';

describe('resolveExtensionInstallLimits', () => {
    it('falls back to defaults for non-finite values', () => {
        const limits = resolveExtensionInstallLimits({
            maxZipBytes: Number.NaN,
            maxFiles: Number.POSITIVE_INFINITY,
            maxTotalBytes: Number.NEGATIVE_INFINITY,
        });

        expect(limits.maxZipBytes).toBe(25 * 1024 * 1024);
        expect(limits.maxFiles).toBe(2000);
        expect(limits.maxTotalBytes).toBe(200 * 1024 * 1024);
    });
});
