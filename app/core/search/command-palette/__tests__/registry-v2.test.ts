import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('palette registry V2 lifecycle', () => {
    beforeEach(() => {
        vi.resetModules();
        const globals = globalThis as Record<string, unknown>;
        const unsubscribe = globals.__or3PaletteRegistryBumpUnsubscribe;
        if (typeof unsubscribe === 'function') unsubscribe();
        delete globals.__or3ContributionSurfaceSelection;
        delete globals.__or3PaletteRegistryState;
        delete globals.__or3PaletteRegistryBumpUnsubscribe;
    });

    it('clears V2 legacy contributions in the test reset', async () => {
        const { initializeContributionSurfaceSelection } = await import(
            '~/composables/plugins/contribution-surface-selection'
        );
        initializeContributionSurfaceSelection(['command-palette']);
        const registry = await import('../registry');
        registry.registerPaletteCommand(
            { id: 'v2-command', label: 'V2 command' },
            () => ({ ok: true })
        );
        expect(registry.listPaletteCommands()).toHaveLength(1);

        registry.__resetPaletteRegistryForTests();
        expect(registry.listPaletteCommands()).toEqual([]);
    });

    it('replaces the HMR bump subscription instead of accumulating listeners', async () => {
        const { initializeContributionSurfaceSelection } = await import(
            '~/composables/plugins/contribution-surface-selection'
        );
        initializeContributionSurfaceSelection(['command-palette']);
        await import('../registry');
        const { getContributionSurfaceKernel } = await import(
            '~/composables/plugins/contribution-surface-kernel'
        );
        const kernel = getContributionSurfaceKernel('command-palette', {
            getId: () => 'unused',
        });
        const firstCount = kernel.registry.subscriberCount;

        vi.resetModules();
        await import('../registry');
        expect(kernel.registry.subscriberCount).toBe(firstCount);
    });
});
