import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RuntimeResolver } from '../runtime-resolver';
import type { CompiledTheme } from '../types';

// Mock DOM environment
class MockHTMLElement {
    tagName: string;
    attributes: Record<string, string> = {};
    type: string = ''; // for input
    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }
    getAttribute(name: string) {
        if (name === 'type' && this.type) return this.type;
        return this.attributes[name] || null;
    }
}

global.HTMLElement = MockHTMLElement as any;
global.document = {
    createElement: (tag: string) => new MockHTMLElement(tag),
} as any;

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

    it('should cache results for components without attribute matchers', () => {
        const params = { component: 'button' };

        // First call
        const result1 = resolver.resolve(params);

        // Second call
        const result2 = resolver.resolve(params);

        // Should be the exact same object reference if cached
        expect(result1).toBe(result2);
        // variant is mapped to class
        expect(result1.props.class).toContain('variant-solid');
        expect(result1.props.variant).toBeUndefined();
    });

    it('should NOT cache results for components WITH attribute matchers if element is provided', () => {
        // Input has attribute matchers in the theme
        const element = document.createElement('input') as any;
        element.type = 'text';

        const params = { component: 'input', element };

        const result1 = resolver.resolve(params);
        const result2 = resolver.resolve(params);

        // Should NOT be the same object reference because we skip cache for attribute-dependent components when element is present
        expect(result1).not.toBe(result2);
        expect(result1).toEqual(result2); // Content should be same
    });

    it('should cache results for components WITH attribute matchers if element is NOT provided', () => {
        // Input has attribute matchers, but we don't provide element
        const params = { component: 'input' };

        const result1 = resolver.resolve(params);
        const result2 = resolver.resolve(params);

        // canCache = !params.element (true) || ... -> true
        expect(result1).toBe(result2);
    });

    it('should cache results for components WITHOUT attribute matchers even if element IS provided', () => {
        // Button has NO attribute matchers
        const element = document.createElement('button') as any;
        const params = { component: 'button', element };

        const result1 = resolver.resolve(params);
        const result2 = resolver.resolve(params);

        // canCache = !params.element (false) || !this.componentsWithAttributes.has('button') (true) -> true
        expect(result1).toBe(result2);
    });
});
