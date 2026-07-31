import { describe, expect, it } from 'vitest';
import { compileThemeDefinition } from '../compile-theme';
import type { ThemeDefinition } from '../types';

describe('compileThemeDefinition', () => {
    it('produces deterministic immutable payloads for client and SSR adapters', () => {
        const definition: ThemeDefinition = {
            name: 'parity',
            colors: { primary: '#123456', secondary: '#654321', surface: '#fff' },
            overrides: {
                button: { class: 'base', style: { color: 'red' } },
                'button#send': { class: 'specific' },
            },
            cssSelectors: { '.portal': { style: { color: 'blue' } } },
        };
        const assets = { stylesheets: ['./styles.css'], icons: { send: 'test:send' } };

        const client = compileThemeDefinition(definition, assets);
        const server = compileThemeDefinition(definition, assets);

        expect(client).toEqual(server);
        expect(Object.isFrozen(client)).toBe(true);
        expect(Object.isFrozen(client.overrides[0]?.props)).toBe(true);
    });
});
