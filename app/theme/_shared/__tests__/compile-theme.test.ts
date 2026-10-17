import { describe, expect, it } from 'vitest';
import { compileThemeDefinition } from '../compile-theme';
import type { ThemeDefinition } from '../types';

describe('compileThemeDefinition', () => {
    it('compiles immutable overrides with props, selector identity, and specificity', () => {
        const definition: ThemeDefinition = {
            name: 'parity',
            colors: { primary: '#123456', secondary: '#654321', surface: '#fff' },
            overrides: {
                button: { class: 'base', style: { color: 'red' } },
                'button.chat': { variant: 'ghost' },
                input: { variant: 'outline' },
                'button#chat.send[type="submit"]:hover': {
                    variant: 'solid', size: 'md',
                },
            },
            cssSelectors: { '.portal': { style: { color: 'blue' } } },
        };
        const assets = { stylesheets: ['./styles.css'], icons: { send: 'test:send' } };

        const compiled = compileThemeDefinition(definition, assets);

        expect(compiled.overrides).toMatchObject([
            {
                component: 'button',
                identifier: 'chat.send',
                state: 'hover',
                selector: 'button#chat.send[type="submit"]:hover',
                specificity: 41,
                attributes: [{ attribute: 'type', operator: '=', value: 'submit' }],
                props: { variant: 'solid', size: 'md' },
            },
            {
                component: 'button', context: 'chat', specificity: 11,
                props: { variant: 'ghost' },
            },
            {
                component: 'input', specificity: 1,
                props: { variant: 'outline' },
            },
            {
                component: 'button', specificity: 1,
                props: { class: 'base', style: { color: 'red' } },
            },
        ]);
        expect(Object.isFrozen(compiled)).toBe(true);
        expect(Object.isFrozen(compiled.overrides[0]?.props)).toBe(true);
    });
});
