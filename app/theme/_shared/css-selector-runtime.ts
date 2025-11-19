/**
 * Runtime CSS Selector Class Application
 *
 * Applies Tailwind utility classes to elements matched by CSS selectors.
 * This provides minimal runtime overhead for theme customization.
 */

import type { CSSelectorConfig } from './types';

/**
 * Cache to track which classes have been applied to which elements
 * WeakMap ensures proper garbage collection when elements are removed
 */
const classApplicationCache = new WeakMap<HTMLElement, Set<string>>();

/**
 * Apply theme classes to elements matching CSS selectors
 *
 * @param themeName - The active theme name
 * @param selectors - CSS selector to config mapping from theme definition
 */
export function applyThemeClasses(
    themeName: string,
    selectors: Record<string, CSSelectorConfig>
): void {
    const entries = Object.entries(selectors);
    if (entries.length === 0) return;

    // Chunking execution to prevent frame drops
    let index = 0;

    const processChunk = () => {
        const start = performance.now();
        // 5ms budget per frame to keep UI responsive
        while (index < entries.length && performance.now() - start < 5) {
            const entry = entries[index++];
            if (!entry) break;
            const [selector, config] = entry;

            if (!config.class) continue;

            const classes = config.class.split(/\s+/).filter(Boolean);
            if (classes.length === 0) continue;

            try {
                const elements = document.querySelectorAll(selector);

                elements.forEach((element) => {
                    if (!(element instanceof HTMLElement)) return;

                    // Track what we've added to avoid duplicates
                    if (!classApplicationCache.has(element)) {
                        classApplicationCache.set(element, new Set());
                    }

                    const applied = classApplicationCache.get(element)!;
                    const newClasses = classes.filter(
                        (c: string) => !applied.has(c)
                    );

                    if (newClasses.length > 0) {
                        element.classList.add(...newClasses);
                        newClasses.forEach((c: string) => applied.add(c));
                    }
                });
            } catch (error) {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Invalid CSS selector: "${selector}"`,
                        error
                    );
                }
            }
        }

        if (index < entries.length) {
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(processChunk);
            } else {
                setTimeout(processChunk, 0);
            }
        }
    };

    processChunk();
}

/**
 * Remove all theme classes from elements
 *
 * @param selectors - CSS selector to config mapping
 */
export function removeThemeClasses(
    selectors: Record<string, CSSelectorConfig>
): void {
    for (const [selector, config] of Object.entries(selectors)) {
        if (!config.class) continue;

        const classes = config.class.split(/\s+/).filter(Boolean);
        if (classes.length === 0) continue;

        try {
            const elements = document.querySelectorAll(selector);

            elements.forEach((element) => {
                if (!(element instanceof HTMLElement)) return;

                element.classList.remove(...classes);

                // Clear cache for this element
                if (classApplicationCache.has(element)) {
                    classApplicationCache.delete(element);
                }
            });
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to remove classes for selector: "${selector}"`,
                    error
                );
            }
        }
    }
}

/**
 * Load theme CSS file
 *
 * @param themeName - The theme name
 * @returns Promise that resolves when CSS is loaded
 */
export async function loadThemeCSS(themeName: string): Promise<void> {
    // Check if CSS is already loaded
    const existingLink = document.querySelector(
        `link[data-theme-css="${themeName}"]`
    );

    if (existingLink) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `/themes/${themeName}.css`;
        link.setAttribute('data-theme-css', themeName);

        link.onload = () => resolve();
        link.onerror = () => {
            // CSS file might not exist if theme has no cssSelectors
            // This is OK, just resolve
            if (import.meta.dev) {
                console.log(
                    `[theme] No CSS file for theme "${themeName}" (this is OK if theme has no cssSelectors)`
                );
            }
            resolve();
        };

        document.head.appendChild(link);
    });
}

/**
 * Unload theme CSS file
 *
 * @param themeName - The theme name
 */
export function unloadThemeCSS(themeName: string): void {
    const link = document.querySelector(`link[data-theme-css="${themeName}"]`);

    if (link) {
        link.remove();
    }
}
