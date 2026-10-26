// Audit reproductions. Model/tokenizer I/O is controlled; snapshot, proposal,
// acceptance, schema and editor behavior use the production implementation.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { effectScope, ref, shallowRef, type EffectScope } from 'vue';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { useDocumentAiAgent } from '~/composables/documents/useDocumentAiAgent';
import { freezeDocumentForAi, buildDocumentAiCandidate } from '~/utils/documents/document-ai-operations';
import { applyDocumentAiOperationLive } from '~/utils/documents/document-ai-hunks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';

const controls = vi.hoisted(() => ({ loop: vi.fn(), tokens: vi.fn(), checkpoint: vi.fn() }));
vi.mock('~/core/auth/useUserApiKey', () => ({ useUserApiKey: () => ({ apiKey: ref(null) }) }));
vi.mock('~/composables/chat/useModelStore', () => ({ useModelStore: () => ({
    catalog: ref([{ id: 'audit-model', name: 'Audit', supported_parameters: ['tools'], context_length: 32000 }]),
    fetchModels: async () => [],
}) }));
vi.mock('~/composables/core/useTokenizer', () => ({ useTokenizer: () => ({ countTokens: controls.tokens }) }));
vi.mock('~/composables/documents/useDocumentAiSettings', () => ({
    DEFAULT_DOCUMENT_AI_MAX_ITERATIONS: 8,
    useDocumentAiSettings: () => ({ ensureLoaded: async () => {}, settings: ref({ enabledTools: {}, modelId: 'audit-model', chunkWordLimit: 2000, maxIterations: 8, systemInstruction: '' }) }),
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
    setHookEngine(createTypedHookEngine(createHookEngine()));
    // Eliminate decoration scrolling from this state/persistence reproduction.
    vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterEach(() => { scope?.stop(); editor?.destroy(); setHookEngine(null); vi.unstubAllGlobals(); });

function makeAgent(persistCurrent = vi.fn(async () => {}), readOnly = false) {
    const version = ref(0);
    editor = new Editor({ extensions: [StarterKit], content: content('Original body'), onUpdate: () => { version.value++; } });
    scope = effectScope();
    const agent = scope.run(() => useDocumentAiAgent({ editor: shallowRef(editor), documentId: ref('audit-doc'), title: ref('Title'), contentVersion: version, persistCurrent, readOnly: ref(readOnly) }))!;
    return { agent, version };
}

it.each(['preflight', 'generation'] as const)('reproduces accepting a stale snapshot after an edit during %s', async phase => {
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
    expect(agent.proposal.value).not.toBeNull();
    expect(agent.stale.value).toBe(false);
    await agent.accept();
    expect(editor.getText()).toContain('Original body');
    expect(editor.getText()).not.toContain('User edit made after snapshot');
});

it('reproduces append hunk acceptance order changing the approved document order', () => {
    editor = new Editor({ extensions: [StarterKit], content: content('Base') });
    const snapshot = freezeDocumentForAi(editor);
    const first = insert('First append');
    const second = insert('Second append');
    const expected = buildDocumentAiCandidate(editor, snapshot, [first, second]);
    applyDocumentAiOperationLive(editor, snapshot, [], second);
    applyDocumentAiOperationLive(editor, snapshot, [second], first);
    expect(editor.getJSON()).not.toEqual(expected);
    expect(editor.getText()).toBe('Base\n\nSecond append\n\nFirst append');
});

it('reproduces accept-all becoming stale after a failed persistence attempt', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('Synthetic disk full')).mockResolvedValue(undefined);
    const { agent } = makeAgent(persist);
    await agent.submit({ prompt: 'Append one paragraph', scope: 'document', references: [], attachments: [] });
    await expect(agent.accept()).rejects.toThrow('Synthetic disk full');
    expect(editor.getText()).toContain('AI appendix');
    expect(agent.stale.value).toBe(true);
    await expect(agent.accept()).rejects.toThrow('The document changed');
    expect(persist).toHaveBeenCalledTimes(1);
});

it('reproduces live chat context exposing an editor whose availability is read-only', () => {
    const { agent } = makeAgent(undefined, true);
    // DocumentEditorRoot synchronizes this flag when availability changes.
    editor.setEditable(false, false);
    expect(editor.isEditable).toBe(false);
    expect(agent.getChatContext('audit-read')).toContain('Original body');
});
