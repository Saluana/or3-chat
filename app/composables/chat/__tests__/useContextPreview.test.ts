import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const mocks = vi.hoisted(() => ({ projection: vi.fn(), db: { file_meta: { get: vi.fn() } }, generation: 1, listener: undefined as undefined | (() => void), settings: undefined as any }));
vi.mock('~/db/client', () => ({ getDb: () => mocks.db, getWorkspaceGeneration: () => mocks.generation, getActiveWorkspaceId: () => 'workspace', subscribeActiveWorkspaceDb: (fn: () => void) => { mocks.listener = fn; return () => {}; } }));
vi.mock('../useAiSettings', () => ({ useAiSettings: () => ({ settings: mocks.settings, ensureLoaded: async () => {} }) }));
vi.mock('../useModelStore', () => ({ useModelStore: () => ({ catalog: ref([]), favoriteModels: ref([]), refreshModels: async () => {}, resolveContextModel: async () => ({ ok: true, modelId: 'model', metadata: { context_length: 100000 }, source: 'openrouter-cache' }) }) }));
vi.mock('../useChatToolPreferences', () => ({ useChatToolPreferences: () => ({ preferences: ref({}) }) }));
vi.mock('~/utils/chat/tool-registry', () => ({ useToolRegistry: () => ({ listTools: ref([]), getEnabledDefinitions: () => [] }) }));
vi.mock('~/utils/chat/tool-preferences', () => ({ readChatToolPreferences: async () => ({}) }));
vi.mock('~/utils/chat/compaction/history', () => ({ resolveThreadProjection: mocks.projection }));
vi.mock('~/utils/chat/transcript', () => ({ storedMessagesToCanonicalTranscript: (rows: unknown) => rows, projectTranscriptForOpenRouter: (rows: unknown) => rows }));
vi.mock('~/utils/chat/useAi-internal/messageBuild', () => ({ buildSystemPromptMessage: async ({ masterPrompt, promptSelection }: any) => ({ role: 'system', content: `${masterPrompt}:${promptSelection}` }) }));
vi.mock('~/core/auth/openrouter-build', () => ({ selectOpenRouterImageCandidates: async () => ({ selected: [], inlineImageCandidates: new Set() }) }));
vi.mock('~/utils/chat/tokens', () => ({ countTokensApprox: async (text: string) => text.length }));
import { useContextPreview } from '../useContextPreview';

// A cache hit must retain the same estimate as a cold build, and every history
// identity change or superseded asynchronous fill must force a fresh projection.
describe('context preview history caching', () => {
    beforeEach(() => { vi.useFakeTimers(); mocks.generation = 1; mocks.settings = ref({ masterSystemPrompt: 'system', maxContextTokens: null }); mocks.projection.mockReset().mockImplementation(async (id: string) => ({ messages: [{ role: 'user', content: `history ${id}`, data: {} }] })); });
    afterEach(() => vi.useRealTimers());
    it('reuses draft history, invalidates keys, refreshes and expires', async () => {
        const thread = ref('one'), draft = ref('first'), revision = ref(1), prompt = ref('a');
        const scope = effectScope();
        const preview = scope.run(() => useContextPreview({ threadId: thread, model: 'model', text: draft, revision: () => [revision.value], promptSelection: prompt }))!;
        const settle = async () => { await nextTick(); await vi.advanceTimersByTimeAsync(121); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0); };
        await settle(); expect(mocks.projection).toHaveBeenCalledTimes(1);
        draft.value = 'second'; await settle(); expect(mocks.projection).toHaveBeenCalledTimes(1);
        const warm = preview.state.value.admission; expect(warm?.ok).toBe(true);
        await preview.refresh(); expect(mocks.projection).toHaveBeenCalledTimes(2); expect(preview.state.value.admission).toEqual(warm);
        revision.value++; await settle(); expect(mocks.projection).toHaveBeenCalledTimes(3);
        thread.value = 'two'; await settle(); expect(mocks.projection).toHaveBeenCalledTimes(4);
        prompt.value = 'b'; await settle(); expect(mocks.projection).toHaveBeenCalledTimes(5);
        mocks.settings.value = { ...mocks.settings.value, masterSystemPrompt: 'new' }; await settle(); expect(mocks.projection).toHaveBeenCalledTimes(6);
        mocks.generation++; mocks.listener!(); await settle(); expect(mocks.projection).toHaveBeenCalledTimes(7);
        await vi.advanceTimersByTimeAsync(5001); draft.value = 'third'; await settle(); expect(mocks.projection).toHaveBeenCalledTimes(8);
        scope.stop();
    });
    it('does not cache a superseded asynchronous projection', async () => {
        let release!: (value: unknown) => void;
        mocks.projection.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const thread = ref('one'), draft = ref('first'); const scope = effectScope();
        const preview = scope.run(() => useContextPreview({ threadId: thread, model: 'model', text: draft }))!;
        await vi.advanceTimersByTimeAsync(121); await vi.dynamicImportSettled(); thread.value = 'two'; await nextTick(); await vi.advanceTimersByTimeAsync(121);
        release({ messages: [{ role: 'user', content: 'obsolete', data: {} }] }); await Promise.resolve();
        const cold = preview.state.value.admission; expect(cold?.ok).toBe(true); draft.value = 'second'; await nextTick(); await vi.advanceTimersByTimeAsync(121);
        expect(mocks.projection).toHaveBeenCalledTimes(2); const warm = preview.state.value.admission; expect(warm).not.toEqual(cold);
        await preview.refresh(); expect(mocks.projection).toHaveBeenCalledTimes(3); expect(preview.state.value.admission).toEqual(warm);
        scope.stop();
    });
});
