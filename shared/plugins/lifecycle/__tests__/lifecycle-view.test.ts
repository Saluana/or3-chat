import { describe, expect, it } from 'vitest';
import {
    ACTIVATION_CONFIRMATION_TIMEOUT_MS,
    ACTIVATION_NOT_CONFIRMED_COPY,
    describeLifecycleBadge,
    describePluginStatus,
    observationMatchesSelection,
} from '../lifecycle-view';

const SELECTED = {
    pluginId: 'or3-tasks',
    version: '1.2.0',
    packageTreeSha256: 'sha256-aaa',
    manifestSha256: 'sha256-bbb',
    source: 'instance-selection' as const,
};

describe('observationMatchesSelection', () => {
    it('accepts the exact package in the same workspace and generation', () => {
        expect(
            observationMatchesSelection({
                observed: { ...SELECTED },
                observedWorkspaceId: 'ws-1',
                observedGeneration: 7,
                selected: { ...SELECTED },
                selectedWorkspaceId: 'ws-1',
                selectedGeneration: 7,
            })
        ).toBe(true);
    });

    it('rejects a matching version with a different digest', () => {
        expect(
            observationMatchesSelection({
                observed: { ...SELECTED, packageTreeSha256: 'sha256-other' },
                observedWorkspaceId: 'ws-1',
                observedGeneration: 7,
                selected: { ...SELECTED },
                selectedWorkspaceId: 'ws-1',
                selectedGeneration: 7,
            })
        ).toBe(false);
    });

    it('rejects another workspace generation', () => {
        expect(
            observationMatchesSelection({
                observed: { ...SELECTED },
                observedWorkspaceId: 'ws-1',
                observedGeneration: 8,
                selected: { ...SELECTED },
                selectedWorkspaceId: 'ws-1',
                selectedGeneration: 7,
            })
        ).toBe(false);
    });

    it('rejects another plugin or workspace', () => {
        expect(
            observationMatchesSelection({
                observed: { ...SELECTED, pluginId: 'other' },
                observedWorkspaceId: 'ws-1',
                observedGeneration: 7,
                selected: { ...SELECTED },
                selectedWorkspaceId: 'ws-1',
                selectedGeneration: 7,
            })
        ).toBe(false);
        expect(
            observationMatchesSelection({
                observed: { ...SELECTED },
                observedWorkspaceId: 'ws-2',
                observedGeneration: 7,
                selected: { ...SELECTED },
                selectedWorkspaceId: 'ws-1',
                selectedGeneration: 7,
            })
        ).toBe(false);
    });
});

describe('describeLifecycleBadge', () => {
    it('never reports running from acquisition completion alone', () => {
        const badge = describeLifecycleBadge(
            {
                selected: SELECTED,
                acquisition: null,
                runtime: { state: 'not-observed' },
                activationTimedOut: true,
            },
            { enabled: true, isDevelopmentCandidate: false }
        );
        expect(badge.label).toBe(ACTIVATION_NOT_CONFIRMED_COPY);
        expect(badge.state).toBe('activation-not-confirmed');
    });

    it('labels development candidates distinctly', () => {
        const badge = describeLifecycleBadge(
            {
                selected: SELECTED,
                acquisition: null,
                runtime: {
                    state: 'running',
                    identity: SELECTED,
                    observedAt: new Date(0).toISOString(),
                    degradedContributions: [],
                },
                activationTimedOut: false,
            },
            { enabled: true, isDevelopmentCandidate: true }
        );
        expect(badge.state).toBe('development-candidate');
    });

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
