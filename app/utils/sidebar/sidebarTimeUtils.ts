/**
 * Utility functions for sidebar time-based grouping and display.
 */

export type TimeGroup = 'today' | 'yesterday' | 'earlierThisWeek' | 'thisMonth' | 'older';

/**
 * Get the start of the day for a given timestamp (in seconds)
 */
export function getStartOfDay(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

/**
 * Get the start of the week for a given timestamp (in seconds)
 * Assumes week starts on Sunday
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
 * Get the start of the month for a given timestamp (in seconds)
 */
export function getStartOfMonth(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

/**
 * Compute the time group for a given timestamp (in seconds)
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
 * Get the label for a time group
 */
export function getTimeGroupLabel(group: TimeGroup): string {
    switch (group) {
        case 'today': return 'Today';
        case 'yesterday': return 'Yesterday';
        case 'earlierThisWeek': return 'Earlier this week';
        case 'thisMonth': return 'This month';
        case 'older': return 'Older';
    }
}

/**
 * Format a timestamp for display based on its time group
 */
export function formatTimeDisplay(timestamp: number, group: TimeGroup): string {
    const date = new Date(timestamp * 1000);
    
    switch (group) {
        case 'today':
        case 'yesterday':
            return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        case 'earlierThisWeek':
            return date.toLocaleDateString([], { weekday: 'long' });
        case 'thisMonth':
        case 'older':
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
}
