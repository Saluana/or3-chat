import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeResolver } from '../runtime-resolver';
import type { CompiledTheme } from '../types';

describe('RuntimeResolver Caching', () => {
    const mockTheme: CompiledTheme = {
        name: 'test-theme',
        cssVariables: '',
        overrides: [
            {
                component: 'button',
                props: { variant: 'solid' },
                selector: 'button',
                specificity: 1,
            },
            {
                component: 'input',
                attributes: [
                    { attribute: 'type', operator: '=', value: 'text' },
                ],
                props: { color: 'gray' },
                selector: 'input[type="text"]',
                specificity: 10,
            },
        ],
    };

    let resolver: RuntimeResolver;

    beforeEach(() => {
        resolver = new RuntimeResolver(mockTheme);
    });

    it('resolves changed attributes on the same live element', () => {
        const element = document.createElement('input');
        element.type = 'text';
        const params = { component: 'input', element, isNuxtUI: true };
        expect(resolver.resolve(params).props.color).toBe('gray');
        element.type = 'password';
        expect(resolver.resolve(params).props.color).toBeUndefined();
    });

});
