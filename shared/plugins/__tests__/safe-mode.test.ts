import { describe, expect, it, vi } from 'vitest';
import {
    discoverNonCorePlugins,
    isNonCorePluginDiscoveryDisabled,
} from '../safe-mode';

describe('non-core plugin pre-discovery safe mode', () => {
    it('does not call a loader or import callback in safe mode', async () => {
        const discover = vi.fn(async () => ({ loaded: true }));

        const result = await discoverNonCorePlugins(
            { disableNonCorePlugins: true },
            discover
        );

        expect(result).toBeUndefined();
        expect(discover).not.toHaveBeenCalled();
    });

    it('preserves existing discovery unless safe mode is explicitly true', async () => {
        const discover = vi.fn(async () => ({ loaded: true }));

        await expect(discoverNonCorePlugins(undefined, discover)).resolves.toEqual({
            loaded: true,
        });
        expect(discover).toHaveBeenCalledOnce();
        expect(isNonCorePluginDiscoveryDisabled({ disableNonCorePlugins: false })).toBe(false);
    });
});

