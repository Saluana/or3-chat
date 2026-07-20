import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPluginTestHost } from '../../packages/plugin-sdk/src/testing';
import {
    checkV2PackageConformance,
} from '../../scripts/plugin-runtime/check-v2-package-conformance';
import {
    createDashboardInsightsPlugin,
} from '../../examples/plugins/dashboard-insights-v2/client.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const packageRoot = resolve(repoRoot, 'examples/plugins/dashboard-insights-v2');
const allGrants = [
    'settings.read',
    'storage.write',
    'hooks.register',
    'ui.dashboard.register',
] as const;

describe('first-party Dashboard Insights V2 package', () => {
    it('passes SDK-only package conformance', () => {
        expect(checkV2PackageConformance(packageRoot, { repoRoot })).toEqual({
            status: 'conformant',
            issues: [],
        });
    });

    it('publishes atomically and cleans up through the SDK test host', async () => {
        const events: Array<{ event: string; contributionCount: number; hookCount: number }> = [];
        const host = createPluginTestHost({
            approvedGrants: allGrants,
            supportedFeatures: ['host.contributions'],
            initialSettings: { displayMode: 'expanded' },
        });
        const definition = createDashboardInsightsPlugin({
            observe: (event) => {
                const snapshot = host.snapshot();
                events.push({
                    event,
                    contributionCount: snapshot.contributionCount,
                    hookCount: snapshot.hookCount,
                });
            },
        });

        const activated = await host.activate(definition);

        expect(activated.ok).toBe(true);
        expect(events[0]).toEqual({ event: 'activate', contributionCount: 0, hookCount: 0 });
        expect(host.snapshot()).toMatchObject({ contributionCount: 1, hookCount: 1 });
        await host.deactivate();
        expect(events.at(-1)?.event).toBe('cleanup');
        expect(host.snapshot()).toMatchObject({ contributionCount: 0, hookCount: 0 });
    });

    it('rolls back staged visibility when a reviewed grant is denied', async () => {
        const events: string[] = [];
        const host = createPluginTestHost({
            approvedGrants: allGrants.filter((grant) => grant !== 'storage.write'),
            supportedFeatures: ['host.contributions'],
            initialSettings: { displayMode: 'compact' },
        });

        const result = await host.activate(
            createDashboardInsightsPlugin({ observe: (event) => events.push(event) })
        );

        expect(result).toMatchObject({
            ok: false,
            error: { code: 'internal', message: 'storage:permission-denied' },
        });
        expect(events).toEqual(['activate', 'cleanup']);
        expect(host.snapshot()).toMatchObject({
            active: false,
            contributionCount: 0,
            hookCount: 0,
        });
    });

    it('can reload the retained previous definition after candidate activation fails', async () => {
        const events: string[] = [];
        const host = createPluginTestHost({
            approvedGrants: allGrants,
            supportedFeatures: ['host.contributions'],
            initialSettings: { displayMode: 'compact' },
        });
        const previous = createDashboardInsightsPlugin({
            observe: (event) => events.push(`previous:${event}`),
        });
        expect((await host.activate(previous)).ok).toBe(true);

        const failedCandidate = createDashboardInsightsPlugin({
            failOnActivate: true,
            observe: (event) => events.push(`candidate:${event}`),
        });
        expect(await host.activate(failedCandidate)).toMatchObject({
            ok: false,
            error: { message: 'sample activation failure' },
        });
        expect(host.snapshot().active).toBe(false);

        const recovered = await host.activate(previous);
        expect(recovered.ok).toBe(true);
        expect(host.snapshot()).toMatchObject({ contributionCount: 1, hookCount: 1 });
        expect(events).toEqual(
            expect.arrayContaining([
                'previous:cleanup',
                'candidate:cleanup',
                'previous:activate',
            ])
        );
    });
});
