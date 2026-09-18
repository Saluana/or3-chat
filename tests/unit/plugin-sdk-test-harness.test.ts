import { describe, expect, it, vi } from 'vitest';
import {
    createPortablePlugin,
    defineOr3Plugin,
    pluginOk,
    type Or3PluginDefinition,
    type PluginContext,
    type PluginGrant,
    type PluginManifestV2,
} from '../../packages/plugin-sdk/src/index';
import {
    assertValidPortableTestView,
    createPluginTestHost,
    createPortableTestHost,
} from '../../packages/plugin-sdk/src/testing';
import { validateRenderPayload } from '../../shared/plugins/isolation/worker-runtime';
import type { PortableUiNode } from '../../packages/plugin-sdk/src/ui';

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
            approvedGrants: ['hooks.register', 'ui.dashboard.register'],
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
        }, ['hooks.register', 'ui.dashboard.register']);

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
        const host = createPluginTestHost({
            approvedGrants: ['hooks.register', 'ui.dashboard.register'],
        });
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
        const host = createPluginTestHost({
            approvedGrants: ['hooks.register', 'ui.dashboard.register'],
        });
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
            }, ['hooks.register', 'ui.dashboard.register'])
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

    it('exposes no outbound HTTP client on the plugin context', async () => {
        // Outbound network is a host-mediated capability (approved connections
        // and governed model calls), never a client the sandbox calls directly.
        let context: unknown;
        const host = createPluginTestHost({ approvedGrants: ['network.http'] });
        await host.activate(
            plugin(async (value) => {
                context = value;
            }, ['network.http'])
        );

        expect(context).toBeTruthy();
        expect('http' in (context as Record<string, unknown>)).toBe(false);
    });
});

/* ---------------------------------------------------------------------------
 * Portable profile test host contracts
 * ------------------------------------------------------------------------ */

function portableManifest(): PluginManifestV2 {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'sample.portable',
        name: 'Portable Harness Sample',
        version: '2.0.0',
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: {
            client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' },
        },
        requestedGrants: ['storage.read', 'storage.write'],
        features: { required: [], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: 'isolated-client',
        settings: { version: 1, schema: 'settings.schema.json' },
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe',
        },
    };
}

function portablePlugin(setup: Or3PluginDefinition['setup']) {
    return defineOr3Plugin({ manifest: portableManifest(), setup });
}

async function activatePortable(
    options: Parameters<typeof createPortableTestHost>[0],
    setup: Or3PluginDefinition['setup']
) {
    const host = createPortableTestHost({
        approvedGrants: ['storage.read', 'storage.write'],
        supportedFeatures: ['or3-portable-client-v1'],
        ...options,
    });
    const definition = portablePlugin(setup);
    const handle = createPortablePlugin(definition, {
        client: host.client,
        bootstrap: host.bootstrap,
    });
    await handle.ready;
    return host;
}

describe('portable test host contracts', () => {
    it('refuses to record an invalid render instead of hiding the contract error', () => {
        const invalid = {
            nodes: [
                { type: 'button', id: 'remove-openai/gpt', label: 'Remove', action: 'compare.remove' },
            ],
        } as unknown as Parameters<typeof assertValidPortableTestView>[0];
        expect(() => assertValidPortableTestView(invalid, 'render')).toThrow(/button\.id/);
        const host = createPortableTestHost();
        expect(() => host.client.render(invalid)).toThrow(/button\.id/);
        expect(host.renders).toHaveLength(0);
    });

    const agreementCases: ReadonlyArray<readonly [string, readonly PortableUiNode[]]> = [
        ['a valid tree', [{ type: 'button', id: 'ok', label: 'Ok', action: 'plugin.ok' }]],
        [
            'an identifier with a slash',
            [{ type: 'button', id: 'remove-a/b', label: 'Remove', action: 'remove:a/b' }],
        ],
        ['an identifier starting with underscore', [{ type: 'field.text', id: '_secret', label: 'Secret' }]],
        ['a string over 8 KiB', [{ type: 'markdown', markdown: 'x'.repeat(9 * 1024) }]],
        ['a select with no options', [{ type: 'field.select', id: 'pick', label: 'Pick', options: [] }]],
        ['an unsupported node type', [{ type: 'flashy', id: 'x' } as unknown as PortableUiNode]],
        ['a link that is not https', [{ type: 'link', label: 'Docs', href: 'http://example.com' }]],
        ['a text over the whole-tree budget', [{ type: 'markdown', markdown: 'x'.repeat(5000) }, { type: 'result', label: 'r', text: 'y'.repeat(12000) }]],
        ['a stack without a direction', [{ type: 'stack', children: [] } as unknown as PortableUiNode]],
        ['a list of 201 items', [{ type: 'list', items: Array.from({ length: 201 }, (_, index) => ({ label: `item-${index}` })) }]],
        ['a list of exactly 200 items', [{ type: 'list', items: Array.from({ length: 200 }, (_, index) => ({ label: `item-${index}` })) }]],
        [
            'a table of 13 columns',
            [
                {
                    type: 'table',
                    columns: Array.from({ length: 13 }, (_, index) => ({ key: `c${index}`, label: `C${index}` })),
                    rows: [],
                },
            ],
        ],
        [
            'a table of 201 rows',
            [
                {
                    type: 'table',
                    columns: [{ key: 'c', label: 'C' }],
                    rows: Array.from({ length: 201 }, () => ({ c: 'x' })),
                },
            ],
        ],
        [
            'a select of 101 options',
            [
                {
                    type: 'field.select',
                    id: 'pick',
                    label: 'Pick',
                    options: Array.from({ length: 101 }, (_, index) => ({ value: `v${index}`, label: `V${index}` })),
                },
            ],
        ],
        ['a boolean value on a text field', [{ type: 'field.text', id: 'name', label: 'Name', value: true } as unknown as PortableUiNode]],
        ['a valid toggle', [{ type: 'field.toggle', id: 'on', label: 'On', value: true }]],
    ];

    it.each(agreementCases)('agrees with production validation on %s', (_label, nodes) => {
        const production = validateRenderPayload({ nodes });
        let sdkRejected = false;
        try {
            assertValidPortableTestView({ nodes }, 'render');
        } catch {
            sdkRejected = true;
        }
        expect(sdkRejected).toBe(!production.ok);
    });

    it('returns the RPC response envelope rather than the raw handler payload', async () => {
        const host = await activatePortable({}, (context) => {
            context.onRequest('runtime.ui-event', () => ({ title: 'Result', content: '# Body' }));
        });
        const response = await host.invokeRequest('runtime.ui-event', { action: 'x' });
        expect(response).toEqual({
            ok: true,
            result: { title: 'Result', content: '# Body' },
        });
    });

    it('refuses an unavailable capability like an unregistered production method', async () => {
        let stored: unknown;
        const host = await activatePortable(
            { unavailableCapabilities: ['storage'] },
            async (context) => {
                stored = await context.storage.get('presets');
            }
        );
        expect(stored).toMatchObject({ ok: false, error: { code: 'not-found' } });
        expect(host.calls.some((call) => call.method === 'storage.get')).toBe(true);
    });
});
