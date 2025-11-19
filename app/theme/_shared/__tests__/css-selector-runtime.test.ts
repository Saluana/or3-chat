import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    applyThemeClasses,
    removeThemeClasses,
    loadThemeCSS,
    unloadThemeCSS,
} from '../css-selector-runtime';
import type { CSSelectorConfig } from '../types';

describe('CSS Selector Runtime', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        // Create a test container
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        // Clean up
        document.body.removeChild(container);

        // Remove any theme CSS links
        document
            .querySelectorAll('[data-theme-css]')
            .forEach((link) => link.remove());
    });

    describe('applyThemeClasses', () => {
        it('should apply classes to matching elements', () => {
            container.innerHTML = '<div class="test-element">Content</div>';
            const element = container.querySelector(
                '.test-element'
            ) as HTMLElement;

            const selectors: Record<string, CSSelectorConfig> = {
                '.test-element': {
                    class: 'applied-class another-class',
                },
            };

            applyThemeClasses('test-theme', selectors);

            expect(element.classList.contains('applied-class')).toBe(true);
            expect(element.classList.contains('another-class')).toBe(true);
        });

        it('should not apply duplicate classes', () => {
            container.innerHTML = '<div class="test-element">Content</div>';
            const element = container.querySelector(
                '.test-element'
            ) as HTMLElement;

            const selectors: Record<string, CSSelectorConfig> = {
                '.test-element': {
                    class: 'test-class',
                },
            };

            // Apply twice
            applyThemeClasses('test-theme', selectors);
            applyThemeClasses('test-theme', selectors);

            // Should only have one instance
            const classes = Array.from(element.classList);
            const count = classes.filter((c) => c === 'test-class').length;
            expect(count).toBe(1);
        });

        it('should skip selectors without class property', () => {
            container.innerHTML = '<div class="test-element">Content</div>';
            const element = container.querySelector(
                '.test-element'
            ) as HTMLElement;

            const selectors: Record<string, CSSelectorConfig> = {
                '.test-element': {
                    style: { color: 'red' }, // No class property
                },
            };

            applyThemeClasses('test-theme', selectors);

            // No classes should be added
            expect(element.className).toBe('test-element');
        });

        it('should handle invalid selectors gracefully', () => {
            const selectors: Record<string, CSSelectorConfig> = {
                ':::invalid:::': {
                    class: 'test-class',
                },
            };

            // Should not throw
            expect(() =>
                applyThemeClasses('test-theme', selectors)
            ).not.toThrow();
        });

        it('should work with complex selectors', () => {
            container.innerHTML = `
                <div class="parent">
                    <div class="child">Content</div>
                </div>
            `;
            const element = container.querySelector(
                '.parent .child'
            ) as HTMLElement;

            const selectors: Record<string, CSSelectorConfig> = {
                '.parent .child': {
                    class: 'complex-selector',
                },
            };

            applyThemeClasses('test-theme', selectors);

            expect(element.classList.contains('complex-selector')).toBe(true);
        });

        it('should apply to multiple matching elements', () => {
            container.innerHTML = `
                <div class="item">Item 1</div>
                <div class="item">Item 2</div>
                <div class="item">Item 3</div>
            `;

            const selectors: Record<string, CSSelectorConfig> = {
                '.item': {
                    class: 'multi-class',
                },
            };

            applyThemeClasses('test-theme', selectors);

            const elements = container.querySelectorAll('.item');
            elements.forEach((el) => {
                expect(el.classList.contains('multi-class')).toBe(true);
            });
        });
    });

    describe('removeThemeClasses', () => {
        it('should remove classes from elements', () => {
            container.innerHTML =
                '<div class="test-element applied-class">Content</div>';
            const element = container.querySelector(
                '.test-element'
            ) as HTMLElement;

            const selectors: Record<string, CSSelectorConfig> = {
                '.test-element': {
                    class: 'applied-class',
                },
            };

            removeThemeClasses(selectors);

            expect(element.classList.contains('applied-class')).toBe(false);
            expect(element.classList.contains('test-element')).toBe(true);
        });

        it('should handle multiple classes', () => {
            container.innerHTML =
                '<div class="test-element class1 class2 class3">Content</div>';
            const element = container.querySelector(
                '.test-element'
            ) as HTMLElement;

            const selectors: Record<string, CSSelectorConfig> = {
                '.test-element': {
                    class: 'class1 class2',
                },
            };

            removeThemeClasses(selectors);

            expect(element.classList.contains('class1')).toBe(false);
            expect(element.classList.contains('class2')).toBe(false);
            expect(element.classList.contains('class3')).toBe(true);
        });

        it('should not error if classes do not exist', () => {
            container.innerHTML = '<div class="test-element">Content</div>';

            const selectors: Record<string, CSSelectorConfig> = {
                '.test-element': {
                    class: 'nonexistent-class',
                },
            };

            // Should not throw
            expect(() => removeThemeClasses(selectors)).not.toThrow();
        });
    });

    describe('loadThemeCSS', () => {
        it('should create link element for theme CSS', async () => {
            const promise = loadThemeCSS('test-theme');

            // Wait a tick for the link to be created
            await new Promise((resolve) => setTimeout(resolve, 0));

            const link = document.querySelector(
                'link[data-theme-css="test-theme"]'
            ) as HTMLLinkElement;
            expect(link).toBeTruthy();
            expect(link?.getAttribute('href')).toBe('/themes/test-theme.css');

            // Simulate load event
            link.dispatchEvent(new Event('load'));

            await promise;
        });

        it('should not duplicate link elements', async () => {
            const promise1 = loadThemeCSS('test-theme');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const link1 = document.querySelector(
                'link[data-theme-css="test-theme"]'
            ) as HTMLLinkElement;
            link1.dispatchEvent(new Event('load'));
            await promise1;

            const promise2 = loadThemeCSS('test-theme');
            await promise2;

            const links = document.querySelectorAll(
                'link[data-theme-css="test-theme"]'
            );
            expect(links.length).toBe(1);
        });

        it('should resolve even if CSS file does not exist', async () => {
            const promise = loadThemeCSS('nonexistent-theme');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const link = document.querySelector(
                'link[data-theme-css="nonexistent-theme"]'
            ) as HTMLLinkElement;

            // Simulate error event
            link.dispatchEvent(new Event('error'));

            // Should not throw
            await expect(promise).resolves.toBeUndefined();
        });
    });

    describe('unloadThemeCSS', () => {
        it('should remove link element', async () => {
            const promise = loadThemeCSS('test-theme');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const link = document.querySelector(
                'link[data-theme-css="test-theme"]'
            ) as HTMLLinkElement;
            link.dispatchEvent(new Event('load'));
            await promise;

            expect(
                document.querySelector('link[data-theme-css="test-theme"]')
            ).toBeTruthy();

            unloadThemeCSS('test-theme');

            expect(
                document.querySelector('link[data-theme-css="test-theme"]')
            ).toBeFalsy();
        });

        it('should not error if link does not exist', () => {
            // Should not throw
            expect(() => unloadThemeCSS('nonexistent-theme')).not.toThrow();
        });
    });

    describe('Integration', () => {
        it('should handle complete theme switch workflow', async () => {
            container.innerHTML = `
                <div class="element1">Element 1</div>
                <div class="element2">Element 2</div>
            `;

            const theme1Selectors: Record<string, CSSelectorConfig> = {
                '.element1': { class: 'theme1-class' },
                '.element2': { class: 'theme1-class' },
            };

            const theme2Selectors: Record<string, CSSelectorConfig> = {
                '.element1': { class: 'theme2-class' },
                '.element2': { class: 'theme2-class' },
            };

            // Apply theme 1
            const promise1 = loadThemeCSS('theme1');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const link1 = document.querySelector(
                'link[data-theme-css="theme1"]'
            ) as HTMLLinkElement;
            link1.dispatchEvent(new Event('load'));
            await promise1;

            applyThemeClasses('theme1', theme1Selectors);

            const el1 = container.querySelector('.element1') as HTMLElement;
            const el2 = container.querySelector('.element2') as HTMLElement;

            expect(el1.classList.contains('theme1-class')).toBe(true);
            expect(el2.classList.contains('theme1-class')).toBe(true);

            // Switch to theme 2
            removeThemeClasses(theme1Selectors);
            unloadThemeCSS('theme1');

            const promise2 = loadThemeCSS('theme2');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const link2 = document.querySelector(
                'link[data-theme-css="theme2"]'
            ) as HTMLLinkElement;
            link2.dispatchEvent(new Event('load'));
            await promise2;

            applyThemeClasses('theme2', theme2Selectors);

            expect(el1.classList.contains('theme1-class')).toBe(false);
            expect(el1.classList.contains('theme2-class')).toBe(true);
            expect(el2.classList.contains('theme1-class')).toBe(false);
            expect(el2.classList.contains('theme2-class')).toBe(true);
        });
    });
});
