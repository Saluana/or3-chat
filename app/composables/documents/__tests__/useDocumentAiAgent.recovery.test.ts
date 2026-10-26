// Audit reproductions. Model/tokenizer I/O is controlled; snapshot, proposal,
// acceptance, schema and editor behavior use the production implementation.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { effectScope, ref, shallowRef, type EffectScope } from 'vue';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { useDocumentAiAgent } from '~/composables/documents/useDocumentAiAgent';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';

const controls = vi.hoisted(() => ({ loop: vi.fn(), tokens: vi.fn(), checkpoint: vi.fn(), load: vi.fn() }));
vi.mock('~/core/auth/useUserApiKey', () => ({ useUserApiKey: () => ({ apiKey: ref(null) }) }));
vi.mock('~/composables/chat/useModelStore', () => ({ useModelStore: () => ({
    catalog: ref([{ id: 'audit-model', name: 'Audit', supported_parameters: ['tools'], context_length: 32000 }]),
    fetchModels: async () => [],
}) }));
vi.mock('~/composables/core/useTokenizer', () => ({ useTokenizer: () => ({ countTokens: controls.tokens }) }));
vi.mock('~/composables/documents/useDocumentAiSettings', () => ({
    DEFAULT_DOCUMENT_AI_MAX_ITERATIONS: 8,
    useDocumentAiSettings: () => ({ ensureLoaded: controls.load, settings: ref({ enabledTools: {}, modelId: 'audit-model', chunkWordLimit: 2000, maxIterations: 8, systemInstruction: '' }) }),
}));
vi.mock('~/composables/documents/documentAiAgentLoop', () => ({ runDocumentAiAgentLoop: controls.loop, documentAiToolStatusLabel: (name: string) => name }));
vi.mock('~/db/document-revisions', () => ({ createDocumentRevision: controls.checkpoint }));

const content = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const insert = (text: string) => ({ kind: 'insert_end' as const, content: content(text).content });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let editor: Editor;
let scope: EffectScope;

beforeEach(() => {
    controls.loop.mockReset().mockResolvedValue({ operations: [insert('AI appendix')], iterations: 1 });
    controls.tokens.mockReset().mockResolvedValue(1);
    controls.checkpoint.mockReset().mockResolvedValue(null);
    controls.load.mockReset().mockResolvedValue(undefined);
    setHookEngine(createTypedHookEngine(createHookEngine()));
    // Eliminate decoration scrolling from this state/persistence reproduction.
    vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterEach(() => { scope?.stop(); editor?.destroy(); setHookEngine(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function makeAgent(persistCurrent = vi.fn(async () => {}), readOnly = false) {
    const version = ref(0);
    editor = new Editor({ extensions: [StarterKit], content: content('Original body'), onUpdate: () => { version.value++; } });
    scope = effectScope();
    const agent = scope.run(() => useDocumentAiAgent({ editor: shallowRef(editor), documentId: ref('audit-doc'), title: ref('Title'), contentVersion: version, persistCurrent, readOnly: ref(readOnly) }))!;
    return { agent, version };
}

const submission = { prompt: 'Append', scope: 'document' as const, references: [], attachments: [] };

it('refuses offline inference while preserving local estimates and existing suggestions', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { agent } = makeAgent();
    await agent.submit(submission);
    expect(controls.loop).not.toHaveBeenCalled();
    expect(agent.error.value).toMatch(/offline|connect/i);
    expect(editor.isEditable).toBe(true);
    expect(await agent.estimate(submission)).toBe(1);
    online.mockReturnValue(true); window.dispatchEvent(new Event('online'));
    await agent.submit(submission);
    const pending = agent.proposal.value;
    online.mockReturnValue(false); window.dispatchEvent(new Event('offline'));
    expect(agent.proposal.value).toBe(pending);
    await agent.submit(submission);
    expect(agent.proposal.value).toBe(pending);
    expect(controls.loop).toHaveBeenCalledOnce();
    await agent.accept();
    expect(editor.getText()).toBe('Original body\n\nAI appendix');
    expect(agent.proposal.value).toBeNull();
});

it.each(['preflight', 'generation'] as const)('retires a disconnected %s and allows a fresh request before the old work settles', async phase => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const gate = deferred<any>();
    if (phase === 'preflight') controls.tokens.mockReturnValueOnce(gate.promise);
    else controls.loop.mockReturnValueOnce(gate.promise);
    const { agent } = makeAgent();
    const first = agent.submit(submission);
    await vi.waitFor(() => expect(phase === 'preflight' ? controls.tokens : controls.loop).toHaveBeenCalled());
    const oldRun = controls.loop.mock.calls[0]?.[0];
    online.mockReturnValue(false); window.dispatchEvent(new Event('offline'));
    expect(editor.isEditable).toBe(true);
    expect(agent.status.value).toBe('error');
    if (oldRun) expect(oldRun.signal.aborted).toBe(true);
    online.mockReturnValue(true); window.dispatchEvent(new Event('online'));
    await agent.submit(submission);
    expect(agent.status.value).toBe('preview');
    const latest = agent.proposal.value;
    const label = agent.agentStatus.value;
    oldRun?.onStatus({ type: 'tool_start', name: 'search_document', iteration: 1 });
    gate.resolve(phase === 'preflight' ? 9999 : { operations: [insert('Obsolete edit')], iterations: 1 });
    await first;
    expect(agent.proposal.value).toBe(latest);
    expect(agent.agentStatus.value).toBe(label);
    expect(agent.tokenEstimate.value).toBe(1);
    await agent.accept();
    expect(editor.getText()).toBe('Original body\n\nAI appendix');
});

it('handles preparation rejection without leaving a busy state or losing the document', async () => {
    controls.load.mockRejectedValueOnce(new Error('Synthetic preparation unavailable'));
    const { agent } = makeAgent();
    await expect(agent.submit(submission)).resolves.toBeUndefined();
    expect(agent.status.value).toBe('error');
    expect(agent.error.value).toBe('Synthetic preparation unavailable');
    expect(editor.isEditable).toBe(true);
    expect(editor.getText()).toBe('Original body');
    await agent.submit(submission);
    expect(agent.status.value).toBe('preview');
});

it('does not publish an old estimate over a newer AI request', async () => {
    const gate = deferred<number>();
    controls.tokens.mockReturnValueOnce(gate.promise);
    const { agent } = makeAgent();
    const estimating = agent.estimate(submission);
    await vi.waitFor(() => expect(controls.tokens).toHaveBeenCalledOnce());
    await agent.submit(submission);
    expect(agent.tokenEstimate.value).toBe(1);
    gate.resolve(9000); await estimating;
    expect(agent.tokenEstimate.value).toBe(1);
    expect(agent.status.value).toBe('preview');
});

it('aborts active AI work when its scope is disposed', async () => {
    const gate = deferred<any>();
    controls.loop.mockReturnValueOnce(gate.promise);
    const { agent } = makeAgent();
    const running = agent.submit(submission);
    await vi.waitFor(() => expect(controls.loop).toHaveBeenCalledOnce());
    const signal = controls.loop.mock.calls[0]![0].signal;
    scope.stop();
    expect(signal.aborted).toBe(true);
    gate.resolve({ operations: [insert('Unmounted edit')], iterations: 1 });
    await running;
    expect(agent.proposal.value).toBeNull();
});

it.each(['preflight', 'generation'] as const)('preserves newer text when the document changes during %s', async phase => {
    const gate = deferred<any>();
    if (phase === 'preflight') controls.tokens.mockReturnValueOnce(gate.promise);
    else controls.loop.mockReturnValueOnce(gate.promise);
    const { agent } = makeAgent();
    const running = agent.submit({ prompt: 'Append one paragraph', scope: 'document', references: [], attachments: [] });
    await vi.waitFor(() => expect(phase === 'preflight' ? controls.tokens : controls.loop).toHaveBeenCalled());
    if (phase === 'preflight') expect(editor.isEditable).toBe(true);
    else expect(editor.isEditable).toBe(false);
    editor.commands.setContent(content('User edit made after snapshot'), { emitUpdate: true });
    gate.resolve(phase === 'preflight' ? 1 : { operations: [insert('AI appendix')], iterations: 1 });
    await running;
    if (agent.proposal.value) {
        expect(agent.stale.value).toBe(true);
        await expect(agent.accept()).rejects.toThrow();
    }
    expect(editor.getText()).toBe('User edit made after snapshot');
});


it('applies the approved append order regardless of which hunk is accepted first', async () => {
    controls.loop.mockResolvedValue({ operations: [insert('First append'), insert('Second append')], iterations: 1 });
    const { agent } = makeAgent();
    await agent.submit({ prompt: 'Append two paragraphs', scope: 'document', references: [], attachments: [] });
    await agent.acceptHunk('change-2');
    await agent.acceptHunk('change-1');
    expect(editor.getText()).toBe('Original body\n\nFirst append\n\nSecond append');
});

it('retries durability after Accept All without applying the content twice', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('Synthetic disk full')).mockResolvedValue(undefined);
    const { agent } = makeAgent(persist);
    await agent.submit({ prompt: 'Append', scope: 'document', references: [], attachments: [] });
    await expect(agent.accept()).rejects.toThrow('Synthetic disk full');
    await expect(agent.accept()).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(editor.getText()).toBe('Original body\n\nAI appendix');
    expect(agent.proposal.value).toBeNull();
});

it('refuses live chat context after the editor becomes unavailable', () => {
    const { agent } = makeAgent(undefined, true);
    expect(() => agent.getChatContext('request')).toThrow();
});

it('finishes a successful first acceptance and unlocks the editor', async () => {
    const { agent } = makeAgent();
    await agent.submit({ prompt: 'Append', scope: 'document', references: [], attachments: [] });
    await agent.accept();
    expect(agent.proposal.value).toBeNull();
    expect(editor.isEditable).toBe(true);
});

it('retries a failed final hunk save without duplicating or invalidating its applied edit', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('Synthetic disk full')).mockResolvedValue(undefined);
    const { agent } = makeAgent(persist);
    await agent.submit({ prompt: 'Append', scope: 'document', references: [], attachments: [] });
    await expect(agent.acceptHunk('change-1')).rejects.toThrow('Synthetic disk full');
    expect(agent.stale.value).toBe(false);
    await agent.accept();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(editor.getText()).toBe('Original body\n\nAI appendix');
    expect(agent.proposal.value).toBeNull();
});
