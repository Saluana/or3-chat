import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';
import type { Message } from '~/db/schema';
import type { SessionContext } from '~/core/hooks/hook-types';

const session = vi.hoisted(() => ({ current: null as SessionContext | null }));
const inference = vi.hoisted(() => ({ send: vi.fn(async () => ({ choices: [{ message: { content: 'caption' } }] })) }));
vi.mock('~~/shared/openrouter', async load => ({
    ...(await load<Record<string, unknown>>()),
    createOpenRouterClient: (config: { httpClient?: { request(request: Request): Promise<Response> } }) => ({ chat: { send: async () => {
        // Exercise the actual SDK HTTP client, including its last fetch fence.
        if (config.httpClient) await config.httpClient.request(new Request('https://provider.example.test/chat', { method: 'POST' }));
        return inference.send();
    } } }),
}));

vi.mock('@nuxt/ui/components/Badge.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Button.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/DropdownMenu.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/FieldGroup.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Icon.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Input.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Modal.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Popover.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Tabs.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Textarea.vue', () => ({ default: {} }));
vi.mock('@nuxt/ui/components/Tooltip.vue', () => ({ default: {} }));
vi.mock('~/components/chat/MessageAttachmentsGallery.vue', () => ({ default: {} }));
vi.mock('streamdown-vue', () => ({ StreamMarkdown: {}, useShikiHighlighter: () => ({}) }));
vi.mock('#imports', async load => ({
    ...(await load<Record<string, unknown>>()),
    useAppConfig: () => ({}),
    useRuntimeConfig: () => testRuntimeConfig.value,
    useHooks: (await import('~/core/hooks/useHooks')).useHooks,
}));
vi.mock('~/composables/chat/useModelStore', () => ({ useModelStore: () => ({ catalog: ref([]), favoriteModels: ref([]) }) }));
vi.mock('~/core/auth/useUserApiKey', () => ({ useUserApiKey: () => ({ apiKey: ref('fixture') }) }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: ref(null) }),
    getCachedSessionContext: () => session.current,
    getCachedSessionPayload: () => null,
}));
vi.mock('~/utils/chat/tool-registry', () => ({ useToolRegistry: () => ({}) }));
vi.mock('~/composables/useIcon', () => ({ useIcon: (name: string) => ref(name) }));

import { createTrustedRecords } from '../trusted-records';
vi.mock('~/composables/plugins/trusted-ui-kit', () => ({ createTrustedUiKit: () => ({}) }));
import { createTrustedRuntimeServices } from '../trusted-runtime-services';
import { createOrRefFile } from '~/db/files';
import { dataUrlToBlob } from '~/utils/chat/files';
import { getDb } from '~/db/client';
import type { PluginResult, PluginAiOrigin } from '@or3/plugin-sdk';

function value<T>(result: PluginResult<T>): T {
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
}
// Bind the same public SDK clients used by the installed Workflows adapter.
// This only unwraps results; all ownership, authorization and writes are real.
function createSdkPorts() {
    const records = createTrustedRecords({ db, allow() {}, current: () => getDb() === db,
        inBeforeSend: () => false, cleanup() {}, postTypes: new Set(['workflow-entry']),
        messageTypes: new Set(['workflow-execution']) });
    const services = createTrustedRuntimeServices({ db, pluginId: 'or3-workflows',
        messageTypes: new Set(['workflow-execution']), allow() {}, current: () => getDb() === db, cleanup() {} });
    const provider = async (_key: string, origin?: PluginAiOrigin) => value(await services.ai.provider(origin)) as {
        client: { chat: { send(input: unknown): Promise<unknown> } };
    };
    return {
        sendPorts: {
            upsertWorkflowMessage: async (input: Parameters<typeof records.messages.upsert>[0]) => value(await records.messages.upsert(input)),
            completeCaption: async (input: { modelId: string; apiKey: string; imageUrls: string[]; origin?: PluginAiOrigin }) => (await provider('fixture', input.origin)).client.chat.send({}),
        },
        records: { messages: { updateData: async (input: Parameters<typeof records.messages.updateData>[0]) => value(await records.messages.updateData(input)) } },
        executionPorts: {
            createOpenRouterClient: provider,
            async persistGeneratedImage(messageId: string, url: string) {
                const row = value(await records.messages.get(messageId));
                if (!row) throw new Error('Message not found');
                await provider('fixture', { threadId: row.threadId, messageId, streamId: row.streamId });
                const blob = dataUrlToBlob(url);
                if (!blob) throw new Error('Invalid generated image');
                const file = await createOrRefFile(blob, 'workflow-generated-image');
                records.retainFile(file.hash);
                value(await records.messages.attachFile(messageId, { id: file.hash, name: 'workflow-generated-image',
                    mimeType: blob.type, size: blob.size, origin: 'generated' }));
                return file.hash;
            },
        },
    };
}

// Real host ports and Dexie writes own this boundary. Failure inventory: a
// supplied message ID from another thread/stream, deleted/non-workflow rows,
// owner changes after preparation, and generated images targeting a project.
// Existing send tests substitute their own upsert port and cannot catch these.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM3sAAAAASUVORK5CYII=';
let db: ReturnType<typeof setActiveWorkspaceDb>;
let bridge: ReturnType<typeof createSdkPorts>;
let workspaceId: string;
let ssr: boolean;
const originalBlob = globalThis.Blob;
const data = { type: 'workflow-execution', executionState: 'running' };
const message = (overrides: Partial<Message> = {}): Message => ({
    id: 'execution', thread_id: 'ordinary', stream_id: 'run', role: 'assistant',
    data, pending: true, index: 1000, file_hashes: null, error: null,
    clock: 1, created_at: 1, updated_at: 1, deleted: false, ...overrides,
});
const input = () => ({ id: 'execution', threadId: 'ordinary', streamId: 'run',
    data: { ...data, executionState: 'completed' }, pending: false });

beforeEach(async () => {
    inference.send.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    ssr = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    session.current = null;
    globalThis.Blob = NodeBlob as unknown as typeof Blob;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    workspaceId = `workflow-write-${crypto.randomUUID()}`;
    db = setActiveWorkspaceDb(workspaceId);
    await db.open();
    await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 1, created_at: 1, updated_at: 1, deleted: false });
    const base = { status: 'ready' as const, pinned: false, forked: false, clock: 1, created_at: 1, updated_at: 1, deleted: false };
    await db.threads.bulkPut([{ ...base, id: 'ordinary', title: 'Ordinary' }, { ...base, id: 'foreign', title: 'Project', project_id: 'project' }]);
    bridge = createSdkPorts();
});
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspaceId);
    await Dexie.delete(db.name);
    setHookEngine(null);
    globalThis.Blob = originalBlob;
    testRuntimeConfig.value.public.ssrAuthEnabled = ssr;
});

function beforeMessageTransaction(effect: () => Promise<void> | void) {
    const transaction = db.transaction;
    let moved = false;
    vi.spyOn(db, 'transaction').mockImplementation((...args: unknown[]) => {
        if (!moved && args.slice(1, -1).flat().includes('messages')) {
            moved = true;
            return Dexie.Promise.resolve(effect()).then(() => Reflect.apply(transaction, db, args));
        }
        return Reflect.apply(transaction, db, args);
    });
}
function moveBeforeMessageTransaction() {
    beforeMessageTransaction(async () => { await db.threads.update('ordinary', { project_id: 'project' }); });
}
function authenticate(role: SessionContext['role']) {
    testRuntimeConfig.value.public.ssrAuthEnabled = true;
    session.current = { authenticated: true, user: { id: 'user' }, workspace: { id: workspaceId, name: 'Workspace' }, role, authorizationRevision: 1 };
}
const write = (kind: 'message' | 'image') => kind === 'message'
    ? bridge.sendPorts.upsertWorkflowMessage(input())
    : bridge.executionPorts.persistGeneratedImage('execution', png);

describe('workflow host write authorization', () => {
    it.each(['missing', 'project', 'deleted', 'ordinary', 'moved', 'revoked'] as const)('fences model and caption dispatch against their originating message (%s)', async kind => {
        const origin = { threadId: kind === 'project' ? 'foreign' : 'ordinary', messageId: 'execution', streamId: 'run' };
        await db.messages.put(message({ thread_id: origin.threadId, deleted: kind === 'deleted' }));
        if (kind === 'revoked') authenticate('editor');
        // Passing a second argument exercises the package/host contract without
        // replacing the real authorization, ownership or message readers.
        const configuration = Reflect.apply(bridge.executionPorts.createOpenRouterClient, null, ['fixture', kind === 'missing' ? undefined : origin]);
        if (kind === 'project' || kind === 'deleted') {
            await expect(configuration).rejects.toThrow();
            expect(inference.send).not.toHaveBeenCalled();
            return;
        }
        const config = await configuration;
        if (kind === 'moved') await db.threads.update('ordinary', { project_id: 'project' });
        if (kind === 'revoked') session.current = { ...session.current!, authorizationRevision: 2 };
        const model = () => config.client.chat.send({ chatRequest: { model: 'model', messages: [], stream: false } });
        const caption = () => {
            if (kind === 'revoked') {
                const get = db.messages.get.bind(db.messages);
                vi.spyOn(db.messages, 'get').mockImplementation((...args: Parameters<typeof get>) => {
                    session.current = { ...session.current!, authorizationRevision: 3 };
                    return get(...args);
                });
            }
            return bridge.sendPorts.completeCaption({ modelId: 'model', apiKey: 'fixture', imageUrls: [png], ...(kind === 'missing' ? {} : { origin }) });
        };
        if (kind === 'ordinary') {
            await model(); await caption();
            expect(inference.send).toHaveBeenCalledTimes(2);
        } else {
            await expect(model()).rejects.toThrow();
            await expect(caption()).rejects.toThrow();
            expect(inference.send).not.toHaveBeenCalled();
        }
    });

    it('captures model origin once and rechecks every dispatch without following caller mutations', async () => {
        await db.messages.put(message());
        const origin = { threadId: 'ordinary', messageId: 'execution', streamId: 'run' };
        const config = await Reflect.apply(bridge.executionPorts.createOpenRouterClient, null, ['fixture', origin]);
        origin.threadId = 'foreign';
        await config.client.chat.send({ chatRequest: { model: 'model', messages: [], stream: false } });
        await db.threads.update('ordinary', { project_id: 'project' });
        await expect(config.client.chat.send({ chatRequest: { model: 'model', messages: [], stream: false } })).rejects.toThrow(/project/i);
        expect(inference.send).toHaveBeenCalledOnce();
    });

    it.each([false, true])('refuses invalid workflow data instead of changing the message type (existing: %s)', async existing => {
        const original = message();
        if (existing) await db.messages.put(original);
        const submission = { ...input(), data: { type: 'ordinary-message', content: 'Wrong record type' } };
        await expect(bridge.sendPorts.upsertWorkflowMessage(submission)).rejects.toThrow(/registered/i);
        expect(await db.messages.get(original.id)).toEqual(existing ? original : undefined);
    });

    it.each(['project', 'viewer', 'move', 'editor'] as const)('authorizes the scoped record update port (%s)', async kind => {
        const original = message({ thread_id: kind === 'project' ? 'foreign' : 'ordinary' });
        await db.messages.put(original);
        if (kind === 'viewer' || kind === 'editor') authenticate(kind);
        if (kind === 'move') moveBeforeMessageTransaction();
        const result = bridge.records.messages.updateData([{ id: original.id, ifClock: original.clock,
            ifData: original.data, data: input().data, pending: false }]);
        if (kind === 'editor') {
            await result;
            expect((await db.messages.get(original.id))?.pending).toBe(false);
        } else {
            await expect(result).rejects.toThrow(kind === 'viewer' ? /read-only/i : /project/i);
            expect(await db.messages.get(original.id)).toEqual(original);
        }
    });

    it('keeps the submitted message and data when the caller changes its input before commit', async () => {
        const original = message();
        await db.messages.bulkPut([original, { ...original, id: 'other-execution' }]);
        const submission = input();
        beforeMessageTransaction(() => {
            submission.id = 'other-execution';
            submission.data.executionState = 'different-output';
        });
        await bridge.sendPorts.upsertWorkflowMessage(submission);
        expect(await db.messages.get('execution')).toMatchObject({ pending: false, data: { executionState: 'completed' } });
        expect(await db.messages.get('other-execution')).toEqual({ ...original, id: 'other-execution' });
    });

    it.each(['message', 'image'] as const)('refuses a viewer %s write', async kind => {
        const original = message();
        await db.messages.put(original);
        authenticate('viewer');
        await expect(write(kind)).rejects.toThrow(/read-only/i);
        expect(await db.messages.get(original.id)).toEqual(original);
        expect(await db.file_meta.count()).toBe(0);
    });

    it.each(['message', 'image'] as const)('refuses a %s write after permission revocation during preparation', async kind => {
        const original = message();
        await db.messages.put(original);
        authenticate('editor');
        beforeMessageTransaction(() => { session.current = { ...session.current!, role: 'viewer', authorizationRevision: 2 }; });
        await expect(write(kind)).rejects.toThrow(/access changed/i);
        expect(await db.messages.get(original.id)).toEqual(original);
        expect((await db.file_meta.toArray()).every(meta => meta.ref_count === 0)).toBe(true);
    });

    it.each(['message', 'image'] as const)('allows an unchanged editor %s write', async kind => {
        await db.messages.put(message());
        authenticate('editor');
        await write(kind);
        const result = await db.messages.get('execution');
        if (kind === 'message') expect(result?.pending).toBe(false);
        else expect(JSON.parse(result!.file_hashes!)).toHaveLength(1);
    });

    it.each([
        ['foreign thread', { thread_id: 'foreign' }],
        ['foreign stream', { stream_id: 'other-run' }],
        ['deleted message', { deleted: true }],
        ['ordinary chat message', { data: { content: 'Private message' } }],
    ] as const)('refuses an upsert targeting a %s', async (_name, overrides) => {
        const original = message(overrides);
        await db.messages.put(original);
        await expect(bridge.sendPorts.upsertWorkflowMessage(input())).rejects.toThrow();
        expect(await db.messages.get(original.id)).toEqual(original);
    });

    it('refuses an upsert after the owner changes at the write boundary', async () => {
        const original = message();
        await db.messages.put(original);
        moveBeforeMessageTransaction();
        await expect(bridge.sendPorts.upsertWorkflowMessage(input())).rejects.toThrow(/project/i);
        expect(await db.messages.get(original.id)).toEqual(original);
    });

    it('creates and updates an ordinary workflow message without losing its identity', async () => {
        await bridge.sendPorts.upsertWorkflowMessage({ ...input(), pending: true, data });
        await bridge.sendPorts.upsertWorkflowMessage(input());
        expect(await db.messages.get('execution')).toMatchObject({ thread_id: 'ordinary', stream_id: 'run', data: input().data, pending: false });
    });

    it('refuses generated images for a project workflow message', async () => {
        const original = message({ thread_id: 'foreign' });
        await db.messages.put(original);
        await expect(bridge.executionPorts.persistGeneratedImage(original.id, png)).rejects.toThrow(/project/i);
        expect(await db.messages.get(original.id)).toEqual(original);
        expect(await db.file_meta.count()).toBe(0);
    });

    it('refuses generated image attachment after the owner changes during preparation', async () => {
        const original = message();
        await db.messages.put(original);
        moveBeforeMessageTransaction();
        await expect(bridge.executionPorts.persistGeneratedImage(original.id, png)).rejects.toThrow(/project/i);
        expect(await db.messages.get(original.id)).toEqual(original);
        expect((await db.file_meta.toArray()).every(meta => meta.ref_count === 0)).toBe(true);
    });

    it('attaches an ordinary generated image once and retains one file reference', async () => {
        await db.messages.put(message());
        const hash = await bridge.executionPorts.persistGeneratedImage('execution', png);
        expect(await bridge.executionPorts.persistGeneratedImage('execution', png)).toBe(hash);
        expect((await db.messages.get('execution'))?.file_hashes).toBe(JSON.stringify([hash]));
        expect((await db.file_meta.get(hash))?.ref_count).toBe(1);
    });
});
