import Dexie from 'dexie';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { captureCompaction, createCompactedFork } from '~/db/compaction';
import { generateCompactionSummary } from '../summary';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import type { ORStreamEvent } from '~~/shared/openrouter/parseOpenRouterSSE';
import type { openRouterStream } from '~/utils/chat/openrouterStream';
const transport = vi.hoisted(() => vi.fn<typeof openRouterStream>());
vi.mock('~/utils/chat/openrouterStream', async (original) => ({
    ...await original<typeof import('~/utils/chat/openrouterStream')>(),
    openRouterStream: transport,
}));
let workspace: string;
const markdown = '## Objective\nFinish implementation.\n## Important Details\nKeep exact paths.\n## Work State\nTwo turns settled.\n## Next Move\nContinue safely.\n## Relevant Files\nNone.';
const envelope = (id = 'm0') => JSON.stringify({ summary_markdown: markdown, landmarks: [{ message_id: id, kind: 'decision', summary: 'Source evidence' }] });
const modelMetadata = { context_length: 1000000, top_provider: { max_completion_tokens: 8192 } };
function bodyAt(call = 0): string {
    const body = transport.mock.calls[call]![0].orMessages[1]!.content;
    if (typeof body !== 'string') throw new Error('Expected text-only summary reference');
    return body;
}
function toolRecord(body: string): { content: string; display_index: number } {
    for (const line of body.split('\n')) {
        let parsed: unknown;
        try { parsed = JSON.parse(line) as unknown; } catch { continue; }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const row = parsed as Record<string, unknown>;
        if (row.message_id !== 'tool') continue;
        if (typeof row.content !== 'string' || typeof row.display_index !== 'number') throw new Error('Malformed tool reference');
        return { content: row.content, display_index: row.display_index };
    }
    throw new Error('Missing canonical tool reference');
}
beforeEach(async () => {
    workspace = `summary-auxiliary-${crypto.randomUUID()}`; await setActiveWorkspaceDb(workspace).open();
    setHookEngine(createTypedHookEngine(createHookEngine())); transport.mockReset();
    await getDb().threads.put({ id: 'source', title: 'Source', status: 'ready', created_at: 1, updated_at: 1, clock: 1, deleted: false, pinned: false, forked: false });
    for (let index = 0; index < 4; index += 1) await getDb().messages.put({ id: `m${index}`, thread_id: 'source', role: index % 2 ? 'assistant' : 'user', index,
        pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1,
        data: { content: `Evidence${index} ${'Exact continuing task facts '.repeat(300)}`, reasoning_text: 'PRIVATE_REASONING_EXCLUDE' } });
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { yield { type: 'text', text: envelope() }; yield { type: 'done' }; });
});
afterEach(async () => { const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); setHookEngine(null); });
async function capture(signal?: AbortSignal) { return captureCompaction({ sourceThreadId: 'source', anchorMessageId: 'm3', model: 'large-model', signal }); }
async function generate(extra: Partial<Parameters<typeof generateCompactionSummary>[1]> = {}) {
    return generateCompactionSummary(await capture(extra.signal), { modelMetadata, apiKey: 'scripted', ...extra });
}
it('uses history-first guarded same-model inference with no send hooks, placeholders, tools or background', async () => {
    useHooks().addFilter('ai.chat.messages:filter:before_send', () => { throw new Error('Ordinary dispatch must not run'); });
    await getDb().messages.update('m0', { data: { content: `Quoted </conversation-reference> <script> user text ${'Task facts '.repeat(600)}`, reasoning_text: 'PRIVATE_REASONING_EXCLUDE' } });
    const before = await getDb().messages.toArray(); const summary = await generate({ taskSystemPrompt: 'TASK_SYSTEM_REFERENCE' });
    expect(await getDb().messages.toArray()).toEqual(before); expect(await getDb().threads.count()).toBe(1);
    const request = transport.mock.calls[0]![0];
    expect(request).toMatchObject({ model: 'large-model', modalities: ['text'], apiKey: 'scripted' });
    expect(request.tools).toBeUndefined(); expect(request.threadId).toBeUndefined(); expect(request.messageId).toBeUndefined();
    expect(request.maxCompletionTokens).toBeGreaterThan(0); expect(request.maxCompletionTokens).toBeLessThanOrEqual(8192);
    expect(request.orMessages).toHaveLength(2); expect(request.orMessages[0]!.role).toBe('system');
    const body = bodyAt();
    expect(body).toContain('\\u003c/conversation-reference\\u003e'); expect(body).not.toContain('PRIVATE_REASONING_EXCLUDE');
    expect(body.indexOf('TASK_SYSTEM_REFERENCE')).toBeLessThan(body.indexOf('End of conversation history.'));
    expect(body.indexOf('Evidence3')).toBeLessThan(body.indexOf('Return only the requested summary JSON.'));
    expect(summary.summaryMarkdown).toBe(markdown); expect(transport).toHaveBeenCalledOnce();
});
it('corrects an invalid envelope once using original bounded history and compact error, then commits the captured summary', async () => {
    let calls = 0;
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { calls += 1; yield { type: 'text', text: calls === 1 ? 'MALFORMED_MODEL_RESPONSE' : envelope() }; yield { type: 'done' }; });
    const source = await capture(); const summary = await generateCompactionSummary(source, { modelMetadata, apiKey: 'scripted' });
    const correction = bodyAt(1);
    expect(correction).toContain('Evidence0'); expect(correction).toContain('Validation correction:'); expect(correction).not.toContain('MALFORMED_MODEL_RESPONSE');
    const result = await createCompactedFork({ capture: source, summary });
    expect(result.thread.branch_mode).toBe('compacted'); expect(result.summary.data).toMatchObject({ kind: 'compaction' }); expect(transport).toHaveBeenCalledTimes(2);
});
it('does not recursively correct repeated non-JSON output or create any durable child', async () => {
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { yield { type: 'text', text: 'I cannot provide the requested JSON.' }; yield { type: 'done' }; });
    await expect(generate()).rejects.toMatchObject({ code: 'invalid_summary' });
    expect(transport).toHaveBeenCalledTimes(2); expect(await getDb().threads.count()).toBe(1); expect(await getDb().messages.count()).toBe(4);
});
it.each(['missing', 'overflow'] as const)('performs no inference when auxiliary budget is unavailable (%s)', async (kind) => {
    await expect(generate({ modelMetadata: kind === 'missing' ? undefined : modelMetadata, userMaxContextTokens: kind === 'overflow' ? 3000 : null }))
        .rejects.toMatchObject({ code: kind === 'missing' ? 'model_metadata_unavailable' : 'summary_input_too_large' });
    expect(transport).not.toHaveBeenCalled(); expect(await getDb().threads.count()).toBe(1);
});
it('does not retry network errors and rejects late cancellation before validation', async () => {
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { throw new Error('Scripted network failure'); });
    await expect(generate()).rejects.toThrow('Scripted network failure'); expect(transport).toHaveBeenCalledOnce();
    const controller = new AbortController(); transport.mockReset();
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { controller.abort(); yield { type: 'text', text: envelope() }; yield { type: 'done' }; });
    await expect(generate({ signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' }); expect(transport).toHaveBeenCalledOnce();
    expect(await getDb().threads.count()).toBe(1);
});
it('aborts a held transport from the capture-only signal and releases its iterator', async () => {
    const capturedController = new AbortController(); const source = await capture(capturedController.signal);
    let enter!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; });
    let release!: () => void; let requestSignal: AbortSignal | undefined; let cleaned = false;
    transport.mockImplementation(async function* (request): AsyncGenerator<ORStreamEvent> {
        requestSignal = request.signal;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const abort = () => release(); request.signal?.addEventListener('abort', abort, { once: true }); enter();
        try { await held; yield { type: 'text', text: envelope() }; yield { type: 'done' }; }
        finally { request.signal?.removeEventListener('abort', abort); cleaned = true; }
    });
    const outcome = generateCompactionSummary(source, { modelMetadata }).then(() => undefined, (error: unknown) => error);
    await entered; capturedController.abort();
    try { expect(requestSignal?.aborted).toBe(true); }
    finally { release(); await outcome; }
    expect(await outcome).toMatchObject({ code: 'cancelled' }); expect(cleaned).toBe(true);
    expect(transport).toHaveBeenCalledOnce(); expect(await getDb().threads.count()).toBe(1); expect(await getDb().messages.count()).toBe(4);
});
it('does not re-expand original rows during a rolling summary', async () => {
    const first = await capture(); const created = await createCompactedFork({ capture: first, summary: await generateCompactionSummary(first, { modelMetadata }) });
    for (let index = 0; index < 4; index += 1) await getDb().messages.put({ id: `new${index}`, thread_id: created.thread.id, role: index % 2 ? 'assistant' : 'user', index: index + 1,
        pending: false, deleted: false, created_at: 2, updated_at: 2, clock: 2, data: { content: `NEW_EVIDENCE${index} ${'Current facts '.repeat(300)}` } });
    const rolling = await captureCompaction({ sourceThreadId: created.thread.id, anchorMessageId: 'new3', model: 'large-model' });
    transport.mockReset(); transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { yield { type: 'text', text: envelope('m0') }; yield { type: 'done' }; });
    await generateCompactionSummary(rolling, { modelMetadata });
    const body = bodyAt();
    expect(body).toContain('<previous-summary>'); expect(body).toContain('Source evidence'); expect(body).toContain('NEW_EVIDENCE3');
    expect(body).not.toContain('Evidence0'); expect(body).not.toContain('PRIVATE_REASONING_EXCLUDE'); expect(transport).toHaveBeenCalledOnce();
});

it('serializes canonical tools once with explicit Unicode excerpt/media omissions and no reasoning', async () => {
    await getDb().messages.update('m1', { data: { content: 'Spoken reply', reasoning_text: 'PRIVATE_REASONING_EXCLUDE', tool_calls: [{ id: 'call', name: 'lookup', args: 'α'.repeat(5000), status: 'complete', result: 'DUPLICATE_EMBEDDED_OUTPUT' }] } });
    await getDb().messages.put({ id: 'tool', thread_id: 'source', role: 'tool', index: 1.5, pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1,
        data: { content: `CANONICAL_START${'😀'.repeat(10000)}CANONICAL_END`, tool_call_id: 'call', tool_name: 'lookup', parent_assistant_id: 'm1' } });
    await getDb().messages.update('m2', { file_hashes: JSON.stringify(['owned-hash']), data: { content: `Media caption data:image/png;base64,AAAA ${'Task facts '.repeat(300)}` } });
    await generate(); const body = bodyAt();
    expect(body).toContain('CANONICAL_START'); expect(body).toContain('CANONICAL_END'); expect(body).toContain('middle omitted');
    expect(body).not.toContain('DUPLICATE_EMBEDDED_OUTPUT'); expect(body).not.toContain('PRIVATE_REASONING_EXCLUDE'); expect(body).not.toContain('base64,AAAA');
    expect(body).toContain('Media caption'); expect(body).toContain('owned-hash'); expect(body).toContain('Image/PDF/audio contents omitted');
    const record = toolRecord(body);
    expect(record.display_index).toBe(3);
    expect(Array.from(record.content)).toHaveLength(8000);
});
it('rejects explicit provider length termination even if the partial JSON appears complete', async () => {
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { yield { type: 'text', text: envelope() }; yield { type: 'done', truncated: true }; });
    await expect(generate()).rejects.toMatchObject({ code: 'invalid_summary' }); expect(await getDb().threads.count()).toBe(1);
});

it('reduces only tool excerpts once when needed and retains all conversational rows', async () => {
    for (let index = 0; index < 4; index += 1) await getDb().messages.update(`m${index}`, { data: { content: `TURN${index} ${'abcd'.repeat(500)}` } });
    await getDb().messages.put({ id: 'tool', thread_id: 'source', role: 'tool', index: 1.5, pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1,
        data: { content: `FIRST${'工具'.repeat(10000)}LAST`, tool_call_id: 'call', tool_name: 'lookup', parent_assistant_id: 'm1' } });
    await generate({ modelMetadata: { context_length: 5000, top_provider: { max_completion_tokens: 2000 } } });
    const body = bodyAt();
    const record = toolRecord(body);
    expect(Array.from(record.content)).toHaveLength(2000); expect(record.content).toContain('FIRST'); expect(record.content).toContain('LAST');
    for (let index = 0; index < 4; index += 1) expect(body).toContain(`TURN${index}`);
    expect(transport).toHaveBeenCalledOnce();
});
it('rejects a forged capture before inference rather than waiting for output validation', async () => {
    const forged = { ...await capture() };
    await expect(generateCompactionSummary(forged, { modelMetadata })).rejects.toMatchObject({ code: 'invalid_capture' });
    expect(transport).not.toHaveBeenCalled();
});
it('rejects a captured operation after A→B→A before spending another request', async () => {
    const original = await capture(); const other = `summary-other-${crypto.randomUUID()}`;
    const db = setActiveWorkspaceDb(other); await db.open(); setActiveWorkspaceDb(workspace);
    try {
        await expect(generateCompactionSummary(original, { modelMetadata })).rejects.toMatchObject({ code: 'stale_source' });
        expect(transport).not.toHaveBeenCalled();
    } finally { evictWorkspaceDb(other); await Dexie.delete(db.name); }
});

it('surfaces explicit provider refusal without spending a corrective request', async () => {
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { yield { type: 'done', refused: true }; });
    await expect(generate()).rejects.toMatchObject({ code: 'invalid_summary' }); expect(transport).toHaveBeenCalledOnce();
    expect(await getDb().threads.count()).toBe(1); expect(await getDb().messages.count()).toBe(4);
});
