/**
 * Shared theme utilities used by both client and server plugins
 * Consolidates duplicated logic to reduce code bloat
 */

import { THEME_NAME_PATTERN } from './constants';

// ============================================================================
// Deep Clone / Merge Utilities
// ============================================================================

/**
 * Deep clone a value using structuredClone when available, falling back to JSON
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
 * Deep merge patch into base object (mutates base)
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
 * Recursively update target with source values (in-place mutation)
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

// ============================================================================
// Theme Name Validation
// ============================================================================

/**
 * Validate and sanitize a theme name
 * Returns null if the theme name is invalid or not available
 */
export function sanitizeThemeName(
    themeName: string | null,
    availableThemes: Set<string>
): string | null {
    if (!themeName) return null;
    const normalized = themeName.trim().toLowerCase();
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
