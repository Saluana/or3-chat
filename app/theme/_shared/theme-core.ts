/**
 * @module app/theme/_shared/theme-core
 *
 * Purpose:
 * Shared theme utilities used by client and server plugins.
 *
 * Behavior:
 * - Provides deep clone and merge helpers
 * - Loads and compiles themes with runtime caches
 *
 * Constraints:
 * - Theme loading depends on the theme manifest
 * - Runtime operations may differ between client and server
 */

import { THEME_NAME_PATTERN } from './constants';

// ============================================================================
// Deep Clone / Merge Utilities
// ============================================================================

/**
 * `cloneDeep`
 *
 * Purpose:
 * Deep clones a value using structuredClone with JSON fallback.
 *
 * Constraints:
 * - JSON fallback drops functions and non-serializable values
 */
export function cloneDeep<T>(value: T): T {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof globalThis.structuredClone === 'function') {
        try {
            return globalThis.structuredClone(value);
        } catch {
            // ignore - fall through to JSON method
        }
    }

    return JSON.parse(JSON.stringify(value));
}

/**
 * `deepMerge`
 *
 * Purpose:
 * Deep merges a patch into a base object.
 *
 * Constraints:
 * - Mutates the base object
 */
export function deepMerge(
    base: Record<string, unknown>,
    patch?: Record<string, unknown>
): Record<string, unknown> {
    if (!patch) {
        return base;
    }

    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const current = base[key] as Record<string, unknown> | undefined;
            base[key] = deepMerge(
                current &&
                    typeof current === 'object' &&
                    !Array.isArray(current)
                    ? current
                    : {},
                value as Record<string, unknown>
            );
        } else if (value !== undefined) {
            base[key] = value;
        }
    }

    return base;
}

/**
 * `recursiveUpdate`
 *
 * Purpose:
 * Recursively updates target with source values.
 */
export function recursiveUpdate(
    target: Record<string, unknown>,
    source: Record<string, unknown>
): void {
    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) {
            const targetValue = target[key];
            if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                targetValue &&
                typeof targetValue === 'object' &&
                !Array.isArray(targetValue)
            ) {
                recursiveUpdate(
                    targetValue as Record<string, unknown>,
                    value as Record<string, unknown>
                );
            } else {
                target[key] = value;
            }
        }
    }
}

/** Build a theme's app config from an immutable base snapshot. */
export function computeEffectiveAppConfig(
    base: Record<string, unknown>,
    options: {
        appPatch?: Record<string, unknown> | null;
        uiPatch?: Record<string, unknown> | null;
    } = {}
): Record<string, unknown> {
    const effective = deepMerge(cloneDeep(base), options.appPatch ?? undefined);
    if (options.uiPatch) {
        const baseUi =
            effective.ui &&
            typeof effective.ui === 'object' &&
            !Array.isArray(effective.ui)
                ? (effective.ui as Record<string, unknown>)
                : {};
        effective.ui = deepMerge(baseUi, options.uiPatch);
    }
    return effective;
}

/** Replace a reactive object while deleting keys absent from the next value. */
export function replaceReactiveObject(
    target: Record<string, unknown>,
    source: Record<string, unknown>
): void {
    for (const key of Object.keys(target)) {
        if (!(key in source)) delete target[key];
    }
    for (const [key, value] of Object.entries(source)) {
        const current = target[key];
        if (
            current &&
            value &&
            typeof current === 'object' &&
            typeof value === 'object' &&
            !Array.isArray(current) &&
            !Array.isArray(value)
        ) {
            replaceReactiveObject(
                current as Record<string, unknown>,
                value as Record<string, unknown>
            );
        } else {
            target[key] = cloneDeep(value);
        }
    }
}

// ============================================================================
// Theme Name Validation
// ============================================================================

/**
 * `sanitizeThemeName`
 *
 * Purpose:
 * Validates a theme name and checks availability.
 */
export function sanitizeThemeName(
    themeName: string | null,
    availableThemes: Set<string>
): string | null {
    if (!themeName) return null;
    const normalized = themeName.toLowerCase();
    if (!THEME_NAME_PATTERN.test(normalized)) return null;
    if (!availableThemes.has(normalized)) return null;
    return normalized;
}

// ============================================================================
// Cookie Utilities
// ============================================================================

/**
 * Read a cookie value from a cookie header string (works on server and client)
 */
export function readCookie(
    cookieHeader: string | undefined,
    cookieName: string
): string | null {
    if (!cookieHeader) return null;

    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
        const [rawName, ...rest] = pair.trim().split('=');
        if (rawName === cookieName) {
            return decodeURIComponent(rest.join('='));
        }
    }

    return null;
}
