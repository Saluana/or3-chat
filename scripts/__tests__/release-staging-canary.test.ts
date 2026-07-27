import { describe, expect, it } from 'vitest';
import {
    runStagingCanary,
    validateProductionTopology,
    type StagingCanaryConfig,
} from '../release/staging-canary-core';

function config(): StagingCanaryConfig {
    return {
        baseUrl: 'https://staging.test',
        artifact: {
            candidate: 'sha256:candidate',
            previous: 'sha256:previous',
            providerDataSnapshot: 'snapshot-42',
        },
        topology: {
            instances: 2,
            syncProvider: 'convex',
            storageProvider: 's3',
            backgroundProvider: 'convex',
            viewerSuppressionRequiredForCorrectness: false,
        },
        shortSoakCycles: 3,
        scenarios: {
            auth: [
                {
                    id: 'auth',
                    path: '/auth',
                    expect: {
                        status: 200,
                        json: { authenticated: true },
                    },
                },
            ],
            sync: [
                {
                    id: 'sync-start',
                    method: 'POST',
                    path: '/sync/start',
                    expect: { status: 202 },
                },
            ],
            storage: [
                {
                    id: 'storage',
                    path: '/storage',
                    expect: { json: { checksumVerified: true } },
                },
            ],
            backgroundJobs: [
                {
                    id: 'job-start',
                    method: 'POST',
                    path: '/jobs/start',
                    expect: { status: 202 },
                },
            ],
            backupRestore: [
                {
                    id: 'backup-restore',
                    path: '/backup',
                    expect: { json: { restored: true } },
                },
            ],
            rollback: [
                {
                    id: 'rollback',
                    path: '/rollback',
                    expect: {
                        json: {
                            restoredPreviousArtifact: true,
                            restoredProviderSnapshot: true,
                        },
                    },
                },
            ],
            rollingRestart: [
                {
                    id: 'restart-a',
                    method: 'POST',
                    path: '/instances/a/restart',
                    instance: 'a',
                },
                {
                    id: 'sync-after-restart',
                    path: '/sync/assert',
                    instance: 'b',
                    expect: { json: { converged: true } },
                },
                {
                    id: 'job-after-restart',
                    path: '/jobs/assert',
                    instance: 'b',
                    expect: { json: { complete: true } },
                },
            ],
            failureInjection: [
                {
                    id: 'convex-fault',
                    path: '/fault/convex',
                    faultTarget: 'convex',
                    faultPhase: 'inject',
                    expect: { status: 503 },
                },
                {
                    id: 'convex-recovery',
                    path: '/fault/recovered',
                    faultTarget: 'convex',
                    faultPhase: 'recover',
                    expect: { json: { recovered: true } },
                },
                {
                    id: 'object-storage-fault',
                    path: '/fault/object-storage',
                    faultTarget: 'object-storage',
                    faultPhase: 'inject',
                    expect: { status: 503 },
                },
                {
                    id: 'object-storage-recovery',
                    path: '/fault/recovered',
                    faultTarget: 'object-storage',
                    faultPhase: 'recover',
                    expect: { json: { recovered: true } },
                },
                {
                    id: 'openrouter-fault',
                    path: '/fault/openrouter',
                    faultTarget: 'openrouter',
                    faultPhase: 'inject',
                    expect: { status: 502 },
                },
                {
                    id: 'openrouter-recovery',
                    path: '/fault/recovered',
                    faultTarget: 'openrouter',
                    faultPhase: 'recover',
                    expect: { json: { recovered: true } },
                },
                {
                    id: 'network-partition',
                    path: '/fault/network-partition',
                    faultTarget: 'network-partition',
                    faultPhase: 'inject',
                    expect: { status: 503 },
                },
                {
                    id: 'network-recovery',
                    path: '/fault/recovered',
                    faultTarget: 'network-partition',
                    faultPhase: 'recover',
                    expect: { json: { recovered: true } },
                },
                {
                    id: 'partial-outage-recovery',
                    path: '/fault/partial-recovery',
                    faultTarget: 'partial-provider-outage',
                    faultPhase: 'inject',
                    expect: { json: { recovered: true } },
                },
                {
                    id: 'partial-outage-recovery',
                    path: '/fault/recovered',
                    faultTarget: 'partial-provider-outage',
                    faultPhase: 'recover',
                    expect: { json: { recovered: true } },
                },
            ],
            shortSoak: [
                {
                    id: 'soak-a',
                    path: '/soak',
                    instance: 'a',
                    expect: { json: { healthy: true } },
                },
                {
                    id: 'soak-b',
                    path: '/soak',
                    instance: 'b',
                    expect: { json: { healthy: true } },
                },
            ],
        },
    };
}

function json(value: unknown, status = 200): Response {
    return Response.json(value, { status });
}

describe('staging release canary', () => {
    it('records deterministic evidence for an active sync/job rolling restart', async () => {
        let syncActive = false;
        let jobActive = false;
        let restarted = false;
        const calls: string[] = [];
        const fetchImpl: typeof fetch = async (input, init) => {
            const url = new URL(String(input));
            calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
            if (url.pathname === '/api/health') {
                return json({
                    status: 'ok',
                    providers: {
                        auth: { available: true },
                        sync: { available: true },
                        storage: { available: true },
                    },
                });
            }
            if (url.pathname === '/auth') return json({ authenticated: true });
            if (url.pathname === '/sync/start') {
                syncActive = true;
                return json({}, 202);
            }
            if (url.pathname === '/jobs/start') {
                jobActive = true;
                return json({}, 202);
            }
            if (url.pathname === '/instances/a/restart') {
                restarted = true;
                return json({});
            }
            if (url.pathname === '/sync/assert') {
                return json({ converged: syncActive && restarted });
            }
            if (url.pathname === '/jobs/assert') {
                return json({ complete: jobActive && restarted });
            }
            if (url.pathname === '/storage') {
                return json({ checksumVerified: true });
            }
            if (url.pathname === '/backup') return json({ restored: true });
            if (url.pathname === '/rollback') {
                return json({
                    restoredPreviousArtifact: true,
                    restoredProviderSnapshot: true,
                });
            }
            if (url.pathname === '/fault/convex') return json({}, 503);
            if (url.pathname === '/fault/object-storage') return json({}, 503);
            if (url.pathname === '/fault/openrouter') return json({}, 502);
            if (url.pathname === '/fault/network-partition') return json({}, 503);
            if (url.pathname === '/fault/partial-recovery') {
                return json({ recovered: true });
            }
            if (url.pathname === '/fault/recovered') {
                return json({ recovered: true });
            }
            if (url.pathname === '/soak') return json({ healthy: true });
            return json({ error: 'not found' }, 404);
        };

        const evidence = await runStagingCanary(config(), {
            fetchImpl,
            now: () => new Date('2026-07-27T00:00:00.000Z'),
        });

        expect(evidence.status).toBe('passed');
        expect(evidence.summary.failed).toBe(0);
        expect(evidence.summary.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(
            evidence.steps.filter(
                (step) => step.scenario === 'rollingRestart'
            )
        ).toHaveLength(3);
        expect(calls).toContain('GET /api/health');
        expect(
            evidence.steps.filter((step) => step.scenario === 'shortSoak')
        ).toHaveLength(6);
        expect(
            evidence.steps.filter((step) => step.scenario === 'failureInjection')
        ).toHaveLength(10);
    });

    it('fails closed and records a mismatched staged assertion', async () => {
        const fetchImpl: typeof fetch = async (input) => {
            const path = new URL(String(input)).pathname;
            if (path === '/api/health') return json({ status: 'ok' });
            if (path === '/storage') {
                return json({ checksumVerified: false });
            }
            if (path.endsWith('/start')) return json({}, 202);
            if (path === '/auth') return json({ authenticated: true });
            if (path === '/backup') return json({ restored: true });
            if (path === '/rollback') {
                return json({
                    restoredPreviousArtifact: true,
                    restoredProviderSnapshot: true,
                });
            }
            if (path === '/fault/convex') return json({}, 503);
            if (path === '/fault/object-storage') return json({}, 503);
            if (path === '/fault/openrouter') return json({}, 502);
            if (path === '/fault/network-partition') return json({}, 503);
            if (path === '/fault/partial-recovery') {
                return json({ recovered: true });
            }
            if (path === '/fault/recovered') return json({ recovered: true });
            if (path === '/soak') return json({ healthy: true });
            if (path === '/sync/assert') return json({ converged: true });
            if (path === '/jobs/assert') return json({ complete: true });
            return json({});
        };

        const evidence = await runStagingCanary(config(), { fetchImpl });
        expect(evidence.status).toBe('failed');
        expect(evidence.steps).toContainEqual(
            expect.objectContaining({
                id: 'storage',
                status: 'failed',
                error: expect.stringContaining('checksumVerified'),
            })
        );
    });

    it('fails evidence when a rolling restart never reaches another instance', async () => {
        const candidate = config();
        candidate.scenarios.rollingRestart = [
            {
                id: 'restart-only-instance',
                method: 'POST',
                path: '/instances/a/restart',
                instance: 'a',
            },
        ];
        const evidence = await runStagingCanary(candidate, {
            fetchImpl: async (input) => {
                const path = new URL(String(input)).pathname;
                if (path === '/api/health') return json({ status: 'ok' });
                if (path.endsWith('/start')) return json({}, 202);
                if (path === '/auth') return json({ authenticated: true });
                if (path === '/storage') {
                    return json({ checksumVerified: true });
                }
                if (path === '/backup') return json({ restored: true });
                if (path === '/rollback') {
                    return json({
                        restoredPreviousArtifact: true,
                        restoredProviderSnapshot: true,
                    });
                }
                if (path === '/fault/convex') return json({}, 503);
                if (path === '/fault/object-storage') return json({}, 503);
                if (path === '/fault/openrouter') return json({}, 502);
                if (path === '/fault/network-partition') return json({}, 503);
                if (path === '/fault/partial-recovery') {
                    return json({ recovered: true });
                }
                if (path === '/fault/recovered') {
                    return json({ recovered: true });
                }
                if (path === '/soak') return json({ healthy: true });
                return json({});
            },
        });

        expect(evidence.status).toBe('failed');
        expect(evidence.topologyErrors).toContain(
            'rolling-restart evidence must exercise at least two named instances'
        );
    });

    it('rejects unbounded soak and incomplete failure-injection matrices', async () => {
        const tooLong = config();
        tooLong.shortSoakCycles = 26;
        await expect(runStagingCanary(tooLong)).rejects.toThrow(
            'shortSoakCycles must be an integer between 2 and 25'
        );

        const missingFault = config();
        missingFault.scenarios.failureInjection =
            missingFault.scenarios.failureInjection.filter(
                (step) => step.faultTarget !== 'openrouter'
            );
        await expect(runStagingCanary(missingFault)).rejects.toThrow(
            'failureInjection is missing targets: openrouter'
        );

        const missingRecovery = config();
        missingRecovery.scenarios.failureInjection =
            missingRecovery.scenarios.failureInjection.filter(
                (step) =>
                    !(
                        step.faultTarget === 'convex' &&
                        step.faultPhase === 'recover'
                    )
            );
        await expect(runStagingCanary(missingRecovery)).rejects.toThrow(
            'failureInjection target convex requires inject and recover phases'
        );
    });
});

describe('multi-instance topology guards', () => {
    it('rejects process-local correctness and unsafe memory/sqlite/fs topology', () => {
        expect(
            validateProductionTopology({
                instances: 3,
                syncProvider: 'sqlite',
                storageProvider: 'fs',
                backgroundProvider: 'memory',
                sqliteTopology: 'unsupported',
                fsTopology: 'unsupported',
                viewerSuppressionRequiredForCorrectness: true,
            })
        ).toEqual([
            'multi-instance deployments require an external background-job provider',
            'process-local viewer suppression cannot be required for correctness',
            'SQLite in multi-instance mode requires an explicit single-writer or supported shared-volume topology',
            'filesystem storage in multi-instance mode requires an explicit single-writer or supported shared-volume topology',
        ]);
    });

    it('allows explicit single-writer SQLite/fs with an external job provider', () => {
        expect(
            validateProductionTopology({
                instances: 2,
                syncProvider: 'sqlite',
                storageProvider: 'fs',
                backgroundProvider: 'convex',
                sqliteTopology: 'single-writer',
                fsTopology: 'single-writer',
                viewerSuppressionRequiredForCorrectness: false,
            })
        ).toEqual([]);
    });
});
