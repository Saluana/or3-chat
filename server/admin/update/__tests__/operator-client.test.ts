import { describe, expect, it } from 'vitest';
import { DashboardOperatorError, validateDashboardUpdateStatus } from '../operator-client';

const validStatus = {
    kind: 'managed',
    enabled: true,
    currentVersion: '0.1.39',
    checkedAt: '2026-08-13T12:00:00.000Z',
    latestVersion: '0.1.40',
    updateAvailable: true,
    job: null,
} as const;

describe('dashboard operator response validation', () => {
    it('accepts the exact managed status contract', () => {
        expect(validateDashboardUpdateStatus(validStatus)).toEqual(validStatus);
    });

    it.each([
        { ...validStatus, injected: true },
        { ...validStatus, currentVersion: '../latest' },
        { ...validStatus, job: { id: 'not-a-request-id' } },
        { ...validStatus, checkError: 'x'.repeat(4097) },
    ])('rejects malformed or oversized operator state', (value) => {
        expect(() => validateDashboardUpdateStatus(value)).toThrow(DashboardOperatorError);
    });
});
