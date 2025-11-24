/**
 * Environment and browser capability detection utilities.
 * Use these to avoid duplicate SSR guards throughout the codebase.
 */

/**
 * Check if code is running in a browser environment (client-side).
 * Returns false during SSR.
 */
export const isBrowser = (): boolean => typeof window !== 'undefined';

/**
 * Check if localStorage is available.
 * Returns false during SSR or if localStorage is disabled.
 */
export const hasLocalStorage = (): boolean =>
    typeof localStorage !== 'undefined';

/**
 * Check if document is available.
 * Returns false during SSR.
 */
export const hasDocument = (): boolean => typeof document !== 'undefined';

/**
 * Check if navigator is available.
 * Returns false during SSR.
 */
export const hasNavigator = (): boolean => typeof navigator !== 'undefined';
