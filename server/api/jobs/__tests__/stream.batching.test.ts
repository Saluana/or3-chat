import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as h3 from 'h3';
import {
    memoryJobProvider,
    clearAllJobs,
} from '../../../utils/background-jobs/providers/memory';
import { resetJobProvider } from '../../../utils/background-jobs/store';
import {
    emitJobDelta,
    emitJobReasoningDelta,
    emitJobStatus,
    hasJobViewers,
    resetJobViewersForTests,
} from '../../../utils/background-jobs/viewers';
import type {
    BackgroundJobExecution,
    BackgroundJob,
} from '../../../utils/background-jobs/types';
import type { RequestUsage } from '../../../../shared/chat/compaction';

const usage: RequestUsage = {
    prompt_tokens: 42, completion_tokens: 7, model: 'test',
    request_id: 'request-1', iteration: 0, measured_at: 1,
    prefix_message_count: 1, prefix_hash: 'prefix', configuration_hash: 'config',
    input_estimate_tokens: 40,
};

const auth = vi.hoisted(() => ({
    allowed: true,
    delay: 50,
    reads: 0,
    gate: null as Promise<void> | null,
}));
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: async () => ({
        authenticated: true,
        user: { id: 'owner' },
        workspace: { id: 'workspace' },
        role: 'editor',
    }),
}));
vi.mock('#imports', () => ({
    useRuntimeConfig: () =>
        (
            globalThis as unknown as { useRuntimeConfig: () => unknown }
        ).useRuntimeConfig(),
}));
vi.mock('../../../auth/store/registry', () => ({
    getAuthWorkspaceStore: () => ({
        listUserWorkspaces: async () => {
            auth.reads++;
            await auth.gate;
            await new Promise<void>((resolve) =>
                setTimeout(resolve, auth.delay)
            );
            return auth.allowed
                ? [{ id: 'workspace', name: 'Workspace', role: 'editor' }]
                : [];
        },
    }),
}));

type Status = {
    usage?: RequestUsage;
    status: string;
    content?: string;
    content_delta?: string;
    content_length?: number;
    reasoning_text?: string;
    reasoning_delta?: string;
    reasoning_length?: number;
    attempt?: number;
    content_reset?: boolean;
    tool_calls?: BackgroundJob['tool_calls'];
    workflow_state?: BackgroundJob['workflow_state'];
};

describe('fresh authorization of bounded, ordered SSE batches', () => {
    beforeEach(() => {
        clearAllJobs();
        resetJobProvider();
        resetJobViewersForTests();
        auth.allowed = true;
        auth.reads = 0;
        auth.delay = 50;
        auth.gate = null;
        vi.useFakeTimers({
            toFake: [
                'Date',
                'setTimeout',
                'clearTimeout',
                'setInterval',
                'clearInterval',
            ],
        });
        vi.setSystemTime(0);
        for (const name of [
            'defineEventHandler',
            'getRouterParam',
            'getQuery',
            'setHeader',
            'setResponseStatus',
            'sendStream',
            'readBody',
        ] as const)
            vi.stubGlobal(name, h3[name]);
        vi.stubGlobal('useRuntimeConfig', () => ({
            auth: { enabled: true },
            sync: { provider: 'sqlite' },
            security: { proxy: {}, allowedOrigins: [] },
            backgroundJobs: { storageProvider: 'memory', jobTimeoutMs: 300000 },
        }));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        auth.gate = null;
        resetJobViewersForTests();
        clearAllJobs();
        resetJobProvider();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    async function attach(
        jobId?: string,
        offset?: number,
        previousContent = ''
    ) {
        jobId ??= await memoryJobProvider.createJob({
            userId: 'owner',
            threadId: 't',
            messageId: 'm',
            model: 'test',
            execution: { workspaceId: 'workspace' } as BackgroundJobExecution,
        });
        const handler = (await import('../[id]/stream.get')).default;
        const abort = (await import('../[id]/abort.post')).default;
        const send = h3.toWebHandler(
            h3
                .createApp()
                .use(
                    h3
                        .createRouter()
                        .get('/api/jobs/:id/stream', handler)
                        .post('/api/jobs/:id/abort', abort)
                )
        );
        const opening = send(
            new Request(
                `http://chat.test/api/jobs/${jobId}/stream${offset === undefined ? '' : `?offset=${offset}`}`
            )
        );
        await vi.advanceTimersByTimeAsync(auth.delay);
        const response = await opening;
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        const frames: {
            at: number;
            status: Status;
            content: string;
            reasoning: string;
        }[] = [];
        let content = previousContent;
        let reasoning = '';
        let done = false;
        const consumed = (async () => {
            for (;;) {
                const next = await reader.read();
                if (next.done) {
                    done = true;
                    return;
                }
                for (const line of new TextDecoder()
                    .decode(next.value)
                    .split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const status = (
                        JSON.parse(line.slice(6)) as { status: Status }
                    ).status;
                    if (typeof status.content === 'string')
                        content = status.content;
                    else if (typeof status.content_delta === 'string')
                        content += status.content_delta;
                    if (typeof status.reasoning_text === 'string')
                        reasoning = status.reasoning_text;
                    else if (typeof status.reasoning_delta === 'string')
                        reasoning += status.reasoning_delta;
                    frames.push({ at: Date.now(), status, content, reasoning });
                }
            }
        })();
        await vi.advanceTimersByTimeAsync(auth.delay);
        return {
            jobId,
            frames,
            send,
            reader,
            consumed,
            get content() {
                return content;
            },
            get reasoning() {
                return reasoning;
            },
            get done() {
                return done;
            },
        };
    }

    async function finish(
        jobId: string,
        content: string,
        reasoning = '',
        attempt = 0
    ) {
        await memoryJobProvider.completeJob(jobId, content);
        emitJobStatus(jobId, 'complete', {
            content,
            contentLength: content.length,
            reasoning,
            reasoningLength: reasoning.length,
            chunksReceived: content.length,
            completedAt: Date.now(),
            attempt,
        });
    }

    it('delivers a usage-only live terminal with frozen, validated metadata', async () => {
        const stream = await attach();
        const measured = { ...usage, apiKey: 'must-not-leak' };
        emitJobStatus(stream.jobId, 'complete', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0,
            usage: measured,
        });
        measured.prompt_tokens = 999;
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status.usage).toEqual(usage);
        expect(JSON.stringify(stream.frames)).not.toContain('must-not-leak');
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('reattaches to terminal live usage before the durable provider catches up', async () => {
        const first = await attach();
        await first.reader.cancel();
        await first.consumed;
        emitJobStatus(first.jobId, 'complete', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0, usage,
        });
        const resumed = await attach(first.jobId, 0);
        await vi.advanceTimersByTimeAsync(auth.delay);
        expect(resumed.done).toBe(true);
        expect(resumed.frames.at(-1)?.status.status).toBe('complete');
        expect(resumed.frames.at(-1)?.status.usage).toEqual(usage);
        await resumed.reader.cancel();
        await resumed.consumed;
    });

    it('delivers canonical usage-only progress and terminal reconciliation', async () => {
        const stream = await attach();
        const job = (await memoryJobProvider.getJob(stream.jobId, 'owner'))!;
        const snapshot = { ...job, usage };
        vi.spyOn(memoryJobProvider, 'getJob').mockImplementation(async () => structuredClone(snapshot));
        await vi.advanceTimersByTimeAsync(1100);
        expect(stream.frames.at(-1)?.status.usage).toEqual(usage);
        snapshot.status = 'complete';
        snapshot.usage = { ...usage, iteration: 1, request_id: 'request-2', prompt_tokens: 64 };
        await vi.advanceTimersByTimeAsync(1100);
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status.usage).toEqual(snapshot.usage);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('preserves a newer terminal measurement queued behind an older terminal', async () => {
        const stream = await attach();
        let release!: () => void;
        auth.gate = new Promise<void>((resolve) => { release = resolve; });
        emitJobStatus(stream.jobId, 'complete', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0,
        });
        await vi.advanceTimersByTimeAsync(0);
        emitJobStatus(stream.jobId, 'complete', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0, usage,
        });
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 3);
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status.usage).toEqual(usage);
        expect(stream.frames.filter((frame) => frame.status.status === 'complete')).toHaveLength(1);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('retains richer live terminal progress while merging later canonical usage after authorization', async () => {
        const stream = await attach();
        const job = (await memoryJobProvider.getJob(stream.jobId, 'owner'))!;
        const latestUsage = { ...usage, request_id: 'request-2', iteration: 1, prompt_tokens: 64 };
        const workflow: NonNullable<BackgroundJob['workflow_state']> = {
            type: 'workflow-execution', workflowId: 'wf', workflowName: 'WF', prompt: 'p',
            executionState: 'running', nodeStates: {}, executionOrder: [], currentNodeId: 'a',
            finalOutput: 'full answer', version: 2,
        };
        const tools: NonNullable<BackgroundJob['tool_calls']> = [
            { id: 'tool', name: 'tool', status: 'complete', args: '{}', result: 'result' },
        ];
        let release!: () => void;
        auth.gate = new Promise<void>((resolve) => { release = resolve; });
        emitJobDelta(stream.jobId, 'full answer', {
            contentLength: 11, chunksReceived: 2, attempt: 0,
        });
        await vi.advanceTimersByTimeAsync(0);
        emitJobReasoningDelta(stream.jobId, 'full reasoning', {
            reasoningLength: 14, chunksReceived: 3, attempt: 0,
        });
        emitJobStatus(stream.jobId, 'aborted', {
            content: 'full answer', contentLength: 11, reasoning: 'full reasoning',
            reasoningLength: 14, chunksReceived: 3, attempt: 0, usage,
            tool_calls: tools, workflow_state: workflow,
        });
        vi.spyOn(memoryJobProvider, 'getJob').mockResolvedValue({
            ...job, status: 'aborted', content: 'full', reasoning: 'full', chunksReceived: 1,
            usage: latestUsage,
            tool_calls: [{ id: 'tool', name: 'tool', status: 'loading', args: '{}' }],
            workflow_state: { ...workflow, finalOutput: '', version: 1 },
        });
        await vi.advanceTimersByTimeAsync(1100);
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 3);
        expect(stream.done).toBe(true);
        const terminals = stream.frames.filter((frame) => frame.status.status === 'aborted');
        expect(terminals).toHaveLength(1);
        expect(terminals[0]?.status).toMatchObject({
            content: 'full answer', content_length: 11,
            reasoning_text: 'full reasoning', reasoning_length: 14,
            chunksReceived: 3, usage: latestUsage,
            tool_calls: tools, workflow_state: workflow,
        });
        await stream.reader.cancel();
        await stream.consumed;
    });

    it.each([
        { name: 'equal text with earlier settled tool', liveText: 'answer', canonicalText: 'answer',
            liveStatus: 'complete', canonicalStatus: 'loading', expectedStatus: 'complete', expectedResult: 'live result',
            liveArgs: '{"a":1,"b":2}', canonicalArgs: '{"b":2,"a":1}' },
        { name: 'richer earlier text with later settled tool', liveText: 'longer answer', canonicalText: 'answer',
            liveStatus: 'loading', canonicalStatus: 'complete', expectedStatus: 'complete', expectedResult: 'canonical result',
            liveArgs: '{}', canonicalArgs: '{}' },
        { name: 'conflicting arguments on the same call ID', liveText: 'longer answer', canonicalText: 'answer',
            liveStatus: 'complete', canonicalStatus: 'loading', expectedStatus: 'loading', expectedResult: undefined,
            liveArgs: '{"a":1}', canonicalArgs: '{"a":2}' },
    ] as const)('keeps terminal tool progression independent of $name', async (testCase) => {
        const stream = await attach();
        const job = (await memoryJobProvider.getJob(stream.jobId, 'owner'))!;
        let release!: () => void;
        auth.gate = new Promise<void>((resolve) => { release = resolve; });
        emitJobStatus(stream.jobId, 'aborted', {
            content: testCase.liveText, contentLength: testCase.liveText.length,
            chunksReceived: 1, attempt: 0, usage,
            tool_calls: [{ id: 'tool', name: 'tool', args: testCase.liveArgs,
                status: testCase.liveStatus,
                ...(testCase.liveStatus === 'complete' ? { result: 'live result' } : {}),
            }],
        });
        await vi.advanceTimersByTimeAsync(0);
        vi.spyOn(memoryJobProvider, 'getJob').mockResolvedValue({
            ...job, status: 'aborted', content: testCase.canonicalText, chunksReceived: 1,
            usage: { ...usage, iteration: 1, request_id: 'request-2' },
            tool_calls: [{ id: 'tool', name: 'tool', args: testCase.canonicalArgs,
                status: testCase.canonicalStatus,
                ...(testCase.canonicalStatus === 'complete' ? { result: 'canonical result' } : {}),
            }],
        });
        await vi.advanceTimersByTimeAsync(1100);
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 3);
        const terminals = stream.frames.filter((frame) => frame.status.status === 'aborted');
        expect(terminals).toHaveLength(1);
        expect(terminals[0]?.status.tool_calls?.[0]?.status).toBe(testCase.expectedStatus);
        expect(terminals[0]?.status.tool_calls?.[0]?.result).toBe(testCase.expectedResult);
        expect(terminals[0]?.status.usage?.iteration).toBe(1);
        expect(stream.done).toBe(true);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it.each([false, true])('preserves verified omitted terminal calls in first-seen order (partial canonical: %s)', async (partial) => {
        const stream = await attach();
        const job = (await memoryJobProvider.getJob(stream.jobId, 'owner'))!;
        const first: NonNullable<BackgroundJob['tool_calls']>[number] = {
            id: 'first', name: 'tool', args: '{"a":1}', status: 'complete', result: 'first result',
        };
        const second: NonNullable<BackgroundJob['tool_calls']>[number] = {
            id: 'second', name: 'tool', args: '{}', status: 'complete', result: 'second result',
        };
        const latest: NonNullable<BackgroundJob['tool_calls']>[number] = {
            id: 'latest', name: 'tool', args: '{}', status: 'complete', result: 'latest result',
        };
        let release!: () => void;
        auth.gate = new Promise<void>((resolve) => { release = resolve; });
        emitJobStatus(stream.jobId, 'aborted', {
            content: 'answer', contentLength: 6, chunksReceived: 1, attempt: 0, usage,
            tool_calls: [first,
                { name: 'tool', args: '{}', status: 'complete', result: 'no identity' },
                { id: 'unknown', name: 'tool', status: 'complete', result: 'no fingerprint' },
                second],
        });
        await vi.advanceTimersByTimeAsync(0);
        vi.spyOn(memoryJobProvider, 'getJob').mockResolvedValue({
            ...job, status: 'aborted', content: 'answer', chunksReceived: 1,
            usage: { ...usage, iteration: 1, request_id: 'request-2' },
            tool_calls: partial ? [{ ...second, status: 'loading', result: undefined }, latest] : [],
        });
        await vi.advanceTimersByTimeAsync(1100);
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 3);
        const terminals = stream.frames.filter((frame) => frame.status.status === 'aborted');
        expect(terminals).toHaveLength(1);
        expect(terminals[0]?.status.tool_calls).toEqual(partial ? [first, second, latest] : [first, second]);
        expect(stream.done).toBe(true);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('does not regress terminal usage when an older durable streaming snapshot follows it', async () => {
        const stream = await attach();
        let release!: () => void;
        auth.gate = new Promise<void>((resolve) => { release = resolve; });
        emitJobStatus(stream.jobId, 'complete', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0, usage,
        });
        await vi.advanceTimersByTimeAsync(1100);
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 3);
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status).toMatchObject({ status: 'complete', usage });
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('does not resurrect initial usage after an attempt reset', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'owner', threadId: 't', messageId: 'm', model: 'test',
            execution: { workspaceId: 'workspace' } as BackgroundJobExecution,
        });
        const original = memoryJobProvider.getJob.bind(memoryJobProvider);
        vi.spyOn(memoryJobProvider, 'getJob').mockImplementation(async (...args) => {
            const job = await original(...args);
            return job ? { ...job, usage } : job;
        });
        const stream = await attach(jobId);
        expect(stream.frames[0]?.status.usage).toEqual(usage);
        emitJobStatus(jobId, 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0,
            attempt: 1, content_reset: true,
        });
        emitJobDelta(jobId, 'new', { contentLength: 3, chunksReceived: 1, attempt: 1 });
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        const reset = stream.frames.findIndex((frame) => frame.status.content_reset);
        expect(reset).toBeGreaterThan(0);
        expect(stream.frames.slice(reset).every((frame) => frame.status.usage === undefined)).toBe(true);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('does not replace a measured canonical snapshot with an empty live placeholder', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'owner', threadId: 't', messageId: 'm', model: 'test',
            initialContent: 'initial',
            execution: { workspaceId: 'workspace' } as BackgroundJobExecution,
        });
        const job = (await memoryJobProvider.getJob(jobId, 'owner'))!;
        vi.spyOn(memoryJobProvider, 'getJob').mockResolvedValue({ ...job, usage });
        const stream = await attach(jobId);
        await vi.advanceTimersByTimeAsync(auth.delay);
        expect(stream.frames.every((frame) => frame.content === 'initial')).toBe(true);
        expect(stream.frames.at(-1)?.status.usage).toEqual(usage);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('keeps same-attempt measured usage when later canonical terminal usage is missing', async () => {
        const stream = await attach();
        emitJobStatus(stream.jobId, 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0, usage,
        });
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        await memoryJobProvider.completeJob(stream.jobId, '');
        await vi.advanceTimersByTimeAsync(1100);
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status).toMatchObject({ status: 'complete', usage });
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('never downgrades a measured iteration when older live and canonical updates interleave', async () => {
        const stream = await attach();
        const job = (await memoryJobProvider.getJob(stream.jobId, 'owner'))!;
        const latest = { ...usage, request_id: 'request-2', iteration: 1, prompt_tokens: 64 };
        const snapshot = { ...job, usage: latest };
        vi.spyOn(memoryJobProvider, 'getJob').mockImplementation(async () => structuredClone(snapshot));
        await vi.advanceTimersByTimeAsync(1100);
        expect(stream.frames.at(-1)?.status.usage).toEqual(latest);
        emitJobStatus(stream.jobId, 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0, usage,
        });
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        expect(stream.frames.at(-1)?.status.usage).toEqual(latest);
        snapshot.usage = usage;
        snapshot.content = 'answer';
        snapshot.status = 'complete';
        await vi.advanceTimersByTimeAsync(1100);
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status).toMatchObject({ content: 'answer', usage: latest });
        await stream.reader.cancel();
        await stream.consumed;
    });

    it.each([50, 100])(
        'delivers an unflushed burst within two %i ms lookups, including reasoning and terminal',
        async (delay) => {
            auth.delay = delay;
            const stream = await attach();
            const start = Date.now();
            const initialReads = auth.reads;
            for (let index = 1; index <= 100; index++) {
                emitJobDelta(stream.jobId, 'x', {
                    contentLength: index,
                    chunksReceived: index,
                });
                emitJobReasoningDelta(stream.jobId, 'r', {
                    reasoningLength: index,
                    chunksReceived: index,
                });
            }
            await vi.advanceTimersByTimeAsync(delay * 2);
            expect(stream.content).toBe('x'.repeat(100));
            expect(stream.reasoning).toBe('r'.repeat(100));
            expect(auth.reads - initialReads).toBeLessThanOrEqual(2);
            await finish(stream.jobId, 'x'.repeat(100), 'r'.repeat(100));
            await vi.advanceTimersByTimeAsync(delay * 2);
            expect(stream.done).toBe(true);
            expect(stream.frames.at(-1)?.status.status).toBe('complete');
            expect(stream.frames.at(-1)!.at - start).toBeLessThanOrEqual(
                delay * 4
            );
            await stream.reader.cancel();
            await stream.consumed;
        }
    );

    it.each([50, 100])(
        'keeps a continuously drained 12 KB stream healthy with a %i ms store and supports reattachment',
        async (delay) => {
            auth.delay = delay;
            const stream = await attach();
            const initialReads = auth.reads;
            for (let index = 1; index <= 12000; index++) {
                if (index % 250 === 0)
                    await memoryJobProvider.updateJob(stream.jobId, {
                        contentChunk: 'x'.repeat(250),
                        chunksReceived: index,
                    });
                emitJobDelta(stream.jobId, 'x', {
                    contentLength: index,
                    chunksReceived: index,
                });
                await vi.advanceTimersByTimeAsync(1);
                expect(stream.done).toBe(false);
            }
            await finish(stream.jobId, 'x'.repeat(12000));
            await vi.advanceTimersByTimeAsync(delay * 3);
            expect(stream.done).toBe(true);
            expect(stream.content.length).toBe(12000);
            expect(stream.frames.at(-1)?.status.status).toBe('complete');
            expect(auth.reads - initialReads).toBeLessThan(350);
            const progress = stream.frames.filter(
                (frame) => (frame.status.content_delta?.length ?? 0) > 0
            );
            expect(
                Math.max(
                    ...progress
                        .slice(1)
                        .map((frame, index) => frame.at - progress[index]!.at)
                )
            ).toBeLessThanOrEqual(delay * 2);
            const resumed = await attach(stream.jobId, 9750, 'x'.repeat(9750));
            expect(resumed.done).toBe(true);
            expect(resumed.frames.at(-1)?.status.status).toBe('complete');
            expect(resumed.content.length).toBe(12000);
            expect(resumed.content).toBe('x'.repeat(12000));
            await stream.reader.cancel();
            await resumed.reader.cancel();
            await Promise.all([stream.consumed, resumed.consumed]);
        }
    );

    it('freezes arrivals and mutable metadata before authorization and denies a later batch revoked in flight', async () => {
        const stream = await attach();
        const before = stream.frames.length;
        const tools: NonNullable<BackgroundJob['tool_calls']> = [
            { id: 'tool', name: 'tool', status: 'loading', args: '{}' },
        ];
        emitJobDelta(stream.jobId, 'before', {
            contentLength: 6,
            chunksReceived: 1,
            tool_calls: tools,
        });
        await vi.advanceTimersByTimeAsync(0);
        tools[0]!.status = 'complete';
        tools[0]!.result = 'later secret';
        emitJobDelta(stream.jobId, 'after', {
            contentLength: 11,
            chunksReceived: 2,
            tool_calls: tools,
        });
        await vi.advanceTimersByTimeAsync(auth.delay);
        expect(stream.content).toBe('before');
        expect(stream.frames[before]?.status.tool_calls?.[0]).toMatchObject({
            status: 'loading',
        });
        expect(JSON.stringify(stream.frames.slice(before))).not.toContain(
            'later secret'
        );
        const revokedIndex = stream.frames.length;
        auth.allowed = false;
        await vi.advanceTimersByTimeAsync(auth.delay);
        expect(stream.frames.length).toBe(revokedIndex);
        expect(stream.done).toBe(true);
        expect(hasJobViewers(stream.jobId)).toBe(false);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('preserves reset/attempt fences, reasoning, and tool/workflow transitions before terminal delivery', async () => {
        const stream = await attach();
        emitJobDelta(stream.jobId, 'old', {
            contentLength: 3,
            chunksReceived: 1,
            attempt: 0,
        });
        await vi.advanceTimersByTimeAsync(0);
        emitJobStatus(stream.jobId, 'streaming', {
            content: 'base',
            contentLength: 4,
            reasoning: 'thought',
            reasoningLength: 7,
            chunksReceived: 1,
            attempt: 1,
            content_reset: true,
        });
        const workflow: NonNullable<BackgroundJob['workflow_state']> = {
            type: 'workflow-execution',
            workflowId: 'wf',
            workflowName: 'WF',
            prompt: 'p',
            executionState: 'running',
            nodeStates: {},
            executionOrder: [],
            currentNodeId: 'a',
            finalOutput: '',
            version: 1,
        };
        emitJobDelta(stream.jobId, 'new', {
            contentLength: 7,
            chunksReceived: 2,
            attempt: 1,
            workflow_state: workflow,
            tool_calls: [
                { id: 'tool', name: 'tool', status: 'loading', args: '{}' },
            ],
        });
        emitJobReasoningDelta(stream.jobId, '!', {
            reasoningLength: 8,
            chunksReceived: 3,
            attempt: 1,
        });
        emitJobStatus(stream.jobId, 'streaming', {
            content: 'basenew',
            contentLength: 7,
            reasoning: 'thought!',
            reasoningLength: 8,
            chunksReceived: 3,
            attempt: 1,
            workflow_state: { ...workflow, version: 2 },
            tool_calls: [
                {
                    id: 'tool',
                    name: 'tool',
                    status: 'complete',
                    args: '{}',
                    result: 'done',
                },
            ],
        });
        // An older durable attempt arriving from reconciliation must not undo
        // the already-delivered recovery fence.
        await vi.advanceTimersByTimeAsync(auth.delay * 2 + 1100);
        expect(stream.content).toBe('basenew');
        expect(stream.reasoning).toBe('thought!');
        await finish(stream.jobId, 'basenew', 'thought!', 1);
        await vi.advanceTimersByTimeAsync(auth.delay * 3);
        const reset = stream.frames.findIndex(
            (frame) => frame.status.content_reset === true
        );
        expect(reset).toBeGreaterThan(0);
        expect(stream.frames[reset]).toMatchObject({
            content: 'base',
            reasoning: 'thought',
            status: { attempt: 1 },
        });
        expect(
            stream.frames
                .slice(reset)
                .every((frame) => frame.status.attempt === 1)
        ).toBe(true);
        expect(
            stream.frames.some(
                (frame) =>
                    frame.status.workflow_state?.version === 1 &&
                    frame.status.tool_calls?.[0]?.status === 'loading'
            )
        ).toBe(true);
        expect(
            stream.frames.some(
                (frame) =>
                    frame.status.workflow_state?.version === 2 &&
                    frame.status.tool_calls?.[0]?.status === 'complete'
            )
        ).toBe(true);
        expect(stream.content).toBe('basenew');
        expect(stream.reasoning).toBe('thought!');
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status.status).toBe('complete');
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('trims only the overlapping part of a coalesced delta after a frozen reconciler snapshot', async () => {
        const stream = await attach();
        await memoryJobProvider.updateJob(stream.jobId, {
            contentChunk: 'abcd',
            reasoningChunk: 'thought!',
            chunksReceived: 1,
        });
        // Initial reconciliation starts at 50 ms and schedules its next poll
        // 1,000 ms later. Begin live delivery during that fresh lookup.
        await vi.advanceTimersByTimeAsync(950);
        emitJobDelta(stream.jobId, 'abcdef', {
            contentLength: 6,
            chunksReceived: 2,
        });
        emitJobReasoningDelta(stream.jobId, 'thought!next', {
            reasoningLength: 12,
            chunksReceived: 3,
        });
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        expect(stream.content).toBe('abcdef');
        expect(stream.reasoning).toBe('thought!next');
        await finish(stream.jobId, 'abcdef', 'thought!next');
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        expect(stream.done).toBe(true);
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('delivers a full canonical terminal when completion is learned only by reconciliation', async () => {
        const stream = await attach();
        await memoryJobProvider.updateJob(stream.jobId, {
            contentChunk: 'durable',
            reasoningChunk: 'thought',
            chunksReceived: 1,
        });
        await memoryJobProvider.completeJob(stream.jobId, 'durable');
        await vi.advanceTimersByTimeAsync(1100);
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status).toMatchObject({
            status: 'complete',
            content: 'durable',
            reasoning_text: 'thought',
        });
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('reclaims superseded deltas so a valid large terminal fits behind a stalled lookup', async () => {
        const stream = await attach();
        let release!: () => void;
        auth.gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        emitJobDelta(stream.jobId, 'x', {
            contentLength: 1,
            chunksReceived: 1,
        });
        await vi.advanceTimersByTimeAsync(0);
        const final = 'x' + 'y'.repeat(600000);
        emitJobDelta(stream.jobId, final.slice(1), {
            contentLength: final.length,
            chunksReceived: 2,
            tool_calls: [
                {
                    id: 'large-tool',
                    name: 'tool',
                    status: 'loading',
                    args: '{}',
                },
            ],
        });
        await memoryJobProvider.updateJob(stream.jobId, {
            tool_calls: [
                {
                    id: 'large-tool',
                    name: 'tool',
                    status: 'complete',
                    args: '{}',
                    result: 'done',
                },
            ],
        });
        await memoryJobProvider.completeJob(stream.jobId, final);
        emitJobStatus(stream.jobId, 'complete', {
            content: final,
            contentLength: final.length,
            reasoning: '',
            reasoningLength: 0,
            chunksReceived: 2,
            attempt: 0,
            tool_calls: [
                {
                    id: 'large-tool',
                    name: 'tool',
                    status: 'complete',
                    args: '{}',
                    result: 'done',
                },
            ],
        });
        // Let the reconciler see the same terminal while authorization is stalled.
        await vi.advanceTimersByTimeAsync(2000);
        expect(hasJobViewers(stream.jobId)).toBe(true);
        expect(stream.content).toBe('');
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 3);
        expect(stream.content).toBe(final);
        expect(stream.done).toBe(true);
        expect(
            stream.frames.some(
                (frame) => frame.status.tool_calls?.[0]?.status === 'loading'
            )
        ).toBe(true);
        expect(stream.frames.at(-1)?.status.tool_calls?.[0]?.status).toBe(
            'complete'
        );
        expect(stream.frames.at(-1)?.status.status).toBe('complete');
        await stream.reader.cancel();
        await stream.consumed;
    });

    it('bounds stalled authorization and releases canceled viewers without late output', async () => {
        const stream = await attach();
        let release!: () => void;
        auth.gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        emitJobDelta(stream.jobId, 'x', {
            contentLength: 1,
            chunksReceived: 1,
        });
        await vi.advanceTimersByTimeAsync(0);
        for (let index = 1; index <= 20; index++)
            emitJobDelta(stream.jobId, 'y'.repeat(60000), {
                contentLength: 1 + index * 60000,
                chunksReceived: index,
            });
        await vi.advanceTimersByTimeAsync(0);
        expect(stream.done).toBe(true);
        expect(hasJobViewers(stream.jobId)).toBe(false);
        expect(stream.content).toBe('');
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        expect(stream.content).toBe('');
        await stream.reader.cancel();
        await stream.consumed;

        const canceled = await attach();
        auth.gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        emitJobDelta(canceled.jobId, 'secret', {
            contentLength: 6,
            chunksReceived: 1,
        });
        await vi.advanceTimersByTimeAsync(0);
        await canceled.reader.cancel();
        expect(hasJobViewers(canceled.jobId)).toBe(false);
        auth.gate = null;
        release();
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        await canceled.consumed;
        expect(canceled.content).toBe('');
    });

    it('delivers an aborted terminal promptly after Stop with queued deltas', async () => {
        const stream = await attach();
        await memoryJobProvider.updateJob(stream.jobId, {
            contentChunk: 'x'.repeat(50),
            chunksReceived: 50,
        });
        for (let index = 1; index <= 50; index++)
            emitJobDelta(stream.jobId, 'x', {
                contentLength: index,
                chunksReceived: index,
            });
        const stop = stream.send(
            new Request(`http://chat.test/api/jobs/${stream.jobId}/abort`, {
                method: 'POST',
                headers: {
                    origin: 'http://chat.test',
                    host: 'chat.test',
                    'content-type': 'application/json',
                    'x-or3-cloud-intent': 'mutation',
                },
                body: '{}',
            })
        );
        await vi.advanceTimersByTimeAsync(auth.delay);
        expect((await stop).status).toBe(200);
        await vi.advanceTimersByTimeAsync(auth.delay * 2);
        expect(stream.content).toBe('x'.repeat(50));
        expect(stream.done).toBe(true);
        expect(stream.frames.at(-1)?.status.status).toBe('aborted');
        await stream.reader.cancel();
        await stream.consumed;
    });
});
