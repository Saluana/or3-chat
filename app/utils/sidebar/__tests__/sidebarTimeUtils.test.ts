import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    computeTimeGroup,
    getTimeGroupLabel,
    formatTimeDisplay,
} from '../sidebarTimeUtils';

describe('sidebarTimeUtils', () => {
    // Mock "now" to 2024-01-19 12:00:00 (Friday)
    const now = new Date('2024-01-19T12:00:00Z').getTime();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('computeTimeGroup', () => {
        it('identifies today', () => {
            const today = new Date('2024-01-19T08:00:00Z').getTime() / 1000;
            expect(computeTimeGroup(today)).toBe('today');
        });

        it('identifies yesterday', () => {
            const yesterday = new Date('2024-01-18T08:00:00Z').getTime() / 1000;
            expect(computeTimeGroup(yesterday)).toBe('yesterday');
        });

        it('identifies earlier this week', () => {
            // Monday of the same week
            const earlier = new Date('2024-01-15T08:00:00Z').getTime() / 1000;
            expect(computeTimeGroup(earlier)).toBe('earlierThisWeek');
        });

        it('identifies this month', () => {
            const thisMonth = new Date('2024-01-05T08:00:00Z').getTime() / 1000;
            expect(computeTimeGroup(thisMonth)).toBe('thisMonth');
        });

        it('identifies older', () => {
            const older = new Date('2023-12-15T08:00:00Z').getTime() / 1000;
            expect(computeTimeGroup(older)).toBe('older');
        });
    });

    describe('getTimeGroupLabel', () => {
        it('returns correct labels', () => {
            expect(getTimeGroupLabel('today')).toBe('Today');
            expect(getTimeGroupLabel('yesterday')).toBe('Yesterday');
            expect(getTimeGroupLabel('earlierThisWeek')).toBe('This week');
            expect(getTimeGroupLabel('thisMonth')).toBe('This month');
            expect(getTimeGroupLabel('older')).toBe('Older');
        });
    });

    describe('formatTimeDisplay', () => {
        it('formats today as time', () => {
            const ts = new Date('2024-01-15T08:30:00Z').getTime() / 1000;
            expect(formatTimeDisplay(ts, 'today')).toMatch(
                /\d{1,2}:\d{2}(\s?(AM|PM))?/i
            );
        });

        it('formats older as date', () => {
            const ts = new Date('2023-12-15T08:30:00Z').getTime() / 1000;
            expect(formatTimeDisplay(ts, 'older')).toMatch(
                /[A-Z][a-z]{2}\s\d{1,2}/
            ); // e.g. Dec 15
        });
    });
});
