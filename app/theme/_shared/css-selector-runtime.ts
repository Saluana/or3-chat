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
export interface ThemeClassSession {
    cancel(): void;
    remove(): void;
}

const activeSessions = new Map<string, ThemeClassSession>();

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
): ThemeClassSession {
    activeSessions.get(themeName)?.remove();
    const entries = Object.entries(selectors);
    const owned = new Map<HTMLElement, Set<string>>();
    let cancelled = false;
    let frame: number | ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;

    const addClasses = (element: Element, classes: string[]) => {
        if (!(element instanceof HTMLElement) || cancelled) return;
        let additions = owned.get(element);
        if (!additions) {
            additions = new Set();
            owned.set(element, additions);
        }
        for (const className of classes) {
            if (!element.classList.contains(className)) {
                element.classList.add(className);
                additions.add(className);
            }
        }
    };

    const applyEntry = ([selector, config]: [string, CSSelectorConfig]) => {
        if (!config.class) return;

        const classes = config.class.split(/\s+/).filter(Boolean);
        if (classes.length === 0) return;

        try {
            const elements = document.querySelectorAll(selector);

            elements.forEach((element) => addClasses(element, classes));
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Invalid CSS selector: "${selector}"`,
                    error
                );
            }
        }
    };

    const session: ThemeClassSession = {
        cancel() {
            cancelled = true;
            observer?.disconnect();
            observer = null;
            if (frame !== null) {
                if (typeof frame === 'number' && typeof cancelAnimationFrame !== 'undefined') {
                    cancelAnimationFrame(frame);
                } else {
                    clearTimeout(frame as ReturnType<typeof setTimeout>);
                }
                frame = null;
            }
        },
        remove() {
            this.cancel();
            for (const [element, classes] of owned) {
                for (const className of classes) element.classList.remove(className);
            }
            owned.clear();
            if (activeSessions.get(themeName) === session) {
                activeSessions.delete(themeName);
            }
        },
    };
    activeSessions.set(themeName, session);

    if (entries.length === 0) return session;

    const observeAdditions = () => {
        if (typeof MutationObserver === 'undefined' || cancelled) return;
        observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    for (const [selector, config] of entries) {
                        const classes = config.class?.split(/\s+/).filter(Boolean) ?? [];
                        if (classes.length === 0) continue;
                        try {
                            if (node.matches(selector)) addClasses(node, classes);
                            node.querySelectorAll(selector).forEach((el) => addClasses(el, classes));
                        } catch {
                            // Invalid selectors are already reported during the initial pass.
                        }
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    };

    if (import.meta.test) {
        for (const entry of entries) {
            applyEntry(entry);
        }
        observeAdditions();
        return session;
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
                frame = requestAnimationFrame(processChunk);
            } else {
                frame = setTimeout(processChunk, 0);
            }
        } else {
            observeAdditions();
        }
    };

    processChunk();
    return session;
}

/**
 * `removeThemeClasses`
 *
 * Purpose:
 * Removes class based selector overrides from matched elements.
 */
export function removeThemeClasses(
    themeName: string
): void {
    activeSessions.get(themeName)?.remove();
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
        link.href = import.meta.dev
            ? `/themes/${themeName}.css?t=${Date.now()}`
            : `/themes/${themeName}.css`;
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
