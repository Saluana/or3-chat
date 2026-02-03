/**
 * @module app/theme/_shared/css-selector-runtime
 *
 * Purpose:
 * Applies runtime class based selector overrides for themes.
 * This is used when theme definitions include `cssSelectors` with class values.
 *
 * Behavior:
 * - Adds classes to matched elements in small chunks to avoid frame drops
 * - Tracks applied classes per element to avoid duplicates
 *
 * Constraints:
 * - Requires `document` and runs only in the browser
 * - Only class based overrides are handled here
 *
 * Non-Goals:
 * - Replacing a full CSS engine
 * - Applying inline styles at runtime
 */

import type { CSSelectorConfig } from './types';

/**
 * Internal cache for class application per element.
 */
const classApplicationCache = new WeakMap<HTMLElement, Set<string>>();

/**
 * `applyThemeClasses`
 *
 * Purpose:
 * Applies class based selector overrides for a theme.
 *
 * Behavior:
 * - Ignores selectors with empty class definitions
 * - Batches DOM work to keep UI responsive
 */
export function applyThemeClasses(
    themeName: string,
    selectors: Record<string, CSSelectorConfig>
): void {
    const entries = Object.entries(selectors);
    if (entries.length === 0) return;

    const applyEntry = ([selector, config]: [string, CSSelectorConfig]) => {
        if (!config.class) return;

        const classes = config.class.split(/\s+/).filter(Boolean);
        if (classes.length === 0) return;

        try {
            const elements = document.querySelectorAll(selector);

            elements.forEach((element) => {
                if (!(element instanceof HTMLElement)) return;

                // Track what we've added to avoid duplicates
                if (!classApplicationCache.has(element)) {
                    classApplicationCache.set(element, new Set());
                }

                const applied = classApplicationCache.get(element)!;
                const newClasses = classes.filter((c: string) => !applied.has(c));

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
    };

    if (import.meta.test) {
        for (const entry of entries) {
            applyEntry(entry);
        }
        return;
    }

    // Chunking execution to prevent frame drops
    let index = 0;

    const processChunk = () => {
        const start = performance.now();
        // 5ms budget per frame to keep UI responsive
        while (index < entries.length && performance.now() - start < 5) {
            const entry = entries[index++];
            if (!entry) break;
            applyEntry(entry);
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
 * `removeThemeClasses`
 *
 * Purpose:
 * Removes class based selector overrides from matched elements.
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
 * `loadThemeCSS`
 *
 * Purpose:
 * Loads a theme CSS file via a link tag.
 *
 * Constraints:
 * - No error is thrown when CSS is missing
 */
export async function loadThemeCSS(themeName: string): Promise<void> {
    // Check if CSS is already loaded
    const existingLink = document.querySelector(
        `link[data-theme-css="${themeName}"]`
    );

    if (existingLink) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
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
 * `unloadThemeCSS`
 *
 * Purpose:
 * Removes a previously loaded theme CSS link.
 */
export function unloadThemeCSS(themeName: string): void {
    const link = document.querySelector(`link[data-theme-css="${themeName}"]`);

    if (link) {
        link.remove();
    }
}
