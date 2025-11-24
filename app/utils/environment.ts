/**
 * Check if code is running in a browser environment.
 * @returns true if window object is defined (browser), false otherwise (SSR/SSG/Node)
 */
export function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

/**
 * Check if code is running in a browser environment with document access.
 * @returns true if both window and document are defined
 */
export function isBrowserWithDocument(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}
