import { describe, expect, it, vi } from 'vitest';
import {
    defineOr3Plugin,
    pluginOk,
    type Or3PluginDefinition,
    type PluginContext,
    type PluginGrant,
    type PluginManifestV2,
} from '../../packages/plugin-sdk/src/index';
import { createPluginTestHost } from '../../packages/plugin-sdk/src/testing';

function manifest(requestedGrants: readonly PluginGrant[] = []): PluginManifestV2 {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'sample.harness',
        name: 'Harness Sample',
        version: '2.0.0',
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: {
            client: {
                entry: 'dist/client.mjs',
                format: 'esm',
                isolation: 'host',
            },
        },
        requestedGrants,
        features: { required: [], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: 'trusted-host',
        settings: { version: 1 },
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe',
        },
    };
}

function plugin(
    setup: Or3PluginDefinition['setup'],
    requestedGrants: readonly PluginGrant[] = []
) {
    return defineOr3Plugin({ manifest: manifest(requestedGrants), setup });
}

describe('Plugin SDK test harness', () => {
    it('activates, publishes staged registrations, and cleans up locally', async () => {
        const events: string[] = [];
        const host = createPluginTestHost({
            supportedFeatures: ['host.contributions'],
        });
        const definition = plugin((context) => {
            context.features.require('host.contributions');
            context.hooks.onAction('sample:event', () => undefined);
            context.contributions.register({
                kind: 'ui.dashboard.card',
                id: 'sample.card',
                definition: {},
            });
            context.onActivate(() => events.push('activate'));
            context.onCleanup(() => events.push('cleanup'));
        });

        const result = await host.activate(definition);

        expect(result.ok).toBe(true);
        expect(host.snapshot()).toMatchObject({
            active: true,
            generation: 1,
            contributionCount: 1,
            hookCount: 1,
        });
        expect(events).toEqual(['activate']);

        await host.deactivate();
        expect(events).toEqual(['activate', 'cleanup']);
        expect(host.snapshot()).toMatchObject({
            active: false,
            contributionCount: 0,
            hookCount: 0,
            cleanupCount: 0,
        });
    });

    it('returns a stable denial for an unapproved grant', async () => {
        let denied: unknown;
        const host = createPluginTestHost();
        const result = await host.activate(
            plugin(async (context) => {
                denied = await context.storage.set('secret', 'value');
            }, ['storage.write'])
        );

        expect(result.ok).toBe(true);
        expect(denied).toMatchObject({
            ok: false,
            error: { code: 'permission-denied', retryable: false },
        });
    });

    it('rejects calls from a stale generation after replacement', async () => {
        let firstContext: PluginContext | undefined;
        const host = createPluginTestHost({ approvedGrants: ['storage.read'] });
        await host.activate(
            plugin((context) => {
                firstContext = context;
            }, ['storage.read'])
        );
        await host.activate(plugin(() => undefined, ['storage.read']));

        const stale = await firstContext!.storage.get('key');
        expect(stale).toMatchObject({
            ok: false,
            error: { code: 'conflict', message: 'Plugin generation is stale' },
        });
    });

    it('rolls back staged registrations and runs cleanup on activation failure', async () => {
        const cleanup = vi.fn();
        const host = createPluginTestHost();
        const result = await host.activate(
            plugin((context) => {
                context.hooks.onAction('sample:event', () => undefined);
                context.contributions.register({
                    kind: 'ui.dashboard.card',
                    id: 'sample.card',
                    definition: {},
                });
                context.onCleanup(cleanup);
                context.onActivate(() => {
                    throw new Error('activation exploded');
                });
            })
        );

        expect(result).toMatchObject({
            ok: false,
            error: { code: 'internal', message: 'activation exploded' },
        });
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(host.snapshot()).toMatchObject({
            active: false,
            contributionCount: 0,
            hookCount: 0,
            cleanupCount: 0,
        });
    });

    it('injects one-shot host service failures', async () => {
        const seen: unknown[] = [];
        const host = createPluginTestHost({
            approvedGrants: ['settings.read'],
            initialSettings: { mode: 'compact' },
        });
        host.failNext('settings', 'host-unavailable', 'settings offline');
        const result = await host.activate(
            plugin(async (context) => {
                seen.push(await context.settings.get('mode'));
                seen.push(await context.settings.get('mode'));
            }, ['settings.read'])
        );

        expect(result.ok).toBe(true);
        expect(seen[0]).toMatchObject({
            ok: false,
            error: { code: 'host-unavailable', message: 'settings offline' },
        });
        expect(seen[1]).toEqual(pluginOk('compact'));
    });

    it('continues cleanup and clears active state when one cleanup fails', async () => {
        const laterCleanup = vi.fn();
        const host = createPluginTestHost();
        await host.activate(
            plugin((context) => {
                context.onCleanup(laterCleanup);
                context.onCleanup(() => {
                    throw new Error('cleanup failed');
                });
            })
        );

        await expect(host.deactivate()).rejects.toThrow('cleanup failed');
        expect(laterCleanup).toHaveBeenCalledTimes(1);
        expect(host.snapshot()).toMatchObject({ active: false, cleanupCount: 0 });
    });

    it('uses a fake HTTP handler bound to the host-created identity', async () => {
        const scopes: string[] = [];
        let response: unknown;
        const host = createPluginTestHost({
            approvedGrants: ['network.http'],
            httpHandler: async (_request, scope) => {
                scopes.push(`${scope.pluginId}:${scope.generation}`);
                return pluginOk({ status: 200, headers: {}, body: { ok: true } });
            },
        });
        await host.activate(
            plugin(async (context) => {
                response = await context.http.request({ url: 'https://example.invalid' });
            }, ['network.http'])
        );

        expect(scopes).toEqual(['sample.harness:1']);
        expect(response).toMatchObject({ ok: true, value: { status: 200 } });
    });
});
