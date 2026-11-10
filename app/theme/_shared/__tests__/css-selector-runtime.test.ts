import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    applyThemeClasses,
    removeThemeClasses,
    deactivateThemeCSS,
    loadThemeCSS,
    unloadThemeCSS,
} from '../css-selector-runtime';
import type { CSSelectorConfig } from '../types';

const TEST_THEME_NAMES = [
    'test-theme',
    'detached-node-theme',
    'remove-theme',
    'multi-remove-theme',
    'ownership-theme',
    'stale-selector-theme',
    'theme1',
    'theme2',
];

describe('CSS Selector Runtime', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        // Create a test container
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        for (const themeName of TEST_THEME_NAMES) {
            removeThemeClasses(themeName);
        }

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

            const OriginalMutationObserver = globalThis.MutationObserver;
            const observerSpy = vi.fn();
            globalThis.MutationObserver = observerSpy as never;
            try {
                applyThemeClasses('test-theme', selectors);
            } finally {
                globalThis.MutationObserver = OriginalMutationObserver;
            }

            // No classes should be added
            expect(element.className).toBe('test-element');
            expect(observerSpy).not.toHaveBeenCalled();
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

        it('batches additions and skips per-selector scans for unrelated subtrees', async () => {
            const frames: FrameRequestCallback[] = [];
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
            vi.stubGlobal('cancelAnimationFrame', vi.fn());
            try {
                applyThemeClasses('test-theme', {
                    '.alpha': { class: 'first shared' },
                    '.beta': { class: 'second shared' },
                    ':::invalid:::': { class: 'invalid' },
                });
                const unrelated = document.createElement('section');
                const query = vi.spyOn(unrelated, 'querySelector');
                const queryAll = vi.spyOn(unrelated, 'querySelectorAll');
                container.appendChild(unrelated);
                await Promise.resolve();
                expect(frames).toHaveLength(1);
                frames.shift()!(0);
                expect(query).toHaveBeenCalledTimes(1);
                expect(queryAll).not.toHaveBeenCalled();

                const root = document.createElement('div');
                root.className = 'alpha beta';
                root.innerHTML = '<span class="alpha beta"></span>';
                container.appendChild(root);
                container.appendChild(document.createElement('aside'));
                await Promise.resolve();
                expect(frames).toHaveLength(1);
                frames.shift()!(0);
                for (const el of [root, root.firstElementChild!]) {
                    expect(el.classList.contains('first')).toBe(true);
                    expect(el.classList.contains('second')).toBe(true);
                    expect(el.classList.contains('shared')).toBe(true);
                }
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('releases detached descendants but preserves moved nodes and cancels pending work', async () => {
            const frames: FrameRequestCallback[] = [];
            const cancel = vi.fn();
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
            vi.stubGlobal('cancelAnimationFrame', cancel);
            try {
                container.innerHTML = '<div class="target"><span class="target"></span></div><aside></aside>';
                const root = container.firstElementChild as HTMLElement;
                const child = root.firstElementChild as HTMLElement;
                applyThemeClasses('test-theme', { '.target': { class: 'owned' } });
                container.lastElementChild!.appendChild(child);
                root.remove();
                await Promise.resolve();
                frames.shift()!(0);
                expect(root.classList.contains('owned')).toBe(false);
                expect(child.classList.contains('owned')).toBe(true);
                child.remove();
                container.appendChild(child);
                await Promise.resolve();
                frames.shift()!(0);
                expect(child.classList.contains('owned')).toBe(true);
                const added = document.createElement('div');
                added.className = 'target';
                container.appendChild(added);
                await Promise.resolve();
                const pending = frames.shift()!;
                removeThemeClasses('test-theme');
                expect(cancel).toHaveBeenCalled();
                pending(0);
                expect(added.classList.contains('owned')).toBe(false);
                expect(child.classList.contains('owned')).toBe(false);
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('cleans detached ownership while frames are paused and retains connected additions', async () => {
            const frames: FrameRequestCallback[] = [];
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
            vi.stubGlobal('cancelAnimationFrame', vi.fn());
            try {
                const owned = document.createElement('div');
                owned.className = 'target';
                container.appendChild(owned);
                applyThemeClasses('test-theme', { '.target': { class: 'owned' } });
                const connected = document.createElement('div');
                connected.className = 'target';
                container.appendChild(connected);
                for (let i = 0; i < 5; i++) {
                    const transient = document.createElement('div');
                    container.appendChild(transient);
                    await Promise.resolve();
                    transient.remove();
                    await Promise.resolve();
                }
                owned.remove();
                await Promise.resolve();
                expect(owned.classList.contains('owned')).toBe(false);
                frames.shift()!(0);
                expect(connected.classList.contains('owned')).toBe(true);
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('does not scan tracked elements or schedule work for text-only changes', async () => {
            const frame = vi.fn();
            vi.stubGlobal('requestAnimationFrame', frame);
            try {
                container.innerHTML = '<div class="target"></div><span>before</span>';
                const target = container.firstElementChild as HTMLElement;
                applyThemeClasses('test-theme', { '.target': { class: 'owned' } });
                const connected = vi.spyOn(target, 'isConnected', 'get');
                container.lastElementChild!.textContent = 'after';
                await Promise.resolve();
                expect(connected).not.toHaveBeenCalled();
                expect(frame).not.toHaveBeenCalled();
                connected.mockRestore();
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('handles complex selectors without hiding later matches', async () => {
            const frames: FrameRequestCallback[] = [];
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
            vi.stubGlobal('cancelAnimationFrame', vi.fn());
            try {
                applyThemeClasses('test-theme', {
                    '.unused /*': { class: 'unused' },
                    '.target': { class: 'owned' },
                });
                const root = document.createElement('div');
                root.innerHTML = '<span class="target"></span>';
                container.appendChild(root);
                await Promise.resolve();
                frames.shift()!(0);
                expect(root.firstElementChild!.classList.contains('owned')).toBe(true);
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('processes additions without animation frame support', async () => {
            vi.stubGlobal('requestAnimationFrame', undefined);
            try {
                applyThemeClasses('test-theme', { '.target': { class: 'owned' } });
                const element = document.createElement('div');
                element.className = 'target';
                container.appendChild(element);
                await Promise.resolve();
                await Promise.resolve();
                expect(element.classList.contains('owned')).toBe(true);
                element.remove();
                await Promise.resolve();
                await Promise.resolve();
                expect(element.classList.contains('owned')).toBe(false);
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('releases theme-owned classes when matching elements are removed', async () => {
            const element = document.createElement('div');
            element.className = 'temporary-theme-node';
            container.appendChild(element);
            applyThemeClasses('detached-node-theme', {
                '.temporary-theme-node': { class: 'theme-owned' },
            });
            expect(element.classList.contains('theme-owned')).toBe(true);

            element.remove();
            await new Promise((resolve) => requestAnimationFrame(resolve));

            expect(element.classList.contains('theme-owned')).toBe(false);
            removeThemeClasses('detached-node-theme');
        });
    });

    describe('removeThemeClasses', () => {
        it('should handle multiple classes', () => {
            container.innerHTML =
                '<div class="test-element class3">Content</div>';
            const element = container.querySelector(
                '.test-element'
            ) as HTMLElement;

            const selectors: Record<string, CSSelectorConfig> = {
                '.test-element': {
                    class: 'class1 class2',
                },
            };

            applyThemeClasses('multi-remove-theme', selectors);
            removeThemeClasses('multi-remove-theme');

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
            expect(() => removeThemeClasses('missing-theme')).not.toThrow();
        });

        it('preserves a class that existed before the theme applied', () => {
            container.innerHTML =
                '<div class="test-element app-owned">Content</div>';
            const element = container.querySelector('.test-element') as HTMLElement;
            const selectors = {
                '.test-element': { class: 'app-owned theme-owned' },
            };

            applyThemeClasses('ownership-theme', selectors);
            removeThemeClasses('ownership-theme');

            expect(element.classList.contains('app-owned')).toBe(true);
            expect(element.classList.contains('theme-owned')).toBe(false);
        });

        it('removes owned classes even when the element no longer matches', () => {
            container.innerHTML = '<div class="match-me">Content</div>';
            const element = container.firstElementChild as HTMLElement;
            applyThemeClasses('stale-selector-theme', {
                '.match-me': { class: 'theme-owned' },
            });
            element.classList.remove('match-me');

            removeThemeClasses('stale-selector-theme');
            expect(element.classList.contains('theme-owned')).toBe(false);
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

        it('re-enables a cached inactive stylesheet', async () => {
            const firstLoad = loadThemeCSS('test-theme');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const link = document.querySelector(
                'link[data-theme-css="test-theme"]'
            ) as HTMLLinkElement;
            link.dispatchEvent(new Event('load'));
            await firstLoad;

            deactivateThemeCSS('test-theme');
            expect(link.disabled).toBe(true);
            await loadThemeCSS('test-theme');

            expect(link.disabled).toBe(false);
            expect(
                document.querySelectorAll('link[data-theme-css="test-theme"]')
            ).toHaveLength(1);
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

});
