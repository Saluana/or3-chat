import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { SyncGatewayAdapter } from '~~/server/sync/gateway/types';
import { registerSyncGatewayAdapter } from '~~/server/sync/gateway/registry';
import { registerAuthWorkspaceStore } from '~~/server/auth/store/registry';
import type { AuthWorkspaceStore } from '~~/server/auth/store/types';
import type { CanonicalHistoryActor } from '~~/shared/chat/background-history';
import type { CanonicalChatQuery } from '~~/shared/chat/history-reader';
import { clearAllJobs, memoryJobProvider } from '../../background-jobs/providers/memory';
import { resetJobProvider } from '../../background-jobs/store';
import { useRuntimeConfig } from '#imports';
import { createWorkflowServerBridge } from '../plugin-server-bridge';

const fixture = vi.hoisted(() => ({ role: 'owner', projectId: null as string | null, deleted: false, send: vi.fn() }));
vi.mock('~~/server/auth/session', () => ({ resolveSessionContext: async () => ({ authenticated: true, user: { id: 'owner' }, workspace: { id: 'workspace', name: 'Fixture' }, role: 'owner' }) }));
vi.mock('~~/shared/openrouter', async load => ({
    ...(await load<Record<string, unknown>>()),
    createOpenRouterClient: (config: { httpClient?: { request(input: Request): Promise<Response> } }) => ({ chat: { send: async () => {
        if (config.httpClient) await config.httpClient.request(new Request('https://provider.example.test/chat', { method: 'POST' }));
        fixture.send(); return {};
    } } }),
}));
// Real job records, membership/canonical readers and SDK HTTP boundary. A saved
// workflow may outlive its permission, owning project, message or input object.
beforeEach(() => {
    clearAllJobs(); resetJobProvider(); fixture.role = 'owner'; fixture.projectId = null; fixture.deleted = false; fixture.send.mockClear();
    const config = { public: { sync: { provider: 'workflow-dispatch' } }, sync: { provider: 'workflow-dispatch' }, backgroundJobs: { storageProvider: 'memory' } };
    vi.stubGlobal('useRuntimeConfig', () => config);
    vi.mocked(useRuntimeConfig).mockReturnValue(config as ReturnType<typeof useRuntimeConfig>);
    registerAuthWorkspaceStore({ id: 'workflow-dispatch', create: () => ({ listUserWorkspaces: async () => [{ id: 'workspace', name: 'Fixture', role: fixture.role }] }) as unknown as AuthWorkspaceStore });
    registerSyncGatewayAdapter({ id: 'workflow-dispatch', create: () => ({ capabilities: { canonicalChatHistory: 'v1' }, readChatHistory: async (_actor: CanonicalHistoryActor, query: CanonicalChatQuery) => query.kind === 'thread'
        ? { status: 'ok', project_ownership: 'resolved', thread: { id: query.thread_id, project_id: fixture.projectId } }
        : { status: 'ok', messages: [{ id: 'execution', thread_id: 'thread', deleted: fixture.deleted, data: { type: 'workflow-execution' } }] } }) as unknown as SyncGatewayAdapter });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
});
afterEach(() => { clearAllJobs(); resetJobProvider(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function client() {
    const jobId = await memoryJobProvider.createJob({ userId: 'owner', threadId: 'thread', messageId: 'execution', model: 'model', kind: 'workflow',
        historyPhase: 'committed', execution: { version: 1, kind: 'workflow', workspaceId: 'workspace' } });
    const origin = { jobId, userId: 'owner', workspaceId: 'workspace', threadId: 'thread', messageId: 'execution' };
    const bridge = createWorkflowServerBridge({} as H3Event);
    return { origin, bridge, config: bridge.createOpenRouterClient({ apiKey: 'fixture', origin }) };
}
describe('workflow server provider boundary', () => {
    it.each(['project', 'viewer', 'deleted', 'ordinary'] as const)('rechecks persisted run authorization before inference (%s)', async kind => {
        const { config } = await client();
        if (kind === 'project') fixture.projectId = 'project';
        if (kind === 'viewer') fixture.role = 'viewer';
        if (kind === 'deleted') fixture.deleted = true;
        const sending = config.client.chat.send({ chatRequest: { model: 'model', messages: [], stream: false } });
        if (kind === 'ordinary') { await sending; expect(fixture.send).toHaveBeenCalledOnce(); }
        else { await expect(sending).rejects.toThrow(); expect(fixture.send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); }
    });
    it('keeps captured identity and rechecks ownership at the next dispatch', async () => {
        const { config, origin } = await client(); origin.threadId = 'different';
        await config.client.chat.send({ chatRequest: { model: 'model', messages: [], stream: false } });
        fixture.projectId = 'project';
        await expect(config.client.chat.send({ chatRequest: { model: 'model', messages: [], stream: false } })).rejects.toThrow(/project/i);
        expect(fetch).toHaveBeenCalledOnce();
    });
    it('keeps context-free older package requests working behind job admission', async () => {
        // Transition: job creation refuses project chats; only the per-request move fence needs an origin.
        const { bridge } = await client();
        await bridge.createOpenRouterClient({ apiKey: 'fixture' }).client.chat.send({ chatRequest: { model: 'model', messages: [], stream: false } });
        expect(fetch).toHaveBeenCalledOnce(); expect(fixture.send).toHaveBeenCalledOnce();
    });
});
