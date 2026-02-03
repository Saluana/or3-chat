/**
 * @module app/utils/date
 *
 * Purpose:
 * Small date formatting helper for UI display.
 */

/**
 * `formatDate`
 *
 * Purpose:
 * Formats a date-like input into a short, locale-aware string.
 *
 * Behavior:
 * - Returns an empty string for invalid or missing dates
 * - Includes time when `includeTime` is true
 */
export function formatDate(date: number | string | Date | undefined | null, includeTime = false): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';

    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    };

    if (includeTime) {
        options.hour = 'numeric';
        options.minute = 'numeric';
    }

    return new Intl.DateTimeFormat('en-US', options).format(d);
}
