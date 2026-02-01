/**
 * Date formatting utilities for consistent date display across the application.
 */

/**
 * Format a timestamp for display.
 * @param timestamp - Unix timestamp in milliseconds
 * @param includeTime - Whether to include time in the output (default: false)
 * @returns Formatted date string using user's locale
 */
export function formatDate(timestamp: number, includeTime = false): string {
    const date = new Date(timestamp);
    return includeTime 
        ? date.toLocaleString() 
        : date.toLocaleDateString();
}

/**
 * Format a timestamp with a specific format.
 * @param timestamp - Unix timestamp in milliseconds
 * @param options - Intl.DateTimeFormatOptions for custom formatting
 * @returns Formatted date string
 */
export function formatDateWithOptions(
    timestamp: number,
    options?: Intl.DateTimeFormatOptions
): string {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, options);
}
