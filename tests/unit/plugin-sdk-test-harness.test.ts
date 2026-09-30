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
    createTestHost,
} from '../../packages/plugin-sdk/src/testing';
import { validatePluginChatMessage } from '../../packages/plugin-sdk/src/chat-schema';
import { validateRenderPayload } from '../../shared/plugins/isolation/worker-runtime';
import type { PortableUiNode } from '../../packages/plugin-sdk/src/ui';

function manifest(
    requestedGrants: readonly PluginGrant[] = [],
    id = 'sample.harness'
): PluginManifestV2 {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id,
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
    requestedGrants: readonly PluginGrant[] = [],
    id = 'sample.harness'
) {
    return defineOr3Plugin({ manifest: manifest(requestedGrants, id), setup });
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

    it('runs the ergonomic install/command/pane/storage path with scoped CAS', async () => {
        const grants = [
            'storage.read',
            'storage.write',
            'commands.register',
            'panes.open',
            'workspace.read',
            'workspace.switch',
            'events.register',
        ] as const;
        let firstContext: PluginContext | undefined;
        const host = createTestHost({
            workspaceId: 'workspace-a',
            approvedGrants: grants,
        });
        const definition = plugin((context) => {
            firstContext = context;
            context.commands.register(
                { id: 'sample.open', label: 'Open sample' },
                async () => {
                    const pane = await context.panes.open({
                        app: 'sample.app',
                        instanceKey: 'session-1',
                        data: { sessionId: 'session-1' },
                    });
                    return pane.ok ? pluginOk(pane.value) : pane;
                }
            );
        }, grants);

        expect((await host.install(definition)).ok).toBe(true);
        const command = await host.commands.run('sample.open');
        expect(command).toMatchObject({ ok: true, value: { app: 'sample.app' } });
        expect(host.ui.panes()).toHaveLength(1);

        const firstWrite = await firstContext!.storage.set('sessions', { count: 1 });
        expect(firstWrite.ok).toBe(true);
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(await firstContext!.storage.set('invalid', circular as unknown as PluginJsonValue)).toMatchObject({
            ok: false,
            error: { code: 'invalid-input' },
        });
        const createIfAbsent = await firstContext!.storage.set('new-session', { count: 0 }, { ifRevision: null });
        expect(createIfAbsent).toMatchObject({ ok: true });
        const record = await firstContext!.storage.getRecord('sessions');
        expect(record).toMatchObject({ ok: true, value: { revision: 1 } });
        const revision = record.ok ? record.value.revision : -1;
        expect(await firstContext!.storage.set('sessions', { count: 2 }, { ifRevision: revision })).toMatchObject({ ok: true });
        expect(await firstContext!.storage.set('sessions', { count: 3 }, { ifRevision: revision })).toMatchObject({
            ok: false,
            error: { code: 'conflict' },
        });
        await firstContext!.storage.set('sessions-next', { count: 4 });
        const firstPage = await firstContext!.storage.listPage({ prefix: 'sessions', limit: 1 });
        expect(firstPage).toMatchObject({ ok: true, value: { entries: [{ key: 'sessions' }], nextCursor: 'cursor:sessions' } });

        const oldContext = firstContext!;
        await oldContext.workspace.switch('workspace-b');
        expect(await oldContext.storage.get('sessions')).toMatchObject({
            ok: false,
            error: { code: 'conflict' },
        });
        expect(host.snapshot()).toMatchObject({ active: true, workspaceId: 'workspace-b' });
        expect(await firstContext!.storage.get('sessions')).toEqual(pluginOk(null));
    });

    it('scopes test-host state by plugin and workspace', async () => {
        const grants = ['storage.read', 'storage.write', 'secrets.read', 'secrets.write'] as const;
        const host = createTestHost({
            approvedGrants: grants,
            initialStorage: { shared: 'plugin-a' },
            initialSecrets: { token: 'plugin-a' },
        });
        let pluginA!: PluginContext;
        expect((await host.install(plugin((context) => { pluginA = context; }, grants, 'sample.a'))).ok).toBe(true);
        expect(await pluginA.storage.get('shared')).toEqual(pluginOk('plugin-a'));
        expect(await pluginA.secrets.get('token')).toEqual(pluginOk('plugin-a'));
        await pluginA.storage.set('private', 'a');
        await host.disable();

        let pluginB!: PluginContext;
        expect((await host.install(plugin((context) => { pluginB = context; }, grants, 'sample.b'))).ok).toBe(true);
        expect(await pluginB.storage.get('shared')).toEqual(pluginOk(null));
        expect(await pluginB.storage.get('private')).toEqual(pluginOk(null));
        expect(await pluginB.secrets.get('token')).toEqual(pluginOk(null));
    });

    it('keeps workspace settings isolated across an authorized switch', async () => {
        const host = createPluginTestHost({
            approvedGrants: ['settings.read', 'settings.write', 'workspace.read', 'workspace.switch'],
            initialSettings: { mode: 'compact' },
        });
        let context!: PluginContext;
        const changes: unknown[] = [];
        const definition = plugin((value) => {
            context = value;
            context.workspace.onChange((change) => changes.push(change));
        }, ['settings.read', 'settings.write', 'workspace.read', 'workspace.switch'], 'sample.settings');
        expect((await host.install(definition)).ok).toBe(true);
        expect(await context.settings.get('mode')).toEqual(pluginOk('compact'));
        expect(await context.settings.set('mode', 'workspace-a')).toEqual(pluginOk(undefined));

        expect(await host.switchWorkspace('workspace-b')).toEqual(pluginOk({ id: 'workspace-b' }));
        expect(changes).toEqual([{ previousId: 'local', id: 'workspace-b', reason: 'user' }]);
        expect((await host.install(definition)).ok).toBe(true);
        expect(await context.settings.get('mode')).toEqual(pluginOk(null));
        expect(await context.settings.set('mode', 'workspace-b')).toEqual(pluginOk(undefined));

        expect(await host.switchWorkspace('local')).toEqual(pluginOk({ id: 'local' }));
        expect((await host.install(definition)).ok).toBe(true);
        expect(await context.settings.get('mode')).toEqual(pluginOk('workspace-a'));
    });

    it('contains subscriber failures during settings writes and workspace switches', async () => {
        const host = createPluginTestHost({
            approvedGrants: ['settings.write', 'workspace.read', 'workspace.switch', 'events.register'],
        });
        let context!: PluginContext;
        const definition = plugin((value) => {
            context = value;
            context.events.on('settings.changed', () => {
                throw new Error('settings subscriber failed');
            });
            context.workspace.onChange(() => {
                throw new Error('workspace subscriber failed');
            });
        }, ['settings.write', 'workspace.read', 'workspace.switch', 'events.register'], 'sample.subscribers');

        expect((await host.install(definition)).ok).toBe(true);
        await expect(context.settings.set('mode', 'compact')).resolves.toEqual(pluginOk(undefined));
        await expect(host.switchWorkspace('workspace-b')).resolves.toEqual(pluginOk({ id: 'workspace-b' }));
    });

    it('keeps the old workspace when the replacement activation fails', async () => {
        const host = createPluginTestHost({
            approvedGrants: ['workspace.read', 'workspace.switch', 'storage.read'],
            initialStorage: { marker: 'old-scope' },
        });
        let context!: PluginContext;
        const definition = plugin((value) => {
            context = value;
            if (value.workspace.id === 'workspace-b') {
                throw new Error('replacement setup failed');
            }
        }, ['workspace.read', 'workspace.switch', 'storage.read'], 'sample.switch-rollback');

        expect((await host.install(definition)).ok).toBe(true);
        const oldContext = context;
        const switched = await host.switchWorkspace('workspace-b');

        expect(switched).toMatchObject({
            ok: false,
            error: { code: 'internal', message: 'Workspace switch activated no plugin: replacement setup failed' },
        });
        expect(host.snapshot()).toMatchObject({ active: true, workspaceId: 'local' });
        expect(context.workspace.id).toBe('local');
        expect(await oldContext.storage.get('marker')).toMatchObject({
            ok: false,
            error: { code: 'conflict' },
        });
        expect(await context.storage.get('marker')).toEqual(pluginOk('old-scope'));
    });

    it('never commits a setup that was superseded while awaiting', async () => {
        const host = createPluginTestHost({ approvedGrants: ['ui.dashboard.register'] });
        let resolveA!: () => void;
        const gateA = new Promise<void>((resolve) => {
            resolveA = resolve;
        });
        const definitionA = plugin(async (ctx) => {
            await gateA;
            ctx.contributions.register({
                kind: 'ui.dashboard.card',
                id: 'card-a',
                title: 'A',
                view: { nodes: [] },
            } as never);
        }, ['ui.dashboard.register'], 'sample.superseded-a');
        const definitionB = plugin(() => undefined, [], 'sample.superseded-b');

        const pendingA = host.install(definitionA);
        const installedB = await host.install(definitionB);
        expect(installedB.ok).toBe(true);
        resolveA();
        const settledA = await pendingA;
        expect(settledA).toMatchObject({ ok: false, error: { code: 'aborted' } });
        const snapshot = host.snapshot();
        expect(snapshot).toMatchObject({ active: true });
        // A's late contribution never reached the committed host state.
        expect(JSON.stringify(snapshot)).not.toContain('card-a');
    });

    it('reports a superseded rejection without clearing the replacement', async () => {
        const host = createPluginTestHost({});
        let rejectA!: (error: unknown) => void;
        const gateA = new Promise<void>((_resolve, reject) => {
            rejectA = reject;
        });
        const definitionA = plugin(() => gateA, [], 'sample.rejected-a');
        const definitionB = plugin(() => undefined, [], 'sample.rejected-b');

        const pendingA = host.install(definitionA);
        expect((await host.install(definitionB)).ok).toBe(true);
        rejectA(new Error('A failed late'));
        await expect(pendingA).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } });
        expect(host.snapshot()).toMatchObject({ active: true });
    });

    it('reports an explicit rollback failure when restoration also fails', async () => {
        const host = createPluginTestHost({
            approvedGrants: ['workspace.read', 'workspace.switch'],
        });
        let failLocal = false;
        const definition = plugin(
            (value) => {
                if (value.workspace.id === 'workspace-b') throw new Error('target setup failed');
                if (failLocal) throw new Error('restore setup failed');
            },
            ['workspace.read', 'workspace.switch'],
            'sample.rollback-twice'
        );
        expect((await host.install(definition)).ok).toBe(true);
        // Poison the restore path: the rollback reactivation of the old scope
        // fails as well, so the host runs no plugin for either workspace.
        failLocal = true;
        const switched = await host.switchWorkspace('workspace-b');
        expect(switched).toMatchObject({
            ok: false,
            error: { code: 'internal', message: expect.stringContaining('rollback failed') },
        });
        expect(switched).toMatchObject({
            error: { details: { rollback: 'failed' } },
        });
        expect(host.snapshot()).toMatchObject({ active: false });
    });

    it.each([false, true])('restores or reports inactive after cleanup failure (restore fails: %s)', async (failRestore) => {
        const host = createTestHost({ approvedGrants: ['workspace.switch'] });
        let attempts = 0;
        const definition = plugin((context) => {
            attempts++;
            if (attempts > 1 && failRestore) throw new Error('restore failed');
            context.onCleanup(() => { throw new Error('cleanup failed'); });
        }, ['workspace.switch']);
        expect((await host.install(definition)).ok).toBe(true);
        expect(await host.switchWorkspace('workspace-b')).toMatchObject({
            ok: false,
            error: { details: { rollback: failRestore ? 'failed' : 'restored', active: !failRestore } },
        });
        expect(attempts).toBe(2);
        expect(host.snapshot().active).toBe(!failRestore);
        expect(host.snapshot().workspaceId).not.toBe('workspace-b');
    });

    it('keeps chat resources scoped to their workspace', async () => {
        const grants = ['chat.create', 'chat.read', 'chat.message.write', 'workspace.read', 'workspace.switch'] as const;
        const host = createTestHost({ approvedGrants: grants });
        let context!: PluginContext;
        const definition = plugin((value) => { context = value; }, grants, 'sample.chat-scope');
        expect((await host.install(definition)).ok).toBe(true);

        const created = await context.chat.create({ title: 'Workspace A' });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(await context.chat.appendMessage(created.value.id, { role: 'user', content: 'private' })).toMatchObject({ ok: true });

        const oldContext = context;
        expect(await host.switchWorkspace('workspace-b')).toEqual(pluginOk({ id: 'workspace-b' }));
        expect(await context.chat.open(created.value.id)).toMatchObject({
            ok: false,
            error: { code: 'not-found' },
        });
        expect(await oldContext.chat.open(created.value.id)).toMatchObject({
            ok: false,
            error: { code: 'conflict' },
        });
    });

    it('serializes concurrent workspace switch requests', async () => {
        const grants = ['workspace.read', 'workspace.switch'] as const;
        const host = createTestHost({ approvedGrants: grants });
        expect((await host.install(plugin(() => undefined, grants, 'sample.switch-queue'))).ok).toBe(true);

        const [first, second] = await Promise.all([
            host.switchWorkspace('workspace-b'),
            host.switchWorkspace('workspace-c'),
        ]);
        expect(first).toEqual(pluginOk({ id: 'workspace-b' }));
        expect(second).toEqual(pluginOk({ id: 'workspace-c' }));
        expect(host.snapshot().workspaceId).toBe('workspace-c');
    });

    it('keeps secrets and selected files outside ordinary plugin storage', async () => {
        const host = createTestHost({
            approvedGrants: [
                'secrets.read',
                'secrets.write',
                'secrets.use',
                'files.pick',
                'files.read',
                'files.write',
            ],
            initialSecrets: { 'hermes-token': 'secret-token' },
            initialFiles: [
                {
                    id: 'file-1',
                    name: 'prompt.txt',
                    mimeType: 'text/plain',
                    size: 6,
                    revision: 1,
                    data: new TextEncoder().encode('hello\n'),
                },
            ],
        });
        let context!: PluginContext;
        const result = await host.install(
            plugin((value) => {
                context = value;
            }, [
                'secrets.read',
                'secrets.write',
                'secrets.use',
                'files.pick',
                'files.read',
                'files.write',
            ])
        );
        expect(result.ok).toBe(true);
        expect(await context.secrets.get('hermes-token')).toEqual(pluginOk('secret-token'));
        expect(await context.secrets.set('remembered', 'value', { persistence: 'remember' })).toEqual(pluginOk(undefined));
        expect(await context.secrets.ref('remembered')).toMatchObject({
            ok: true,
            value: { persistence: 'persistent', state: 'available' },
        });
        expect(await context.storage.get('hermes-token')).toMatchObject({
            ok: false,
            error: { code: 'permission-denied' },
        });
        const picked = await context.files.pick({ accept: ['text/plain'] });
        expect(picked).toMatchObject({ ok: true, value: [{ id: 'file-1' }] });
        const read = await context.files.read('file-1');
        expect(read.ok).toBe(true);
        const chunks: Uint8Array[] = [];
        if (read.ok) {
            for await (const chunk of read.value) chunks.push(chunk);
            expect(await read.value.result).toMatchObject({ ok: true });
        }
        expect(new TextDecoder().decode(chunks[0])).toBe('hello\n');
        expect(await context.files.write({
            name: 'prompt.txt',
            mimeType: 'text/plain',
            data: (async function* () { yield new TextEncoder().encode('updated'); })(),
            replace: { id: 'file-1', ifRevision: 0 },
        })).toMatchObject({ ok: false, error: { code: 'conflict' } });
        const cancelled = new AbortController();
        cancelled.abort();
        expect(await context.files.pick({ signal: cancelled.signal })).toMatchObject({
            ok: false,
            error: { code: 'aborted' },
        });
    });

    it('allocates a fresh file id when the first generated id is already present', async () => {
        const host = createTestHost({
            approvedGrants: ['files.write'],
            initialFiles: [{
                id: 'file-2',
                name: 'existing.txt',
                mimeType: 'text/plain',
                size: 8,
                revision: 1,
                data: new TextEncoder().encode('existing'),
            }],
        });
        let context!: PluginContext;
        expect((await host.install(plugin((value) => { context = value; }, ['files.write']))).ok).toBe(true);

        const created = await context.files.write({
            name: 'new.txt',
            mimeType: 'text/plain',
            data: (async function* () { yield new TextEncoder().encode('new'); })(),
        });
        expect(created).toMatchObject({ ok: true, value: { id: 'file-3' } });
        expect(await context.files.write({
            name: 'another.txt',
            mimeType: 'text/plain',
            data: (async function* () { yield new TextEncoder().encode('another'); })(),
        })).toMatchObject({ ok: true, value: { id: 'file-4' } });
    });

    it('settles file reads exactly once when the consumer breaks out early', async () => {
        const host = createTestHost({
            approvedGrants: ['files.read'],
            initialFiles: [{
                id: 'file-1',
                name: 'big.txt',
                mimeType: 'text/plain',
                size: 200_000,
                revision: 1,
                data: new Uint8Array(200_000),
            }],
        });
        let context!: PluginContext;
        expect((await host.install(plugin((value) => { context = value; }, ['files.read']))).ok).toBe(true);
        const read = await context.files.read('file-1');
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        for await (const _chunk of read.value) {
            break;
        }
        await expect(read.value.result).resolves.toMatchObject({
            ok: false,
            error: { code: 'aborted' },
        });
    });

    it('settles an idle file read when the generation is torn down', async () => {
        const host = createTestHost({
            approvedGrants: ['files.read'],
            initialFiles: [{
                id: 'file-1',
                name: 'idle.txt',
                mimeType: 'text/plain',
                size: 5,
                revision: 1,
                data: new TextEncoder().encode('hello'),
            }],
        });
        let context!: PluginContext;
        expect((await host.install(plugin((value) => { context = value; }, ['files.read']))).ok).toBe(true);
        const read = await context.files.read('file-1');
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        await host.disable();
        await expect(read.value.result).resolves.toMatchObject({
            ok: false,
            error: { code: 'aborted' },
        });
    });

    it('refuses to commit a file write cancelled during its final chunk', async () => {
        const host = createTestHost({ approvedGrants: ['files.write', 'files.read'] });
        let context!: PluginContext;
        expect((await host.install(plugin((value) => { context = value; }, ['files.write', 'files.read']))).ok).toBe(true);
        const aborter = new AbortController();
        const data = (async function* () {
            yield new TextEncoder().encode('part');
            aborter.abort();
        })();
        await expect(
            context.files.write({ name: 'late.txt', mimeType: 'text/plain', data, signal: aborter.signal })
        ).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } });
        expect(host.snapshot()).toMatchObject({ active: true });
    });

    it.each(['caller', 'generation'] as const)('settles a blocked file producer on %s cancellation', async (reason) => {
        const host = createTestHost({ approvedGrants: ['files.write', 'files.pick'] });
        let context!: PluginContext;
        expect((await host.install(plugin((value) => { context = value; }, ['files.write', 'files.pick']))).ok).toBe(true);
        const controller = new AbortController();
        const close = vi.fn(() => new Promise<IteratorResult<Uint8Array>>(() => {}));
        let release!: (value: IteratorResult<Uint8Array>) => void;
        const pending = new Promise<IteratorResult<Uint8Array>>((resolve) => { release = resolve; });
        const write = context.files.write({
            name: 'blocked.txt', mimeType: 'text/plain', signal: controller.signal,
            data: { [Symbol.asyncIterator]: () => ({ next: () => pending, return: close }) },
        });
        if (reason === 'caller') controller.abort();
        else await host.disable();
        await expect(write).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } });
        expect(close).toHaveBeenCalledOnce();
        release({ done: true, value: undefined });
        if (reason === 'generation') {
            await host.install(plugin((value) => { context = value; }, ['files.write', 'files.pick']));
        }
        expect(await context.files.pick({ multiple: true })).toEqual({ ok: true, value: [] });
    });

    it('keeps chat retries idempotent and validates public transcript messages', async () => {
        const host = createPluginTestHost({ approvedGrants: ['chat.create', 'chat.read', 'chat.message.write'] });
        let context!: PluginContext;
        expect((await host.install(plugin((value) => { context = value; }, ['chat.create', 'chat.read', 'chat.message.write']))).ok).toBe(true);
        const chat = await context.chat.create({ title: 'Session' });
        expect(chat.ok).toBe(true);
        if (!chat.ok) return;
        const first = await context.chat.appendMessage(chat.value.id, { role: 'user', content: 'hello' }, { requestId: 'req-1' });
        const retry = await context.chat.appendMessage(chat.value.id, { role: 'user', content: 'hello' }, { requestId: 'req-1' });
        expect(first).toMatchObject({ ok: true });
        expect(retry).toEqual(first);
        expect(await context.chat.appendMessage(chat.value.id, { role: 'user', content: 42 as unknown as string })).toMatchObject({
            ok: false,
            error: { code: 'invalid-input' },
        });
        expect(await context.chat.appendMessage(chat.value.id, {
            role: 'user',
            content: 'no',
            attachments: [{ fileId: '../outside' }],
        })).toMatchObject({
            ok: false,
            error: { code: 'invalid-input' },
        });
        expect(await context.chat.appendMessage(chat.value.id, {
            role: 'user',
            content: 'missing attachment',
            fileIds: ['file-missing'],
        })).toMatchObject({
            ok: false,
            error: { code: 'not-found' },
        });
    });

    it('isolates stored settings and storage values from caller mutations', async () => {
        const host = createPluginTestHost({
            approvedGrants: ['settings.read', 'settings.write', 'storage.read', 'storage.write'],
        });
        let context!: PluginContext;
        expect(
            (await host.install(plugin((value) => { context = value; }, ['settings.read', 'settings.write', 'storage.read', 'storage.write']))).ok
        ).toBe(true);

        const incomingSettings = { mode: 'light', nested: { level: 1 } };
        expect(await context.settings.set('theme', incomingSettings)).toEqual(pluginOk(undefined));
        incomingSettings.mode = 'hacked';
        incomingSettings.nested.level = 99;
        expect(await context.settings.get('theme')).toEqual(
            pluginOk({ mode: 'light', nested: { level: 1 } })
        );

        const readSettings = await context.settings.get<{ mode: string; nested: { level: number } }>('theme');
        expect(readSettings.ok).toBe(true);
        if (readSettings.ok) {
            readSettings.value.nested.level = 99;
            readSettings.value.mode = 'hacked';
        }
        expect(await context.settings.get('theme')).toEqual(
            pluginOk({ mode: 'light', nested: { level: 1 } })
        );

        const listed = await context.settings.list();
        expect(listed.ok).toBe(true);
        if (listed.ok) {
            (listed.value.theme as { nested: { level: number } }).nested.level = 99;
        }
        expect(await context.settings.get('theme')).toEqual(
            pluginOk({ mode: 'light', nested: { level: 1 } })
        );

        const incomingStorage = { tags: ['a'] };
        expect(await context.storage.set('prefs', incomingStorage)).toEqual(pluginOk(undefined));
        incomingStorage.tags.push('hacked');
        expect(await context.storage.get('prefs')).toEqual(pluginOk({ tags: ['a'] }));

        const record = await context.storage.getRecord<{ tags: string[] }>('prefs');
        expect(record.ok).toBe(true);
        if (record.ok) record.value.value?.tags.push('hacked');
        expect(await context.storage.get('prefs')).toEqual(pluginOk({ tags: ['a'] }));
    });

    it('rebuilds chat attachments so later mutations cannot smuggle fileIds', async () => {
        const attachment = { fileId: 'file-1', name: 'prompt.txt' };
        const validated = validatePluginChatMessage({
            role: 'user',
            content: 'see attached',
            attachments: [attachment],
        });
        expect(validated.ok).toBe(true);
        if (!validated.ok) return;
        expect(validated.value.attachments?.[0]).not.toBe(attachment);
        attachment.fileId = '../outside';
        expect(validated.value.attachments).toEqual([{ fileId: 'file-1', name: 'prompt.txt' }]);
    });

    it('records activity sources with owner-scoped cleanup', async () => {
        const host = createPluginTestHost({ approvedGrants: ['activity.register'] });
        const result = await host.install(plugin((context) => {
            context.activity.registerSource({
                id: 'example.agent',
                label: 'Example agent',
                list: async () => pluginOk([]),
            });
        }, ['activity.register']));
        expect(result.ok).toBe(true);
        expect(host.snapshot().activitySources).toEqual([
            { id: 'example.agent', label: 'Example agent' },
        ]);
        await host.disable();
        expect(host.activity.sources()).toEqual([]);
    });

    it('inspects owned UI registrations and rejects invalid pane restore data', async () => {
        const host = createPluginTestHost({
            approvedGrants: ['ui.pane.register', 'panes.open'],
        });
        let context!: PluginContext;
        expect((await host.install(plugin((value) => {
            context = value;
            context.ui.registerPane({ id: 'sessions', label: 'Sessions', dataVersion: 1 });
        }, ['ui.pane.register', 'panes.open']))).ok).toBe(true);
        expect(host.snapshot().uiRegistrations).toEqual([{ surface: 'pane', id: 'sessions' }]);
        expect(await context.panes.open({ app: 'or3.sessions', data: { sessionId: 'one' }, instanceKey: 'one' })).toMatchObject({ ok: true });
        expect(host.ui.panes()).toHaveLength(1);
        expect(await context.panes.open({ app: 'or3.sessions', data: { bad: 'x'.repeat(70_000) } })).toMatchObject({
            ok: false,
            error: { code: 'quota-exceeded' },
        });
        await host.disable();
        expect(host.snapshot().uiRegistrations).toEqual([]);
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

    it('exposes only a host-mediated HTTP client on the plugin context', async () => {
        let context: unknown;
        const host = createPluginTestHost({ approvedGrants: ['network.http'] });
        await host.activate(
            plugin(async (value) => {
                context = value;
            }, ['network.http'])
        );

        expect(context).toBeTruthy();
        expect('http' in (context as Record<string, unknown>)).toBe(true);
        const response = await (context as PluginContext).http.fetch({
            url: 'https://example.com',
            destination: 'example',
        });
        expect(response).toMatchObject({ ok: false, error: { code: 'unsupported' } });
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
        expect(stored).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        expect(host.calls.some((call) => call.method === 'storage.get')).toBe(true);
    });
});

describe('palette registration ownership', () => {
    it('removes committed entries and updates counts when individually disposed', async () => {
        const host = createPluginTestHost({ approvedGrants: ['ui.command-palette.register'] });
        const handles: Array<{ dispose(): void }> = [];
        await host.install(plugin((context) => {
            for (const kind of ['ui.command-palette.command', 'ui.command-palette.post-source'] as const) {
                handles.push(context.contributions.register({ kind, id: kind, definition: {} }));
            }
        }, ['ui.command-palette.register']));
        for (const handle of handles) { handle.dispose(); handle.dispose(); }
        expect(host.snapshot()).toMatchObject({ contributionCount: 0, paletteCommands: [], palettePostSources: [] });
        await host.disable();
    });

    it('does not delete a replacement handler or run stale activation callbacks', async () => {
        const host = createPluginTestHost({ approvedGrants: ['ui.command-palette.register'] });
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const staleActivate = vi.fn();
        const old = host.install(plugin(async (context) => {
            context.contributions.register({ kind: 'ui.command-palette.command', id: 'same', definition: {} });
            context.onActivate(staleActivate);
            entered();
            await gate;
        }, ['ui.command-palette.register']));
        await started;
        await host.install(plugin((context) => {
            context.contributions.register({ kind: 'ui.command-palette.command', id: 'same', definition: {} });
            host.registerMediatedPaletteCommandHandler('same', () => 'replacement');
        }, ['ui.command-palette.register']));
        release();
        expect(await old).toMatchObject({ ok: false, error: { code: 'aborted' } });
        expect(staleActivate).not.toHaveBeenCalled();
        await expect(host.executePaletteCommand('same')).resolves.toBe('replacement');
        await host.disable();
    });

    it('does not expose nested settings through portable listings', async () => {
        const host = createPortableTestHost({ approvedGrants: ['settings.read', 'settings.write'] });
        await host.client.call('settings.set', { key: 'x', value: { nested: { value: 1 } } });
        const listed = await host.client.call<{ values: { x: { nested: { value: number } } } }>('settings.list');
        if (!listed.ok) throw new Error(listed.message);
        listed.result.values.x.nested.value = 99;
        expect(await host.client.call('settings.get', { key: 'x' })).toMatchObject({ result: { value: { nested: { value: 1 } } } });
    });
});
