import { describe, expect, it } from 'vitest';
import {
    DashboardOperatorError,
    validateDashboardUpdatePreview,
    validateDashboardUpdateStatus,
} from '../operator-client';

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

    it('accepts the additive protocol-2 status with a bounded receipt', () => {
        const v2 = {
            ...validStatus,
            protocolVersion: 2,
            receipt: {
                schemaVersion: 1,
                warnings: [{ code: 'retention-failed', message: 'preserved 2 entries' }],
                checks: [{ code: 'deep-health', status: 'passed', detail: 'ok' }],
                operatorHandoff: 'needs-attention',
            },
        };
        expect(validateDashboardUpdateStatus(v2)).toEqual(v2);
    });

    it('still accepts the protocol-1 shape without protocolVersion or receipt', () => {
        expect(validateDashboardUpdateStatus(validStatus)).toEqual(validStatus);
    });

    it.each([
        { ...validStatus, protocolVersion: 3 },
        { ...validStatus, protocolVersion: 2, receipt: { schemaVersion: 1, warnings: 'not-an-array' } },
        { ...validStatus, protocolVersion: 2, receipt: { schemaVersion: 1, warnings: [{ code: 'x', message: 'y'.repeat(4097) }] } },
    ])('rejects oversized or out-of-range protocol-2 status', (value) => {
        expect(() => validateDashboardUpdateStatus(value)).toThrow(DashboardOperatorError);
    });

    it('accepts a bounded protocol-2 preview and rejects unbounded or unsupported shapes', () => {
        const preview = {
            protocolVersion: 2,
            preview: {
                version: '0.1.40',
                assessment: {
                    schemaVersion: 1,
                    observedAt: '2026-08-13T12:00:00.000Z',
                    target: { appVersion: '0.1.40', image: 'ghcr.io/saluana/or3-chat:0.1.40', imageDigest: 'sha256:x' },
                    checks: [{ code: 'image-pull', status: 'deferred', detail: 'execution time' }],
                    findings: [{ code: 'operation-incomplete', severity: 'blocker', message: 'recover first' }],
                    retention: { keep: [], remove: [], preserve: [], canPrune: true },
                    stateFingerprint: 'abc123',
                },
            },
        };
        expect(validateDashboardUpdatePreview(preview)).toEqual(preview);
        expect(() => validateDashboardUpdatePreview({ ...preview, protocolVersion: 1 })).toThrow(DashboardOperatorError);
        expect(() => validateDashboardUpdatePreview({
            ...preview,
            preview: { ...preview.preview, assessment: { ...preview.preview.assessment, findings: Array.from({ length: 65 }, () => ({ code: 'x', severity: 'info', message: 'y' })) } },
        })).toThrow(DashboardOperatorError);
    });
});
