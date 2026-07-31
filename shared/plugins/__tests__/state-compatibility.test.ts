import { describe, expect, it } from 'vitest';
import {
    buildPluginUpdateExplanation,
    preflightPluginStateCompatibility,
    type PluginStateCompatibilityPolicy,
} from '../state-compatibility';

function policy(
    overrides: Partial<PluginStateCompatibilityPolicy> = {}
): PluginStateCompatibilityPolicy {
    return {
        version: 2,
        reads: { minimum: 1, maximum: 2 },
        rollback: 'safe',
        ...overrides,
    };
}

describe('plugin state compatibility preflight', () => {
    it('allows initialization and readable upgrades without mutation', () => {
        const target = policy();
        const before = structuredClone(target);
        const install = preflightPluginStateCompatibility({
            operation: 'install',
            storedStateVersion: null,
            target,
        });
        const upgrade = preflightPluginStateCompatibility({
            operation: 'upgrade',
            storedStateVersion: 1,
            target,
        });

        expect(install).toMatchObject({
            status: 'eligible',
            code: 'state-initialization',
            mutatesState: false,
        });
        expect(upgrade).toMatchObject({
            status: 'eligible',
            code: 'state-compatible',
            mutatesState: false,
        });
        expect(target).toEqual(before);
        expect(Object.isFrozen(upgrade)).toBe(true);
    });

    it('blocks an upgrade that cannot read stored state', () => {
        expect(
            preflightPluginStateCompatibility({
                operation: 'upgrade',
                storedStateVersion: 3,
                target: policy(),
            })
        ).toMatchObject({
            status: 'blocked',
            code: 'state-version-unreadable',
            mutatesState: false,
        });
    });

    it('clearly distinguishes migration-required and unsupported rollback', () => {
        const target = policy({ version: 1, reads: { minimum: 1, maximum: 1 } });
        const migration = preflightPluginStateCompatibility({
            operation: 'rollback',
            storedStateVersion: 2,
            current: policy({ rollback: 'migration-required' }),
            target,
        });
        const unsupported = preflightPluginStateCompatibility({
            operation: 'rollback',
            storedStateVersion: 2,
            current: policy({ rollback: 'unsupported' }),
            target,
        });

        expect(migration).toMatchObject({
            status: 'migration-required',
            code: 'rollback-migration-required',
            mutatesState: false,
        });
        expect(unsupported).toMatchObject({
            status: 'blocked',
            code: 'rollback-unsupported',
            mutatesState: false,
        });
    });

    it('blocks safe rollback when the previous package cannot read current state', () => {
        expect(
            preflightPluginStateCompatibility({
                operation: 'rollback',
                storedStateVersion: 2,
                current: policy({ rollback: 'safe' }),
                target: policy({ version: 1, reads: { minimum: 1, maximum: 1 } }),
            })
        ).toMatchObject({
            status: 'blocked',
            code: 'state-version-unreadable',
        });
    });
});

describe('plugin update explanation', () => {
    it('explains an eligible update', () => {
        const state = preflightPluginStateCompatibility({
            operation: 'upgrade',
            storedStateVersion: 1,
            target: policy(),
        });

        expect(
            buildPluginUpdateExplanation({
                pluginId: 'acme.search',
                currentPackageVersion: '1.0.0',
                candidatePackageVersion: '2.0.0',
                state,
                grantReviewStatus: 'current',
            })
        ).toMatchObject({
            canProceed: true,
            requiresMigration: false,
            headline: 'Update to 2.0.0 is eligible',
        });
    });

    it('combines state, verification, and grant blockers for admin display', () => {
        const state = preflightPluginStateCompatibility({
            operation: 'rollback',
            storedStateVersion: 2,
            current: policy({ rollback: 'unsupported' }),
            target: policy({ version: 1 }),
        });
        const explanation = buildPluginUpdateExplanation({
            pluginId: 'acme.search',
            currentPackageVersion: '2.0.0',
            candidatePackageVersion: '1.0.0',
            state,
            verificationBlockCodes: ['dependency-version-mismatch'],
            grantReviewStatus: 'stale',
        });

        expect(explanation).toMatchObject({
            operation: 'rollback',
            canProceed: false,
            headline: 'Rollback to 1.0.0 is blocked',
        });
        expect(explanation.reasons.map((reason) => reason.code)).toEqual([
            'rollback-unsupported',
            'dependency-version-mismatch',
            'grant-review-stale',
        ]);
        expect(Object.isFrozen(explanation.reasons)).toBe(true);
    });
});
