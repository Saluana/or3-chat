import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import { getDb } from '~/db/client';
import { setKvByName } from '~/db/kv';
import { useChatModelSelection } from '../useChatModelSelection';

const modelStore = vi.hoisted(() => ({
    catalog: undefined as ReturnType<typeof ref<OpenRouterModel[]>> | undefined,
    favoriteModels: undefined as
        | ReturnType<typeof ref<OpenRouterModel[]>>
        | undefined,
    fetchModels: vi.fn(),
    getFavoriteModels: vi.fn(),
}));

vi.mock('../useModelStore', () => ({
    useModelStore: () => ({
        catalog: modelStore.catalog,
        favoriteModels: modelStore.favoriteModels,
        fetchModels: modelStore.fetchModels,
        getFavoriteModels: modelStore.getFavoriteModels,
    }),
}));

vi.mock('../useAiSettings', () => ({
    useAiSettings: () => ({
        settings: ref({
            defaultModelMode: 'last-used',
            fixedModelId: null,
        }),
    }),
}));

vi.mock('@vueuse/core', () => ({
    useLocalStorage: (_key: string, defaultValue: string) => ref(defaultValue),
}));

// Real KV writes need the hook engine; the hooks themselves are not under test here.
vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: async () => {},
    }),
}));

function model(
    overrides: Partial<OpenRouterModel> & Pick<OpenRouterModel, 'id'>
): OpenRouterModel {
    return {
        name: overrides.id,
        ...overrides,
    };
}

function mountModelSelection(onChange = vi.fn()) {
    let selection!: ReturnType<typeof useChatModelSelection>;
    const wrapper = mount(
        defineComponent({
            setup() {
                selection = useChatModelSelection({
                    threadId: () => undefined,
                    onChange,
                });
                return () => h('div');
            },
        })
    );
    return { selection, wrapper };
}

describe('useChatModelSelection', () => {
    beforeEach(() => {
        modelStore.catalog = ref([]);
        modelStore.favoriteModels = ref([]);
        modelStore.fetchModels.mockReset().mockResolvedValue([]);
        modelStore.getFavoriteModels.mockReset().mockResolvedValue([]);
    });

    it('propagates the effective route and variant-only changes without synthetic thinking suffixes', async () => {
        const onChange = vi.fn();
        const { selection, wrapper } = mountModelSelection(onChange);
        await flushPromises();
        selection.selectedModel.value = 'provider/model:thinking';
        selection.modelVariant.value = 'nitro';
        await nextTick();
        expect(onChange).toHaveBeenLastCalledWith('provider/model:nitro');
        selection.modelVariant.value = 'floor';
        await nextTick();
        expect(onChange).toHaveBeenLastCalledWith('provider/model:floor');
        expect(selection.selectedModel.value).toBe('provider/model:thinking');
        wrapper.unmount();
    });

    it('hydrates the model catalog so capability metadata is available', async () => {
        mountModelSelection();
        await flushPromises();

        expect(modelStore.fetchModels).toHaveBeenCalledOnce();
        expect(modelStore.getFavoriteModels).toHaveBeenCalledOnce();
    });

    it('does not register the model event listener after unmount', async () => {
        let release!: () => void;
        modelStore.getFavoriteModels.mockReturnValue(
            new Promise((resolve) => {
                release = () => resolve([]);
            })
        );
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const { wrapper } = mountModelSelection();

        wrapper.unmount();
        release();
        await flushPromises();

        expect(addEventListener).not.toHaveBeenCalledWith(
            'or3:model-selected',
            expect.any(Function)
        );
    });

    it('recognizes reasoning models without an explicit effort list', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: '~openai/gpt-luna-latest',
                reasoning: {
                    supports_max_tokens: true,
                },
            }),
        ];

        const { selection } = mountModelSelection();
        await nextTick();

        expect(selection.modelSupportsThinking.value).toBe(true);
        expect(selection.modelReasoningEfforts.value).toEqual([]);
        expect(selection.thinkingEnabled.value).toBe(true);
    });

    it('defaults to medium reasoning even when the model advertises a different default', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: '~openai/gpt-luna-latest',
                reasoning: {
                    default_effort: 'low',
                    supported_efforts: ['low', 'medium', 'high'],
                },
            }),
        ];

        const { selection } = mountModelSelection();
        await nextTick();

        expect(selection.thinkingEnabled.value).toBe(true);
        expect(selection.reasoningEffort.value).toBe('medium');
    });

    it('keeps the default enabled across a model without reasoning support', async () => {
        modelStore.favoriteModels!.value = [
            model({ id: '~openai/gpt-luna-latest' }),
            model({
                id: 'provider/reasoning-model',
                supported_parameters: ['reasoning'],
            }),
        ];

        const { selection } = mountModelSelection();
        selection.selectedModel.value = 'provider/reasoning-model';
        await nextTick();

        expect(selection.thinkingEnabled.value).toBe(true);
        expect(selection.reasoningEffort.value).toBe('medium');
    });

    it('chooses the middle supported level when medium is unavailable', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: '~openai/gpt-luna-latest',
                reasoning: {
                    default_effort: 'low',
                    supported_efforts: ['xhigh', 'low', 'high'],
                },
            }),
        ];

        const { selection } = mountModelSelection();
        await nextTick();

        expect(selection.reasoningEffort.value).toBe('high');
    });

    // Live: GPT-6 Luna sent medium; GLM (no medium) showed high, and DeepSeek,
    // Qwen and Claude then inherited high although nobody chose it.
    it('returns to the chosen effort after a model that cannot use it', async () => {
        modelStore.favoriteModels!.value = [
            model({ id: 'provider/standard', reasoning: { supported_efforts: ['low', 'medium', 'high'] } }),
            model({ id: 'provider/no-medium', reasoning: { supported_efforts: ['low', 'high', 'xhigh'] } }),
            model({ id: 'provider/wide', reasoning: { supported_efforts: ['low', 'medium', 'high', 'xhigh'] } }),
        ];
        const { selection } = mountModelSelection();
        const select = async (id: string) => { selection.selectedModel.value = id; await nextTick(); await nextTick(); };
        await select('provider/standard');
        expect(selection.reasoningEffort.value).toBe('medium');
        await select('provider/no-medium');
        expect(selection.reasoningEffort.value).toBe('high');
        await select('provider/wide');
        expect(selection.reasoningEffort.value).toBe('medium');

        selection.reasoningEffort.value = 'xhigh';
        await nextTick();
        await select('provider/standard');
        expect(selection.reasoningEffort.value).toBe('medium');
        await select('provider/wide');
        expect(selection.reasoningEffort.value).toBe('xhigh');
    });

    it('matches capability metadata by canonical model slug', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: 'provider/model-versioned',
                canonical_slug: 'provider/model',
                supported_parameters: ['include_reasoning'],
            }),
        ];

        const { selection } = mountModelSelection();
        selection.selectedModel.value = 'provider/model';
        await nextTick();

        expect(selection.modelSupportsThinking.value).toBe(true);
        expect(selection.modelReasoningEfforts.value).toEqual([
            'low',
            'medium',
            'high',
        ]);
    });
});

// A composer's explicit choice survives its own new-chat send, but never a later navigation.
describe('new-chat model choice', () => {
    const db = getDb();
    const thread = (id: string, created_at: number) => ({
        id, title: id, clock: 0, created_at, updated_at: created_at, deleted: false,
        status: 'ready', forked: false, pinned: false,
    });
    // The composable records explicit choices only on the client, as in the browser.
    const client = process as unknown as { client?: boolean };
    beforeEach(async () => {
        client.client = true;
        await db.open();
        await Promise.all([db.threads.clear(), db.kv.clear()]);
    });
    afterEach(() => {
        delete client.client;
    });

    function mountWithThread() {
        const threadId = ref<string | undefined>(undefined);
        let selection!: ReturnType<typeof useChatModelSelection>;
        const wrapper = mount(
            defineComponent({
                setup() {
                    selection = useChatModelSelection({
                        threadId: () => threadId.value,
                        onChange: vi.fn(),
                    });
                    return () => h('div');
                },
            }),
        );
        return { selection, threadId, wrapper };
    }

    it('keeps the explicit model and variant chosen in a new chat after its first send', async () => {
        const { selection, threadId, wrapper } = mountWithThread();
        await flushPromises();
        selection.selectedModel.value = 'provider/explicit';
        selection.modelVariant.value = 'online';
        selection.armNewChatSelection();
        await db.threads.put(thread('fresh-chat', Math.floor(Date.now() / 1000)));
        threadId.value = 'fresh-chat';
        await flushPromises();
        expect(selection.selectedModel.value).toBe('provider/explicit');
        expect(selection.modelVariant.value).toBe('online');
        await vi.waitFor(async () => {
            const row = await db.kv.where('name').equals('chat-model:fresh-chat').first();
            expect(JSON.parse(row!.value as string)).toEqual({ model: 'provider/explicit', variant: 'online' });
        });
        wrapper.unmount();
    });

    it('does not apply a new-chat choice to an older chat that is opened afterwards', async () => {
        await setKvByName('chat-model:old-chat', JSON.stringify({ model: 'provider/saved', variant: 'off' }), db, { isValid: () => true });
        await db.threads.put(thread('old-chat', 1));
        const { selection, threadId, wrapper } = mountWithThread();
        await flushPromises();
        selection.selectedModel.value = 'provider/explicit';
        selection.armNewChatSelection();
        threadId.value = 'old-chat';
        await vi.waitFor(() => expect(selection.selectedModel.value).toBe('provider/saved'));
        const row = await db.kv.where('name').equals('chat-model:old-chat').first();
        expect(JSON.parse(row!.value as string)).toEqual({ model: 'provider/saved', variant: 'off' });
        wrapper.unmount();
    });
});
