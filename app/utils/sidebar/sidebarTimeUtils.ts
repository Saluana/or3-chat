/**
 * @module app/utils/sidebar/sidebarTimeUtils
 *
 * Purpose:
 * Utilities for time-based grouping and display in the sidebar.
 *
 * Constraints:
 * - Timestamps are in seconds since epoch.
 */

export type TimeGroup =
    | 'today'
    | 'yesterday'
    | 'earlierThisWeek'
    | 'thisMonth'
    | 'older';

/**
 * `getStartOfDay`
 *
 * Purpose:
 * Returns the start of day timestamp for the given input.
 */
export function getStartOfDay(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

/**
 * `getStartOfWeek`
 *
 * Purpose:
 * Returns the start of week timestamp (Sunday-based).
 */
export function getStartOfWeek(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    const day = date.getDay();
    const diff = date.getDate() - day;
    const sunday = new Date(date.setDate(diff));
    sunday.setHours(0, 0, 0, 0);
    return Math.floor(sunday.getTime() / 1000);
}

/**
 * `getStartOfMonth`
 *
 * Purpose:
 * Returns the start of month timestamp for the given input.
 */
export function getStartOfMonth(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

/**
 * `computeTimeGroup`
 *
 * Purpose:
 * Classifies a timestamp into a sidebar grouping bucket.
 */
export function computeTimeGroup(timestamp: number): TimeGroup {
    const now = Date.now() / 1000;
    const todayStart = getStartOfDay(now);
    const yesterdayStart = todayStart - 86400;
    const weekStart = getStartOfWeek(now);
    const monthStart = getStartOfMonth(now);

    if (timestamp >= todayStart) return 'today';
    if (timestamp >= yesterdayStart) return 'yesterday';
    if (timestamp >= weekStart) return 'earlierThisWeek';
    if (timestamp >= monthStart) return 'thisMonth';
    return 'older';
}

/**
 * `getTimeGroupLabel`
 *
 * Purpose:
 * Returns a human-readable label for a time group.
 */
export function getTimeGroupLabel(group: TimeGroup): string {
    switch (group) {
        case 'today':
            return 'Today';
        case 'yesterday':
            return 'Yesterday';
        case 'earlierThisWeek':
            return 'This week';
        case 'thisMonth':
            return 'This month';
        case 'older':
            return 'Older';
    }
}

/**
 * `formatTimeDisplay`
 *
 * Purpose:
 * Formats a timestamp for display based on its group.
 */
export function formatTimeDisplay(timestamp: number, group: TimeGroup): string {
    const date = new Date(timestamp * 1000);

    switch (group) {
        case 'today':
        case 'yesterday':
            return date.toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
            });
        case 'earlierThisWeek':
            return date.toLocaleDateString([], { weekday: 'long' });
        case 'thisMonth':
        case 'older':
            return date.toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
            });
    }
}
