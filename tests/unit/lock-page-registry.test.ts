import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';
import {
    listLockPageAdapters,
    registerLockPageAdapter,
    resolveLockPageAdapter,
    resolveLockPageComponent,
    unregisterLockPageAdapter,
} from '../../app/core/lock-page/registry';

function cleanupRegistry(): void {
    for (const adapter of listLockPageAdapters()) {
        unregisterLockPageAdapter(adapter.id);
    }
}

describe('lock page adapter registry', () => {
    it('registers and resolves adapters by normalized id', () => {
        cleanupRegistry();
        const component = {} as Component;

        registerLockPageAdapter({
            id: ' Marketing ',
            component,
        });

        const resolved = resolveLockPageAdapter('marketing');
        expect(resolved?.id).toBe('marketing');
        expect(resolved?.component).toBe(component);

        cleanupRegistry();
    });

    it('falls back to the default component when adapter is missing', () => {
        cleanupRegistry();
        const fallback = { name: 'DefaultLockPage' } as Component;

        expect(resolveLockPageComponent('missing', fallback)).toBe(fallback);
    });

    it('lets a custom adapter replace the default renderer', () => {
        cleanupRegistry();
        const custom = { name: 'CustomLockPage' } as Component;
        const fallback = { name: 'DefaultLockPage' } as Component;

        registerLockPageAdapter({
            id: 'marketing',
            component: custom,
        });

        expect(resolveLockPageComponent('marketing', fallback)).toBe(custom);

        cleanupRegistry();
    });
});
