import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, watch } from 'vue';
import Dexie from 'dexie';
import { pluginOk } from '@or3/plugin-sdk';
import { messageRowKind, resolveMessageRenderer } from '~/composables/chat/message-renderers';
import { TRUSTED_HOST_GRANTS } from '../trusted-host-context';
import { EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY } from '../trusted-production-stores';
import {
    createLocalStorageSecretStore,
    createMemoryFileStore,
    createMemoryPostStore,
    createScopedRecordStore,
} from '../trusted-production-stores';
import { slashFixtureExtension } from '../trusted-editor';
import { readTrustedExecutionModel } from '../trusted-models';

const live = vi.hoisted(() => ({
    sidebar: new Set<string>(),
    panes: new Set<string>(),
    commands: new Set<string>(),
    tools: new Set<string>(),
    actions: new Set<string>(),
    activity: new Set<string>(),
    cards: new Set<string>(),
    postSources: new Set<string>(),
}));

function trackedHandle(bucket: Set<string>, id: string) {
    bucket.add(id);
    let disposed = false;
    return {
        id,
        owner: Symbol(id),
        get disposed() {
            return disposed;
        },
        dispose() {
            if (disposed) return false;
            disposed = true;
            bucket.delete(id);
            return true;
        },
    };
}

vi.mock('~/composables/dashboard/useDashboardPlugins', () => ({
    registerDashboardPlugin: vi.fn((plugin: { id: string }) => trackedHandle(live.cards, plugin.id)),
}));

vi.mock('~/composables/sidebar/registerSidebarPage', () => ({
    registerSidebarPage: vi.fn((def: { id: string }) => {
        const handle = trackedHandle(live.sidebar, def.id);
        return () => {
            handle.dispose();
        };
    }),
}));

vi.mock('~/composables/core/usePaneApps', () => ({
    usePaneApps: vi.fn(() => ({
        registerPaneApp: vi.fn((def: { id: string }) => trackedHandle(live.panes, def.id)),
    })),
}));

vi.mock('~/composables/chat/useMessageActions', () => ({
    registerMessageAction: vi.fn((action: { id: string }) => trackedHandle(live.actions, action.id)),
}));

vi.mock('~/utils/chat/tools-public', () => ({
    useToolRegistry: vi.fn(() => ({
        registerTool: vi.fn((def: { function: { name: string } }) => {
            live.tools.add(def.function.name);
            return {
                _owner: Symbol(def.function.name),
                dispose: () => {
                    live.tools.delete(def.function.name);
                    return true;
                },
            };
        }),
    })),
}));

vi.mock('~/core/search/command-palette/registry', () => ({
    registerPaletteCommand: vi.fn((definition: { id: string }) =>
        trackedHandle(live.commands, definition.id)
    ),
}));

vi.mock('~/core/search/command-palette/sources/register-core', () => ({
    registerPluginPostSource: vi.fn((options: { definition: { id: string } }) =>
        trackedHandle(live.postSources, options.definition.id)
    ),
}));

vi.mock('~/core/activity/registry', () => ({
    getActivityRegistry: vi.fn(() => ({})),
}));

vi.mock('~/core/activity/adapters/plugin-sdk', () => ({
    registerPluginActivitySource: vi.fn((...args: unknown[]) => {
        const source = args[1] as { id: string };
        return trackedHandle(live.activity, source.id);
    }),
}));

function toolDefinition(name: string) {
    return {
        type: 'function' as const,
        function: {
            name,
            description: name,
            parameters: { type: 'object' as const, properties: {} },
        },
    };
}

function clearLive(): void {
    for (const bucket of Object.values(live)) bucket.clear();
}

describe('trusted host context', () => {
    beforeEach(() => {
        clearLive();
        delete (globalThis as { __or3MultiPaneApi?: unknown }).__or3MultiPaneApi;
    });

    it('registers sdk clients against the workspace registries and returns disposable handles', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.trusted',
            version: '1.0.0',
            grants: TRUSTED_HOST_GRANTS,
        });

        const sidebarComponent = defineComponent({ name: 'TrustedSidebar' });
        const sidebar = trusted.context.ui.registerSidebar({
            id: 'trusted-sidebar',
            label: 'Sidebar',
            component: sidebarComponent,
        });
        const pane = trusted.context.ui.registerPane({
            id: 'trusted-pane',
            label: 'Pane',
        });
        const command = trusted.context.commands.register(
            { id: 'trusted-command', label: 'Command' },
            () => pluginOk(null)
        );
        const action = trusted.context.ui.registerAction({
            id: 'trusted-action',
            label: 'Action',
            surface: 'message',
        });
        const card = trusted.context.ui.registerCard({
            id: 'trusted-card',
            title: 'Card',
        });
        const activity = trusted.context.activity.registerSource({
            id: 'trusted-activity',
            label: 'Activity',
            list: async () => pluginOk([]),
        });
        const tool = trusted.tools.register(toolDefinition('trusted_tool'), async () => '{}');
        const postSource = trusted.context.contributions.register({
            kind: 'ui.command-palette.post-source',
            id: 'trusted-posts',
            definition: {
                id: 'trusted-posts',
                label: 'Posts',
                postType: 'note',
                categoryId: 'notes',
                filterAliases: ['notes'],
                openTarget: { kind: 'pane-app', appId: 'trusted-pane' },
            },
        });
        const listener = trusted.context.hooks.onAction('ui:ready', () => undefined);

        expect(live.sidebar.has('trusted-sidebar')).toBe(true);
        const sidebarRegistry = await import('~/composables/sidebar/registerSidebarPage');
        expect(sidebarRegistry.registerSidebarPage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'trusted-sidebar', component: sidebarComponent }),
            expect.anything()
        );
        expect(live.panes.has('trusted-pane')).toBe(true);
        expect(live.commands.has('trusted-command')).toBe(true);
        expect(live.actions.has('trusted-action')).toBe(true);
        expect(live.cards.has('trusted-card')).toBe(true);
        expect(live.activity.has('trusted-activity')).toBe(true);
        expect(live.tools.has('trusted_tool')).toBe(true);
        expect(live.postSources.has('trusted-posts')).toBe(true);
        expect(trusted.liveListenerCount).toBe(1);
        expect(typeof sidebar.dispose).toBe('function');
        expect(typeof pane.dispose).toBe('function');
        expect(typeof command.dispose).toBe('function');
        expect(typeof action.dispose).toBe('function');
        expect(typeof tool.dispose).toBe('function');

        listener.dispose();
        expect(trusted.liveListenerCount).toBe(0);
        postSource.dispose();
        expect(live.postSources.size).toBe(0);

        await trusted.dispose();
    });

    it('drops every registration and listener when the trusted plugin is disabled', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.leak',
            version: '1.0.0',
            grants: TRUSTED_HOST_GRANTS,
        });

        trusted.context.ui.registerSidebar({ id: 'leak-sidebar', label: 'Sidebar' });
        trusted.context.ui.registerPane({ id: 'leak-pane', label: 'Pane' });
        trusted.context.commands.register({ id: 'leak-command', label: 'Command' }, () => pluginOk(null));
        trusted.context.ui.registerAction({ id: 'leak-action', label: 'Action', surface: 'message' });
        trusted.context.activity.registerSource({
            id: 'leak-activity',
            label: 'Activity',
            list: async () => pluginOk([]),
        });
        trusted.tools.register(toolDefinition('leak_tool'), async () => '{}');
        trusted.context.hooks.onAction('ui:ready', () => undefined);
        trusted.context.hooks.onFilter('ui:ready', (value: string) => value);

        expect(trusted.liveListenerCount).toBe(2);

        await trusted.dispose('disable');

        expect(live.sidebar.size).toBe(0);
        expect(live.panes.size).toBe(0);
        expect(live.commands.size).toBe(0);
        expect(live.actions.size).toBe(0);
        expect(live.activity.size).toBe(0);
        expect(live.tools.size).toBe(0);
        expect(trusted.liveListenerCount).toBe(0);
        await expect(trusted.dispose('disable')).resolves.toMatchObject({ status: 'clean' });
    });

    it('does not touch a registry when the grant is missing', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.denied',
            version: '1.0.0',
            grants: [],
        });

        expect(() =>
            trusted.context.ui.registerSidebar({ id: 'denied-sidebar', label: 'Denied' })
        ).toThrow(/ui\.sidebar\.register/);
        expect(live.sidebar.size).toBe(0);
        await trusted.dispose();
    });

    it('loads a tactics-style register(api) plugin through the unified runtime', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'or3-tactics',
            version: '0.1.0',
            grants: TRUSTED_HOST_GRANTS,
        });
        const plugin = {
            id: 'or3-tactics',
            register(api: typeof trusted.workspaceApi) {
                api.registerSidebarPage({
                    id: 'tactics-sidebar',
                    label: 'Tactics',
                    icon: 'i-lucide-swords',
                    component: { name: 'TacticsSidebar' },
                });
                api.registerPaneApp({
                    id: 'tactics-pane',
                    label: 'Tactics',
                    component: { name: 'TacticsPane' },
                });
            },
        };

        await plugin.register(trusted.workspaceApi);

        expect(live.sidebar.has('tactics-sidebar')).toBe(true);
        expect(live.panes.has('tactics-pane')).toBe(true);
        await trusted.dispose();
        expect(live.sidebar.size).toBe(0);
        expect(live.panes.size).toBe(0);
    });

    it('opens, focuses, and closes a pane through the host multi-pane api', async () => {
        const panes: Array<{ id: string; mode: string; threadId: string; messages: []; validating: boolean }> = [];
        const api = {
            panes: { value: panes },
            activePaneIndex: { value: 0 },
            setActive: vi.fn((index: number) => {
                api.activePaneIndex.value = index;
            }),
            newPaneForApp: vi.fn(async (appId: string) => {
                panes.push({
                    id: `pane-${appId}`,
                    mode: appId,
                    threadId: '',
                    messages: [],
                    validating: false,
                });
            }),
            setPaneApp: vi.fn(),
            getPaneIndexById: (id: string) => panes.findIndex((pane) => pane.id === id),
            closePane: vi.fn(async (index: number) => {
                panes.splice(index, 1);
            }),
        };
        (globalThis as { __or3MultiPaneApi?: typeof api }).__or3MultiPaneApi = api;

        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.panes',
            version: '1.0.0',
            grants: TRUSTED_HOST_GRANTS,
        });

        const opened = await trusted.context.panes.open({
            app: 'trusted-pane',
            data: { ready: true },
        });
        expect(opened.ok).toBe(true);
        if (opened.ok) {
            expect(opened.value.id).toBe('pane-trusted-pane');
            const focused = await trusted.context.panes.focus(opened.value.id);
            expect(focused.ok).toBe(true);
            const closed = await trusted.context.panes.close(opened.value.id);
            expect(closed.ok).toBe(true);
        }
        expect(panes).toEqual([]);
        await trusted.dispose();
    });

    it('provides the approved workspace identity and disposes change subscriptions', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const subscription: {
            emit?: (change: { previousId: string; id: string; reason: 'host' }) => void;
        } = {};
        const stop = vi.fn();
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.workspace',
            version: '1.0.0',
            workspaceId: 'workspace-one',
            grants: ['workspace.read'],
            subscribeWorkspaceChanges(listener) {
                subscription.emit = listener;
                return { dispose: stop };
            },
        });
        const changes: string[] = [];
        expect(trusted.context.workspace.id).toBe('workspace-one');
        trusted.context.workspace.onChange((change) => { changes.push(change.id); });
        subscription.emit?.({ previousId: 'workspace-one', id: 'workspace-two', reason: 'host' });
        expect(changes).toEqual(['workspace-two']);
        await trusted.dispose();
        expect(stop).toHaveBeenCalledOnce();
    });

    it('forwards approved chat hooks and stops them with the plugin', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const listeners = new Map<string, (...args: unknown[]) => unknown>();
        const disposed: string[] = [];
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.workflow', version: '1.0.0', grants: ['hooks.register'],
            features: ['or3-trusted-host-v1', 'chat.send.prepare-commit-v1'],
            subscribeHook(name, kind, callback) {
                const key = `${kind}:${name}`;
                listeners.set(key, callback);
                return () => { listeners.delete(key); disposed.push(key); };
            },
        });
        const seen: unknown[] = [];
        expect(trusted.context.features.has('chat.send.prepare-commit-v1')).toBe(true);
        trusted.context.hooks.onFilter('ai.chat.send:filter:prepare', (payload: import('~~/shared/hooks/hook-domain-types').ChatSendPreparation) => payload);
        trusted.context.hooks.onFilter('ai.chat.send:filter:commit', (payload: import('~~/shared/hooks/hook-domain-types').ChatSendCommit) => ({ ...payload, status: 'handled' as const }));
        trusted.context.hooks.onAction('ai.chat.send:action:before', (payload) => {
            seen.push(payload);
        });
        trusted.context.hooks.onFilter('ai.chat.messages:filter:before_send', (payload) => ({
            messages: [], original: payload,
        }));
        const context = { assistant: { id: 'assistant-1', streamId: 'stream-1' } };
        await listeners.get('action:ai.chat.send:action:before')?.(context);
        expect(seen).toEqual([context]);
        expect(await listeners.get('filter:ai.chat.messages:filter:before_send')?.({ messages: [1] }))
            .toEqual({ messages: [], original: { messages: [1] } });
        expect(() => trusted.context.hooks.onAction('auth.session:action:changed', () => {}))
            .toThrow(/not available/);
        await trusted.dispose();
        expect(listeners.size).toBe(0);
        expect(disposed).toHaveLength(4);
    });

    it('releases later hook subscriptions when one unsubscribe throws', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const disposed: string[] = [];
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.cleanup', version: '1.0.0', grants: ['hooks.register'],
            subscribeHook(name) {
                return () => {
                    disposed.push(name);
                    if (name === 'ai.chat.send:action:before') throw new Error('unsubscribe failed');
                };
            },
        });
        trusted.context.hooks.onAction('ai.chat.send:action:before', () => {});
        trusted.context.hooks.onFilter('ai.chat.messages:filter:before_send', (value) => value);
        const result = await trusted.dispose();
        expect(result.status).toBe('degraded');
        expect(disposed).toEqual(['ai.chat.send:action:before', 'ai.chat.messages:filter:before_send']);
    });

    it('registers a slash extension and intercepts the send', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.editor',
            version: '1.0.0',
            grants: TRUSTED_HOST_GRANTS,
        });
        const commands: string[] = [];
        trusted.context.contributions.register({
            kind: 'editor.extension',
            id: 'slash-fixture',
            definition: {
                extension: slashFixtureExtension(),
                suggestion: { char: '/' },
                onSlashCommand(command: string) {
                    commands.push(command);
                    return true;
                },
            },
        });

        const extensions = trusted.editor.applyExtensions([]);
        expect(extensions.some((entry) => (entry as { name?: string }).name === 'slash-fixture')).toBe(true);
        await expect(trusted.editor.handleBeforeSend('/hello')).resolves.toBe(true);
        expect(commands).toEqual(['hello']);
        await trusted.dispose();
        await expect(trusted.editor.handleBeforeSend('/hello')).resolves.toBe(false);
    });

    it('contributes an execution model and removes it on dispose', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.models',
            version: '1.0.0',
            grants: TRUSTED_HOST_GRANTS,
        });
        trusted.tools.registerModel({ id: 'fixture/phase3-model', name: 'Phase 3' });
        expect(readTrustedExecutionModel('fixture/phase3-model')?.name).toBe('Phase 3');
        await trusted.dispose();
        expect(readTrustedExecutionModel('fixture/phase3-model')).toBeUndefined();
    });

    it('streams, stores the agent vault key, and stages a file through approved mediation', async () => {
        const encoder = new TextEncoder();
        const requests: Array<{ url: string; authorization: string | null; method: string; body: string | null }> = [];
        const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({
                url: String(input),
                authorization: new Headers(init?.headers).get('Authorization'),
                method: init?.method ?? 'GET',
                body: typeof init?.body === 'string' ? init.body : null,
            });
            if (String(input).endsWith('/health')) {
                return new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } });
            }
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode('data: hello\r\ndata: world\r\n\r\n'));
                        controller.close();
                    },
                })
            );
        }) as typeof fetch;
        const secretStorage = new Map<string, string>();
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.mediation',
            version: '1.0.0',
            grants: TRUSTED_HOST_GRANTS,
            mediation: {
                fetch: fetchImpl,
                approvedDestinations: ['agent-host'],
                secrets: createLocalStorageSecretStore({
                    getItem: (key) => secretStorage.get(key) ?? null,
                    setItem: (key, value) => {
                        secretStorage.set(key, value);
                    },
                    removeItem: (key) => {
                        secretStorage.delete(key);
                    },
                }),
                files: createMemoryFileStore(),
                posts: createMemoryPostStore(),
            },
        });

        const streamed = await trusted.context.network.stream({
            url: 'https://agent-host.example/events',
            destination: 'agent-host',
            format: 'sse',
            method: 'POST',
            headers: { Authorization: 'Bearer stream-token' },
            body: 'resume',
        });
        expect(streamed.ok).toBe(true);
        if (streamed.ok) {
            const values: string[] = [];
            for await (const chunk of streamed.value.chunks) {
                if (typeof chunk.data === 'string') values.push(chunk.data);
            }
            expect(values).toEqual(['hello\nworld']);
            await expect(streamed.value.result).resolves.toMatchObject({ ok: true });
        }
        expect(requests[0]).toEqual({
            url: 'https://agent-host.example/events',
            authorization: 'Bearer stream-token', method: 'POST', body: 'resume',
        });

        const health = await trusted.context.http.fetch({
            url: 'https://agent-host.example/health', destination: 'agent-host',
            headers: { Authorization: 'Bearer health-token' },
        });
        expect(health.ok).toBe(true);
        if (health.ok) expect(new TextDecoder().decode(health.value.body as Uint8Array)).toBe('{"status":"ok"}');
        expect(requests[1]?.authorization).toBe('Bearer health-token');

        const blocked = await trusted.context.network.stream({
            url: 'https://other.example/events',
            destination: 'other',
            format: 'sse',
        });
        expect(blocked.ok).toBe(false);
        const blockedHttp = await trusted.context.http.fetch({
            url: 'https://other.example/health', destination: 'other',
        });
        expect(blockedHttp.ok).toBe(false);

        await trusted.context.secrets.set(EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY, 'sealed');
        const secret = await trusted.context.secrets.get(EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY);
        expect(secret.ok && secret.value).toBe('sealed');
        expect(secretStorage.get(EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY)).toBe('sealed');

        const written = await trusted.context.files.write({
            name: 'note.txt',
            mimeType: 'text/plain',
            data: (async function* () {
                yield encoder.encode('staged');
            })(),
        });
        expect(written.ok).toBe(true);
        if (written.ok) {
            const read = await trusted.context.files.read(written.value.id);
            expect(read.ok).toBe(true);
        }

        const created = await trusted.posts.write({ postType: 'note', title: 'One' });
        expect(created.ok).toBe(true);
        const listed = await trusted.posts.read('note');
        expect(listed.ok && listed.value).toEqual([{ id: 'post-1', title: 'One' }]);
        await trusted.dispose();
    });

    it('renders a plugin message row and keeps the default row when none is registered', async () => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({
            pluginId: 'fixture.renderer',
            version: '1.0.0',
            grants: TRUSTED_HOST_GRANTS,
        });
        const plain = { id: 'm1', isWorkflow: false, text: 'Hello' };
        expect(messageRowKind(plain, null)).toBe('default');
        expect(resolveMessageRenderer(plain)).toBeNull();

        const component = defineComponent({
            name: 'PluginRow',
            props: { message: { type: Object, required: true } },
            setup: (props) => () => h('p', (props.message as { text: string }).text),
        });
        const seen: Array<string | null> = [];
        const stop = watch(
            () => resolveMessageRenderer(plain)?.id ?? null,
            (id) => {
                seen.push(id);
            },
            { immediate: true }
        );
        expect(seen).toEqual([null]);
        trusted.context.contributions.register({
            kind: 'chat.message.renderer',
            id: 'plugin-row-live',
            definition: {
                match: (message: unknown) => (message as { id?: string }).id === 'm1',
                component,
            },
        });
        await nextTick();
        expect(seen.at(-1)).toBe('plugin-row-live');
        stop();
        expect(resolveMessageRenderer(plain)?.component).toBe(component);
        expect(messageRowKind(plain, resolveMessageRenderer(plain))).toBe('custom');
        await trusted.dispose();
        expect(resolveMessageRenderer(plain)).toBeNull();
        expect(messageRowKind(plain, null)).toBe('default');
    });

    it.each([
        ['editor.extension', { id: 'denied-editor', extension: slashFixtureExtension() }],
        ['chat.message.renderer', { id: 'denied-renderer', match: () => true, component: defineComponent({}) }],
    ] as const)('requires the reviewed grant for %s contributions', async (kind, definition) => {
        const { createTrustedHostContext } = await import('../trusted-host-context');
        const trusted = createTrustedHostContext({ pluginId: 'fixture.denied', version: '1.0.0', grants: [] });
        expect(() => trusted.context.contributions.register({ kind, id: definition.id, definition }))
            .toThrow(/Grant/);
        await trusted.dispose();
    });

    it('scopes captured records and conditionally updates message data in one transaction', async () => {
        const db = new Dexie(`trusted-records-${crypto.randomUUID()}`);
        db.version(1).stores({ posts: 'id,postType', messages: 'id,thread_id,data.type' });
        const posts = db.table('posts');
        const messages = db.table('messages');
        let current = true;
        const records = createScopedRecordStore(
            Object.assign(db, { posts, messages }) as Parameters<typeof createScopedRecordStore>[0],
            { postType: 'fixture-record', messageType: 'fixture-execution' },
            () => { if (!current) throw new Error('Workspace changed'); }
        );
        try {
            await posts.bulkPut([
                { id: 'owned', postType: 'fixture-record', title: 'Owned', meta: '{raw}', deleted: false },
                { id: 'foreign', postType: 'another-record', title: 'Foreign', deleted: false },
                { id: 'deleted', postType: 'fixture-record', title: 'Deleted', deleted: true },
            ]);
            const row = (id: string, clock = 2) => ({
                id, thread_id: 'thread', role: 'assistant', data: { type: 'fixture-execution', state: 'running' },
                clock, pending: true, created_at: 1, updated_at: 1, index: 1, deleted: false,
            });
            await messages.bulkPut([row('first'), row('second'), { ...row('other'), data: { type: 'other', state: 'running' } }]);
            expect((await records.posts.list()).map((post) => post.id)).toEqual(['owned']);
            expect((await records.posts.get('owned'))?.meta).toBe('{raw}');
            expect(await records.posts.get('foreign')).toBeNull();
            expect(await records.posts.get('deleted')).toBeNull();
            expect(await records.messages.get('other')).toBeNull();
            await records.messages.updateData([
                { id: 'first', ifClock: 1, ifData: row('first').data, data: { type: 'fixture-execution', state: 'stale' }, pending: false },
                { id: 'second', ifClock: 2, ifData: row('second').data, data: { type: 'fixture-execution', state: 'done' }, pending: false },
                { id: 'other', ifClock: 2, ifData: { type: 'other' }, data: { type: 'fixture-execution', state: 'done' }, pending: false },
            ]);
            expect((await messages.get('first')).data.state).toBe('running');
            expect(await messages.get('second')).toMatchObject({ clock: 3, pending: false, data: { state: 'done' } });
            expect((await messages.get('other')).data.state).toBe('running');
            await expect(records.messages.updateData([
                { id: 'first', ifClock: 2, ifData: row('first').data, data: { type: 'another-type' }, pending: false },
            ])).rejects.toThrow(/message type/);
            await messages.put({ ...row('first'), data: { type: 'fixture-execution', state: 'resumed' } });
            await records.messages.updateData([
                { id: 'first', ifClock: 2, ifData: row('first').data, data: { type: 'fixture-execution', state: 'interrupted' }, pending: false },
            ]);
            expect((await messages.get('first')).data.state).toBe('resumed');
            await messages.put(row('first'));
            await messages.put(row('second'));
            const interrupt = () => { current = false; };
            messages.hook('updating', interrupt);
            await expect(records.messages.updateData(['first', 'second'].map((id) => ({
                id, ifClock: 2, ifData: row(id).data, data: { type: 'fixture-execution', state: 'interrupted' }, pending: false,
            })))).rejects.toThrow('Workspace changed');
            messages.hook('updating').unsubscribe(interrupt);
            expect((await messages.get('first')).data.state).toBe('running');
            expect((await messages.get('second')).data.state).toBe('running');
            await expect(records.posts.list()).rejects.toThrow('Workspace changed');
            await expect(records.messages.get('first')).rejects.toThrow('Workspace changed');
        } finally {
            await db.delete();
        }
    });

    it('keeps installed Workflow packages working through their legacy record callbacks', async () => {
        const { createLegacyWorkflowRecordAccess } = await import('../workflow-records-compat');
        const meta = { nodes: [], edges: [], meta: { version: '2.0.0' } };
        const records = {
            posts: {
                get: async () => ({ id: 'saved', title: 'Saved workflow', meta: JSON.stringify(meta), updated_at: 2, created_at: 1 }),
                list: async () => [{ id: 'saved', title: 'Saved workflow', meta: JSON.stringify(meta), updated_at: 2, created_at: 1 }],
            },
            messages: {
                get: async () => null, list: async () => [], listByThread: async () => [], updateData: async () => {},
            },
        };
        const legacy = createLegacyWorkflowRecordAccess(records as Parameters<typeof createLegacyWorkflowRecordAccess>[0]);
        expect(await legacy.getWorkflowById('saved')).toMatchObject({ id: 'saved', meta });
        expect(await legacy.getWorkflowByName('Saved workflow')).toMatchObject({ id: 'saved', meta });
        expect(await legacy.searchWorkflows(' saved ', 1)).toEqual([{ id: 'saved', label: 'Saved workflow', updatedAt: 2 }]);
        expect(await legacy.listWorkflowNames()).toEqual(['Saved workflow']);
        expect(await legacy.getMessage('missing')).toBeNull();
        expect(await legacy.activityStore.list()).toEqual([]);
        await expect(legacy.reconcileInterruptedRuns()).resolves.toBeUndefined();
    });
});
