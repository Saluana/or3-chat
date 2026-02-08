import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';
import {
    listAuthUiAdapters,
    registerAuthUiAdapter,
    resolveAuthUiAdapter,
    unregisterAuthUiAdapter,
} from '../../app/core/auth-ui/registry';

function cleanupRegistry(): void {
    for (const adapter of listAuthUiAdapters()) {
        unregisterAuthUiAdapter(adapter.id);
    }
}

describe('auth ui adapter registry', () => {
    it('registers and resolves adapters by normalized id', () => {
        cleanupRegistry();
        const component = {} as Component;
        registerAuthUiAdapter({
            id: ' Basic-Auth ',
            component,
        });

        const resolved = resolveAuthUiAdapter('basic-auth');
        expect(resolved?.id).toBe('basic-auth');
        expect(resolved?.component).toBe(component);

        cleanupRegistry();
    });

    it('overwrites existing adapter registration for same id', () => {
        cleanupRegistry();
        const first = { name: 'first' } as Component;
        const second = { name: 'second' } as Component;
        registerAuthUiAdapter({
            id: 'sqlite',
            component: first,
        });
        registerAuthUiAdapter({
            id: ' sqlite ',
            component: second,
        });

        const resolved = resolveAuthUiAdapter('sqlite');
        expect(resolved?.component).toBe(second);

        cleanupRegistry();
    });

    it('unregisters adapters cleanly', () => {
        cleanupRegistry();
        registerAuthUiAdapter({
            id: 'fs',
            component: {} as Component,
        });
        unregisterAuthUiAdapter('FS');
        expect(resolveAuthUiAdapter('fs')).toBeNull();
    });
});
