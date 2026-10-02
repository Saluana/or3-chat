import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as h3 from 'h3';
import { memoryJobProvider, clearAllJobs } from '../../../utils/background-jobs/providers/memory';
import { resetJobProvider } from '../../../utils/background-jobs/store';
import type { BackgroundJobExecution } from '../../../utils/background-jobs/types';
import { emitJobDelta, hasJobViewers, resetJobViewersForTests } from '../../../utils/background-jobs/viewers';
import { createWorkflowServerBridge } from '../../../utils/workflows/plugin-server-bridge';
import { getScopedAdmissionKey } from '../../../utils/background-jobs/admission-cancels';
import { registerBackgroundJobProvider, resetBackgroundJobProviders } from '../../../utils/background-jobs/registry';
import { resetSyncRateLimits } from '../../../utils/sync/rate-limiter';
import { initializeSqliteDb, destroySqliteDb } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/db/kysely.js';
import { runMigrations } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/db/migrate.js';
import { SqliteBackgroundJobProvider } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/background-jobs/sqlite-provider.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as ts from 'typescript';
import * as convexValues from 'convex/values';
import { internalMutationGeneric, internalQueryGeneric } from 'convex/server';

const identity = vi.hoisted(() => ({ session: {
    authenticated: true, user: { id: 'former-member' },
    workspace: { id: 'remaining-workspace' }, role: 'editor',
} }));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: async () => identity.session }));
vi.mock('#imports', () => ({ useRuntimeConfig: () => (globalThis as unknown as { useRuntimeConfig: () => unknown }).useRuntimeConfig() }));
vi.mock('../../../utils/background-jobs/lifecycle', () => ({ claimAndRunBackgroundJob: vi.fn(async () => true) }));
const membership = vi.hoisted(() => ({ role: null as 'owner' | 'editor' | 'viewer' | null,
    active: false, onLookup: null as (() => Promise<void>) | null }));
vi.mock('../../../auth/store/registry', () => ({
    getAuthWorkspaceStore: () => ({
        listUserWorkspaces: async () => {
            const hook = membership.onLookup;
            membership.onLookup = null;
            await hook?.();
            return [
                ...(membership.role ? [{ id: 'revoked-workspace', name: 'Original', role: membership.role }] : []),
                ...(membership.active ? [{ id: 'remaining-workspace', name: 'Current', role: 'editor' }] : []),
            ];
        },
    }),
}));

describe('background job workspace authorization at the HTTP boundary', () => {
    let admissionId: string;
    beforeEach(() => {
        admissionId = crypto.randomUUID();
        clearAllJobs();
        resetJobProvider();
        resetJobViewersForTests();
        membership.role = null;
        membership.active = false;
        membership.onLookup = null;
        resetSyncRateLimits();
        vi.stubEnv('DISABLE_RATE_LIMIT', '0');
        for (const name of ['defineEventHandler', 'getRouterParam', 'getQuery', 'setHeader', 'setResponseStatus', 'sendStream', 'readBody'] as const) {
            vi.stubGlobal(name, h3[name]);
        }
        vi.stubGlobal('useRuntimeConfig', () => ({ auth: { enabled: true }, sync: { provider: 'sqlite' }, security: { proxy: {}, allowedOrigins: [] }, backgroundJobs: { storageProvider: 'memory' } }));
        identity.session = {
            authenticated: true, user: { id: 'former-member' },
            workspace: { id: 'remaining-workspace' }, role: 'editor',
        };
    });
    afterEach(() => { clearAllJobs(); resetJobProvider(); resetJobViewersForTests(); resetBackgroundJobProviders(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    async function createRevokedWorkspaceJob() {
        return memoryJobProvider.createJob({
            userId: 'former-member', threadId: 'private-thread', messageId: 'private-message',
            idempotencyKey: JSON.stringify(['or3-admission-v1', 'former-member', 'revoked-workspace', admissionId]),
            model: 'test/model', initialContent: 'private workspace content',
            execution: { workspaceId: 'revoked-workspace' } as BackgroundJobExecution,
        });
    }

    it.each(['status', 'stream'] as const)('denies %s reads after the owner loses workspace membership', async (endpoint) => {
        const jobId = await createRevokedWorkspaceJob();
        await memoryJobProvider.completeJob(jobId, 'private workspace content');
        const handler = endpoint === 'status'
            ? (await import('../[id]/status.get')).default
            : (await import('../[id]/stream.get')).default;
        const router = h3.createRouter().get('/api/jobs/:id/' + endpoint, handler);
        const send = h3.toWebHandler(h3.createApp().use(router));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/${endpoint}`));
        const body = await response.text();
        expect.soft([403, 404]).toContain(response.status);
        expect(body).not.toContain('private workspace content');
    });

    it.each([
        ['abort', 'viewer', 403],
        ['abort', 'editor', 200],
        ['admission-abort', 'viewer', 403],
        ['admission-abort', 'editor', 200],
    ] as const)('%s requires write access in the original workspace (%s)', async (endpoint, role, status) => {
        membership.role = role;
        const jobId = await createRevokedWorkspaceJob();
        const handler = endpoint === 'abort'
            ? (await import('../[id]/abort.post')).default
            : (await import('../admission-abort.post')).default;
        const path = endpoint === 'abort' ? `/api/jobs/${jobId}/abort` : '/api/jobs/admission-abort';
        const route = endpoint === 'abort' ? '/api/jobs/:id/abort' : path;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().post(route, handler)));
        const response = await send(new Request(`http://chat.example.test${path}`, {
            method: 'POST', headers: { host: 'chat.example.test', origin: 'http://chat.example.test', 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            body: JSON.stringify({ admissionId, workspaceId: 'revoked-workspace' }),
        }));
        await response.text();
        expect.soft(response.status).toBe(status);
        expect((await memoryJobProvider.getJob(jobId, 'former-member'))?.status).toBe(status === 200 ? 'aborted' : 'streaming');
    });

    it.each(['status', 'stream'] as const)('preserves %s access after switching active workspaces', async (endpoint) => {
        membership.role = 'viewer';
        const jobId = await createRevokedWorkspaceJob();
        await memoryJobProvider.completeJob(jobId, 'private workspace content');
        const handler = endpoint === 'status'
            ? (await import('../[id]/status.get')).default
            : (await import('../[id]/stream.get')).default;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().get('/api/jobs/:id/' + endpoint, handler)));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/${endpoint}`));
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('private workspace content');
    });

    it('closes an already-open stream when original workspace access is revoked', async () => {
        membership.role = 'editor';
        const jobId = await createRevokedWorkspaceJob();
        const handler = (await import('../[id]/stream.get')).default;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().get('/api/jobs/:id/stream', handler)));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/stream`));
        const reader = response.body!.getReader();
        try {
            expect(new TextDecoder().decode((await reader.read()).value)).toContain('private workspace content');
            membership.role = null;
            await vi.waitFor(() => expect(hasJobViewers(jobId)).toBe(false), { timeout: 2000 });
            expect((await reader.read()).done).toBe(true);
        } finally {
            await reader.cancel();
        }
    });

    it.each(['status', 'stream', 'abort'] as const)('denies a different user at %s as a negative control', async (endpoint) => {
        const jobId = await createRevokedWorkspaceJob();
        identity.session.user.id = 'different-user';
        const handler = endpoint === 'status' ? (await import('../[id]/status.get')).default
            : endpoint === 'stream' ? (await import('../[id]/stream.get')).default : (await import('../[id]/abort.post')).default;
        const router = h3.createRouter();
        if (endpoint === 'abort') router.post('/api/jobs/:id/abort', handler);
        else router.get('/api/jobs/:id/' + endpoint, handler);
        const send = h3.toWebHandler(h3.createApp().use(router));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/${endpoint}`, endpoint === 'abort' ? {
            method: 'POST', headers: { host: 'chat.example.test', origin: 'http://chat.example.test',
                'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: '{}',
        } : undefined));
        expect(response.status).toBe(endpoint === 'abort' ? 200 : 404);
        if (endpoint === 'abort') {
            expect(await response.json()).toMatchObject({ aborted: false });
            expect((await memoryJobProvider.getJob(jobId, 'former-member'))?.status).toBe('streaming');
        }
    });

    it('preserves authorized status, stream, and stop for a newly admitted workflow', async () => {
        membership.role = 'editor';
        identity.session.workspace.id = 'revoked-workspace';
        // This is the exact createJob payload in the supported workflow plugin.
        const admit = h3.toWebHandler(h3.createApp().use(h3.defineEventHandler(async (event) => {
            const provider = await createWorkflowServerBridge(event).getJobProvider();
            return { jobId: await provider.createJob({
                userId: 'former-member', threadId: 'workflow-thread', messageId: 'workflow-message',
                model: 'workflow', kind: 'workflow',
            }) };
        })));
        const admissionResponse = await admit(new Request('http://chat.example.test/workflow'));
        expect(admissionResponse.status).toBe(200);
        const { jobId } = await admissionResponse.json() as { jobId: string };
        const job = await memoryJobProvider.getJob(jobId, 'former-member');
        expect(job?.execution).toEqual({ version: 1, kind: 'workflow', workspaceId: 'revoked-workspace' });
        expect(await memoryJobProvider.claimJob!(jobId, 'chat-worker', Date.now(), Date.now() + 30_000)).toBeNull();
        await memoryJobProvider.completeJob(jobId, 'workflow result');
        const handler = (await import('../[id]/status.get')).default;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().get('/api/jobs/:id/status', handler)));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/status`));
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('workflow result');
        const streamHandler = (await import('../[id]/stream.get')).default;
        const stream = h3.toWebHandler(h3.createApp().use(h3.createRouter().get('/api/jobs/:id/stream', streamHandler)));
        const streamResponse = await stream(new Request(`http://chat.example.test/api/jobs/${jobId}/stream`));
        expect(streamResponse.status).toBe(200);
        expect(await streamResponse.text()).toContain('workflow result');
        const stopJobId = await memoryJobProvider.createJob({
            userId: 'former-member', threadId: 'workflow-thread', messageId: 'second-message',
            model: 'workflow', kind: 'workflow', historyPhase: 'committed', execution: job!.execution,
        });
        const abortHandler = (await import('../[id]/abort.post')).default;
        const stop = h3.toWebHandler(h3.createApp().use(h3.createRouter().post('/api/jobs/:id/abort', abortHandler)));
        const stopped = await stop(new Request(`http://chat.example.test/api/jobs/${stopJobId}/abort`, {
            method: 'POST', headers: { host: 'chat.example.test', origin: 'http://chat.example.test',
                'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: '{}',
        }));
        expect(stopped.status).toBe(200);
        expect((await memoryJobProvider.getJob(stopJobId, 'former-member'))?.status).toBe('aborted');
        membership.role = null;
        const removedResponse = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/status`));
        expect(removedResponse.status).toBe(403);
    });

    it('cannot cancel a revoked-workspace job that commits during another workspace\'s cancellation', async () => {
        membership.active = true;
        let committedJobId: string | undefined;
        membership.onLookup = async () => { committedJobId = await createRevokedWorkspaceJob(); };
        const handler = (await import('../admission-abort.post')).default;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().post('/api/jobs/admission-abort', handler)));
        const response = await send(new Request('http://chat.example.test/api/jobs/admission-abort', {
            method: 'POST', headers: { host: 'chat.example.test', origin: 'http://chat.example.test',
                'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            body: JSON.stringify({ admissionId, workspaceId: 'remaining-workspace' }),
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ aborted: false, pending: true });
        expect((await memoryJobProvider.getJob(committedJobId!, 'former-member'))?.status).toBe('streaming');
    });

    it('blocks live SSE output immediately after workspace membership removal', async () => {
        membership.role = 'editor';
        const jobId = await createRevokedWorkspaceJob();
        const handler = (await import('../[id]/stream.get')).default;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().get('/api/jobs/:id/stream', handler)));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/stream`));
        const reader = response.body!.getReader();
        try {
            await reader.read();
            membership.role = null;
            emitJobDelta(jobId, 'revoked live output', { contentLength: 100, chunksReceived: 1 });
            const next = await reader.read();
            expect(new TextDecoder().decode(next.value)).not.toContain('revoked live output');
        } finally {
            await reader.cancel();
        }
    });

    it('keeps authorized live deltas in order while rechecking membership', async () => {
        membership.role = 'viewer';
        const jobId = await createRevokedWorkspaceJob();
        const handler = (await import('../[id]/stream.get')).default;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().get('/api/jobs/:id/stream', handler)));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/stream`));
        const reader = response.body!.getReader();
        try {
            await reader.read();
            emitJobDelta(jobId, ' first', { contentLength: 31, chunksReceived: 1 });
            emitJobDelta(jobId, ' second', { contentLength: 38, chunksReceived: 2 });
            let delivered = '';
            while (!delivered.includes(' second')) {
                const next = await reader.read();
                expect(next.done).toBe(false);
                delivered += new TextDecoder().decode(next.value);
            }
            expect(delivered.indexOf(' first')).toBeGreaterThanOrEqual(0);
            expect(delivered.indexOf(' first')).toBeLessThan(delivered.indexOf(' second'));
        } finally { await reader.cancel(); }
    });

    it('closes a live authorization backlog at the existing SSE transport capacity', async () => {
        membership.role = 'editor';
        const jobId = await createRevokedWorkspaceJob();
        const { default: handler, MAX_SSE_VIEWER_QUEUE_BYTES } = await import('../[id]/stream.get');
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().get('/api/jobs/:id/stream', handler)));
        const response = await send(new Request(`http://chat.example.test/api/jobs/${jobId}/stream`));
        const reader = response.body!.getReader();
        let release!: () => void; let entered!: () => void;
        const slowLookup = new Promise<void>((resolve) => { release = resolve; });
        const lookupEntered = new Promise<void>((resolve) => { entered = resolve; });
        try {
            await reader.read();
            membership.onLookup = async () => { entered(); await slowLookup; };
            emitJobDelta(jobId, 'waiting', { contentLength: 32, chunksReceived: 1 });
            await lookupEntered;
            emitJobDelta(jobId, 'x'.repeat(MAX_SSE_VIEWER_QUEUE_BYTES), { contentLength: MAX_SSE_VIEWER_QUEUE_BYTES + 32, chunksReceived: 2 });
            expect(hasJobViewers(jobId)).toBe(false);
            expect((await reader.read()).done).toBe(true);
        } finally { release(); await reader.cancel(); }
    });

    it('scopes another user\'s admission cancellation without aborting the original owner\'s job', async () => {
        membership.role = 'editor';
        const jobId = await createRevokedWorkspaceJob();
        identity.session.user.id = 'different-user';
        const handler = (await import('../admission-abort.post')).default;
        const send = h3.toWebHandler(h3.createApp().use(h3.createRouter().post('/api/jobs/admission-abort', handler)));
        const response = await send(new Request('http://chat.example.test/api/jobs/admission-abort', {
            method: 'POST', headers: { host: 'chat.example.test', origin: 'http://chat.example.test',
                'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            body: JSON.stringify({ admissionId, workspaceId: 'revoked-workspace' }),
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ aborted: false, pending: true });
        expect((await memoryJobProvider.getJob(jobId, 'former-member'))?.status).toBe('streaming');
    });

    it.each(['workflow:background', 'workflow:hitl'] as const)('reserves %s before package work without counting its completion twice', async (rateKey) => {
        vi.stubGlobal('useRuntimeConfig', () => ({ limits: { operationRateLimits: { [rateKey]: { maxRequests: 2 } } } }));
        let release!: () => void;
        const work = new Promise<void>((resolve) => { release = resolve; });
        let entered = 0;
        const send = h3.toWebHandler(h3.createApp().use(h3.defineEventHandler(async (event) => {
            const bridge = createWorkflowServerBridge(event);
            const session = await bridge.authorize(event, rateKey);
            entered++;
            await work;
            bridge.recordRequest(session.userId, rateKey);
            return { admitted: true };
        })));
        const first = send(new Request('http://chat.example.test/workflow'));
        const second = send(new Request('http://chat.example.test/workflow'));
        await vi.waitFor(() => expect(entered).toBe(2));
        const third = send(new Request('http://chat.example.test/workflow'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        release();
        expect((await first).status).toBe(200);
        expect((await second).status).toBe(200);
        expect((await third).status).toBe(429);
    });

    it('does not count a workflow package completion callback twice', async () => {
        vi.stubGlobal('useRuntimeConfig', () => ({ limits: { operationRateLimits: { 'workflow:background': { maxRequests: 2 } } } }));
        const send = h3.toWebHandler(h3.createApp().use(h3.defineEventHandler(async (event) => {
            const bridge = createWorkflowServerBridge(event);
            const session = await bridge.authorize(event, 'workflow:background');
            bridge.recordRequest(session.userId, 'workflow:background');
            return { admitted: true };
        })));
        expect((await send(new Request('http://chat.example.test/workflow'))).status).toBe(200);
        expect((await send(new Request('http://chat.example.test/workflow'))).status).toBe(200);
        expect((await send(new Request('http://chat.example.test/workflow'))).status).toBe(429);
    });

    it.each(['claim', 'result'] as const)('reserves client-tool %s requests before asynchronous job access', async (operation) => {
        let release!: () => void;
        const work = new Promise<void>((resolve) => { release = resolve; });
        let entered = 0;
        registerBackgroundJobProvider('delayed', { ...memoryJobProvider, async getJob() {
            entered++; await work; return null;
        } });
        vi.stubGlobal('useRuntimeConfig', () => ({ security: { proxy: {}, allowedOrigins: [] },
            backgroundJobs: { storageProvider: 'delayed' },
            limits: { operationRateLimits: { [`chat-tool:${operation}`]: { maxRequests: 2 } } } }));
        const handler = operation === 'claim' ? (await import('../[id]/client-tool/claim.post')).default
            : (await import('../[id]/client-tool/result.post')).default;
        let arrivals = 0;
        let arrived!: () => void;
        const thirdArrival = new Promise<void>((resolve) => { arrived = resolve; });
        const app = h3.createApp().use(h3.defineEventHandler(() => { if (++arrivals === 3) arrived(); }))
            .use(h3.createRouter().post('/api/jobs/:id/client-tool/' + operation, handler));
        const server = createServer(h3.toNodeListener(app));
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const request = () => new Request(`${origin}/api/jobs/missing/client-tool/${operation}`, {
            method: 'POST', headers: { origin,
                'content-type': 'application/json', 'x-or3-tool-intent': operation },
            body: JSON.stringify({ callId: 'call', deviceId: 'device', claimToken: 'token', result: 'result' }),
        });
        try {
            const first = fetch(request()); const second = fetch(request());
            await vi.waitFor(() => expect(entered).toBe(2));
            const third = fetch(request());
            await thirdArrival;
            await new Promise<void>((resolve) => setImmediate(resolve));
            release();
            const responses = await Promise.all([first, second, third]);
            expect(responses.map((response) => response.status)).toEqual([operation === 'claim' ? 404 : 409, operation === 'claim' ? 404 : 409, 429]);
            expect(entered).toBe(2);
        } finally {
            release(); server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            resetBackgroundJobProviders();
        }
    });

    it.each([
        ['claim', null, 403], ['claim', 'viewer', 403], ['claim', 'editor', 200],
        ['result', null, 403], ['result', 'viewer', 403], ['result', 'editor', 200],
    ] as const)('client-tool %s requires fresh original workspace write access (%s)', async (operation, role, status) => {
        membership.role = role;
        identity.session.workspace.id = 'revoked-workspace';
        const execution: BackgroundJobExecution = { version: 1, workspaceId: 'revoked-workspace',
            body: { _clientDeviceId: 'device', messages: [] }, referer: 'http://chat.example.test', apiKeyCiphertext: 'test-ciphertext',
            clientToolCall: { callId: 'call', name: 'client-tool', arguments: '{}', argumentFingerprint: 'fingerprint',
                definition: { type: 'function', function: { name: 'client-tool', description: 'Test client tool', parameters: { type: 'object' } } },
                ...(operation === 'result' ? { claimToken: 'token', claimExpiresAt: Date.now() + 30_000 } : {}),
            } };
        const jobId = await memoryJobProvider.createJob({ userId: 'former-member', threadId: 't', messageId: 'm', model: 'test', execution });
        vi.stubGlobal('useRuntimeConfig', () => ({ sync: { provider: 'sqlite' }, backgroundJobs: { storageProvider: 'memory', encryptionKey: 'test-background-encryption-key-with-32-characters' }, security: { proxy: {}, allowedOrigins: [] } }));
        const handler = operation === 'claim' ? (await import('../[id]/client-tool/claim.post')).default
            : (await import('../[id]/client-tool/result.post')).default;
        const server = createServer(h3.toNodeListener(h3.createApp().use(h3.createRouter().post('/api/jobs/:id/client-tool/' + operation, handler))));
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        try {
            const response = await fetch(`${origin}/api/jobs/${jobId}/client-tool/${operation}`, {
                method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-or3-tool-intent': operation },
                body: JSON.stringify({ callId: 'call', deviceId: 'device', claimToken: 'token', result: 'result' }),
            });
            expect(response.status).toBe(status);
            const current = await memoryJobProvider.getJob(jobId, 'former-member');
            if (status === 403) expect(current?.execution).toEqual(execution);
        } finally {
            server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
    });

    it.each(['viewer', null] as const)('denies workflow admission when current membership is %s', async (role) => {
        membership.role = role;
        identity.session.workspace.id = 'revoked-workspace';
        const send = h3.toWebHandler(h3.createApp().use(h3.defineEventHandler(async (event) => {
            const provider = await createWorkflowServerBridge(event).getJobProvider();
            return provider.createJob({ userId: 'former-member', threadId: 't', messageId: 'm', model: 'workflow', kind: 'workflow' });
        })));
        expect((await send(new Request('http://chat.example.test/workflow'))).status).toBe(403);
        expect(await memoryJobProvider.getActiveJobCount!()).toBe(0);
    });

    it('persists canonical workflow scope in published SQLite and excludes it from chat recovery', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-job-scope-'));
        try {
            const path = join(directory, 'jobs.sqlite');
            await runMigrations(await initializeSqliteDb({ path, driver: 'better-sqlite3' }));
            const provider = new SqliteBackgroundJobProvider();
            registerBackgroundJobProvider('sqlite', provider);
            vi.stubGlobal('useRuntimeConfig', () => ({ auth: { enabled: true }, sync: { provider: 'sqlite' },
                backgroundJobs: { storageProvider: 'sqlite' }, security: { proxy: {}, allowedOrigins: [] } }));
            membership.role = 'editor';
            identity.session.workspace.id = 'revoked-workspace';
            const send = h3.toWebHandler(h3.createApp().use(h3.defineEventHandler(async (event) => {
                const scoped = await createWorkflowServerBridge(event).getJobProvider();
                return { jobId: await scoped.createJob({ userId: 'former-member', threadId: 't', messageId: 'm',
                    model: 'workflow', kind: 'workflow', historyPhase: 'ready',
                    execution: { version: 1, kind: 'workflow', workspaceId: 'attacker-workspace' } }) };
            })));
            const response = await send(new Request('http://chat.example.test/workflow'));
            expect(response.status).toBe(200);
            const { jobId } = await response.json() as { jobId: string };
            await destroySqliteDb();
            await initializeSqliteDb({ path, driver: 'better-sqlite3' });
            const persisted = await provider.getJob(jobId, 'former-member');
            expect(persisted?.execution).toEqual({ version: 1, kind: 'workflow', workspaceId: 'revoked-workspace' });
            expect(persisted?.historyPhase).toBe('committed');
            expect(await provider.claimJob(jobId, 'chat-worker', Date.now(), Date.now() + 30_000)).toBeNull();
            expect(await provider.claimNextJob('chat-worker', Date.now(), Date.now() + 30_000)).toBeNull();
            const abort = (await import('../[id]/abort.post')).default;
            const stop = h3.toWebHandler(h3.createApp().use(h3.createRouter().post('/api/jobs/:id/abort', abort)));
            expect((await stop(new Request(`http://chat.example.test/api/jobs/${jobId}/abort`, {
                method: 'POST', headers: { host: 'chat.example.test', origin: 'http://chat.example.test',
                    'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: '{}',
            }))).status).toBe(200);
            expect((await provider.getJob(jobId, 'former-member'))?.status).toBe('aborted');
            const chat = await provider.createJob({ userId: 'former-member', threadId: 't', messageId: 'chat', model: 'test',
                execution: { version: 1, workspaceId: 'revoked-workspace', body: {}, referer: 'http://chat.example.test', apiKeyCiphertext: 'test-ciphertext' } });
            expect((await provider.claimNextJob('chat-worker', Date.now(), Date.now() + 30_000))?.id).toBe(chat);
            const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
            try {
                await provider.cleanupExpired();
                expect(await provider.getJob(jobId, 'former-member')).toBeNull();
            } finally { clock.mockRestore(); }
        } finally {
            await destroySqliteDb(); resetJobProvider(); resetBackgroundJobProviders();
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('persists scoped cancellation markers without affecting other users, workspaces, or legacy admissions', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-admission-scope-'));
        try {
            await runMigrations(await initializeSqliteDb({ path: join(directory, 'jobs.sqlite'), driver: 'better-sqlite3' }));
            const provider = new SqliteBackgroundJobProvider();
            const params = { userId: 'former-member', threadId: 't', messageId: 'm', model: 'test' };
            const key = getScopedAdmissionKey(params.userId, 'revoked-workspace', admissionId);
            expect(await provider.cancelAdmission(params.userId, key)).toMatchObject({ aborted: false, pending: true });
            await expect(provider.createJob({ ...params, idempotencyKey: key })).rejects.toMatchObject({ name: 'AdmissionCancelledError' });
            const otherWorkspace = await provider.createJob({ ...params,
                idempotencyKey: getScopedAdmissionKey(params.userId, 'remaining-workspace', admissionId) });
            expect(await provider.createJob({ ...params,
                idempotencyKey: getScopedAdmissionKey(params.userId, 'remaining-workspace', admissionId) })).toBe(otherWorkspace);
            const otherUser = await provider.createJob({ ...params, userId: 'different-user',
                idempotencyKey: getScopedAdmissionKey('different-user', 'revoked-workspace', admissionId) });
            expect(otherUser).not.toBe(otherWorkspace);
            const legacy = await provider.createJob({ ...params, idempotencyKey: admissionId });
            expect((await provider.getJob(legacy, params.userId))?.status).toBe('streaming');
            expect(getScopedAdmissionKey('a', 'b:c', 'd')).not.toBe(getScopedAdmissionKey('a:b', 'c', 'd'));
            expect(getScopedAdmissionKey('a', 'b', '["c"]')).not.toBe(getScopedAdmissionKey('a', 'b', 'c'));
        } finally { await destroySqliteDb(); await rm(directory, { recursive: true, force: true }); }
    });

    it('uses the published Convex claim and retention handlers to fence canonical workflow scope', async () => {
        membership.role = 'editor';
        identity.session.workspace.id = 'revoked-workspace';
        const send = h3.toWebHandler(h3.createApp().use(h3.defineEventHandler(async (event) => {
            const provider = await createWorkflowServerBridge(event).getJobProvider();
            return { jobId: await provider.createJob({ userId: 'former-member', threadId: 't', messageId: 'm', model: 'workflow', kind: 'workflow' }) };
        })));
        const { jobId } = await (await send(new Request('http://chat.example.test/workflow'))).json() as { jobId: string };
        const admitted = (await memoryJobProvider.getJob(jobId, 'former-member'))!;
        // Load the exact shipped handler source. Only its datastore is mocked;
        // registration, validation, claim and cleanup logic are the real package.
        const packed = JSON.parse(gunzipSync(readFileSync(new URL('../../../../node_modules/or3-provider-convex/templates/convex.pack.json.gz', import.meta.url))).toString()) as { files: Record<string, string> };
        const output = ts.transpileModule(packed.files['backgroundJobs.ts']!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };
        const loaded = { exports: {} as Record<string, Handler> };
        const resolveImport = (id: string) => {
            if (id === 'convex/values') return convexValues;
            if (id === './_generated/server') return { internalMutation: internalMutationGeneric, internalQuery: internalQueryGeneric };
            throw new Error(`Unexpected published handler import: ${id}`);
        };
        new Function('require', 'module', 'exports', output)(resolveImport, loaded, loaded.exports);
        const now = Date.now();
        const documents = new Map<string, Record<string, unknown>>([
            ['workflow', { _id: 'workflow', status: 'streaming', kind: admitted.kind, execution: admitted.execution,
                history_phase: admitted.historyPhase, started_at: now, last_activity_at: now }],
        ]);
        const ctx = { db: {
            get: async (id: string) => documents.get(id) ?? null,
            patch: async (id: string, patch: Record<string, unknown>) => { Object.assign(documents.get(id)!, patch); },
            delete: async (id: string) => { documents.delete(id); },
            query: () => ({ withIndex: (_name: string, filter: (q: { eq: (field: string, value: string) => void }) => void) => {
                let status = ''; filter({ eq: (_field, value) => { status = value; } });
                const rows = () => [...documents.values()].filter((doc) => doc.status === status);
                return { collect: async () => rows(), take: async (limit: number) => rows().slice(0, limit) };
            } }),
        } };
        const args = { lease_owner: 'chat-worker', lease_ms: 30_000 };
        expect(await loaded.exports.claim!._handler(ctx, { ...args, job_id: 'workflow' })).toBeNull();
        expect(await loaded.exports.claimNext!._handler(ctx, args)).toBeNull();
        documents.set('chat', { _id: 'chat', status: 'streaming', execution: { version: 1, workspaceId: 'revoked-workspace', body: {}, apiKeyCiphertext: 'test' }, history_phase: 'ready', started_at: now });
        expect(await loaded.exports.claimNext!._handler(ctx, args)).toMatchObject({ id: 'chat' });
        Object.assign(documents.get('workflow')!, { status: 'complete', completed_at: now - 1000 });
        await loaded.exports.cleanup!._handler(ctx, { retention_ms: 1 });
        expect(documents.has('workflow')).toBe(false);
        expect(documents.has('chat')).toBe(true);
    });
});
