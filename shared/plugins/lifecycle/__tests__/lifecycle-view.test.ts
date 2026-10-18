import { describe, expect, it } from 'vitest';
import {
    ACTIVATION_CONFIRMATION_TIMEOUT_MS,
    describePluginStatus,
} from '../lifecycle-view';

const SELECTED = {
    pluginId: 'or3-tasks',
    version: '1.2.0',
    packageTreeSha256: 'sha256-aaa',
    manifestSha256: 'sha256-bbb',
    source: 'instance-selection' as const,
};

describe('activation confirmation timeout', () => {
    it('keeps the 30s timeout constant', () => {
        expect(ACTIVATION_CONFIRMATION_TIMEOUT_MS).toBe(30_000);
    });
});

describe('describePluginStatus', () => {
    const base = {
        selected: SELECTED,
        acquisition: null,
        runtime: { state: 'not-observed' as const },
        activationTimedOut: false,
    };

    it('identifies the first prerequisite without claiming the browser is active', () => {
        expect(describePluginStatus(base, { enabled: false, siteApproval: 'required', grantReview: 'required', setup: 'required', packageReady: true }).state).toBe('needs-site-approval');
        expect(describePluginStatus(base, { enabled: false, siteApproval: 'approved', grantReview: 'required', setup: 'required', packageReady: true })).toMatchObject({ state: 'disabled', action: 'enable' });
        expect(describePluginStatus(base, { enabled: false, siteApproval: 'approved', grantReview: 'current', setup: 'required', packageReady: true })).toMatchObject({ state: 'disabled', action: 'enable' });
        expect(describePluginStatus(base, { enabled: false, siteApproval: 'approved', grantReview: 'current', setup: 'ready', packageReady: true }).state).toBe('ready-to-enable');
        expect(describePluginStatus(base, { enabled: true, siteApproval: 'approved', grantReview: 'required', setup: 'required', packageReady: true }).state).toBe('needs-permissions');
        expect(describePluginStatus(base, { enabled: true, siteApproval: 'approved', grantReview: 'current', setup: 'required', packageReady: true }).state).toBe('needs-setup');
        expect(describePluginStatus(base, { enabled: true, siteApproval: 'approved', grantReview: 'current', setup: 'ready', packageReady: true }).state).toBe('enabled-unconfirmed');
    });

    it('keeps unknown prerequisites explicit and preserves a failed current release', () => {
        expect(describePluginStatus(base, { enabled: false, siteApproval: 'unknown', grantReview: 'unknown', setup: 'unknown', packageReady: true })).toMatchObject({ state: 'disabled', action: null });
        expect(describePluginStatus(base, { enabled: true, siteApproval: 'unknown', grantReview: 'unknown', setup: 'unknown', packageReady: true })).toMatchObject({ state: 'enabled-unconfirmed', action: 'retry-check' });
        expect(describePluginStatus(base, { enabled: true, siteApproval: 'approved', grantReview: 'current', setup: 'ready', packageReady: false }).state).toBe('needs-attention');
        expect(describePluginStatus({ ...base, runtime: { state: 'failed', code: 'worker-startup' } }, { enabled: true, siteApproval: 'approved', grantReview: 'current', setup: 'ready', packageReady: true }).state).toBe('needs-attention');
    });

    it('requires exact runtime identity before reporting active', () => {
        const inputs = { enabled: true, siteApproval: 'approved' as const, grantReview: 'current' as const, setup: 'ready' as const, packageReady: true };
        expect(describePluginStatus({ ...base, runtime: { state: 'running', identity: { ...SELECTED, packageTreeSha256: 'sha256-other' }, observedAt: new Date(0).toISOString(), degradedContributions: [] } }, inputs).state).toBe('enabled-unconfirmed');
        expect(describePluginStatus({ ...base, runtime: { state: 'running', identity: SELECTED, observedAt: new Date(0).toISOString(), degradedContributions: [] } }, inputs).state).toBe('active');
    });
});
