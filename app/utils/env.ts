/**
 * @module app/utils/env
 *
 * Purpose:
 * Environment and browser capability detection utilities used to avoid
 * duplicate SSR guards throughout the codebase.
 *
 * Constraints:
 * - These checks are intentionally conservative and return `false` during SSR.
 */

/**
 * `isBrowser`
 *
 * Purpose:
 * Returns true when running in a browser environment.
 */
export const isBrowser = (): boolean => typeof window !== 'undefined';

/**
 * `hasLocalStorage`
 *
 * Purpose:
 * Returns true when `localStorage` is available.
 */
export const hasLocalStorage = (): boolean =>
    typeof localStorage !== 'undefined';

/**
 * `hasDocument`
 *
 * Purpose:
 * Returns true when `document` is available.
 */
export const hasDocument = (): boolean => typeof document !== 'undefined';

/**
 * `hasNavigator`
 *
 * Purpose:
 * Returns true when `navigator` is available.
 */
export const hasNavigator = (): boolean => typeof navigator !== 'undefined';

/**
 * `isBrowserWithDocument`
 *
 * Purpose:
 * Returns true when both `window` and `document` are available.
 */
export const isBrowserWithDocument = (): boolean =>
    typeof window !== 'undefined' && typeof document !== 'undefined';
