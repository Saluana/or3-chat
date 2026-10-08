import {
    computed,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
    type Ref,
} from 'vue';
import {
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { getKvRecordByName, setKvByName } from '~/db/kv';
import { liveQuery, type Subscription } from 'dexie';
import { resolveChatProject, projectSettingsId } from '~/db/project-workspace';
import { ProjectSettingsSchema, readPersistedProjectRecord } from '~~/shared/projects/workspace';
import { useLocalStorage } from '@vueuse/core';
import { useAiSettings } from './useAiSettings';
import { useModelStore } from './useModelStore';
import {
    getDefaultReasoningEffort,
    getSupportedReasoningEfforts,
    modelSupportsReasoning,
    OPENROUTER_REASONING_EFFORTS,
    type OpenRouterReasoningEffort,
} from '~~/shared/openrouter/reasoning';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import {
    DEFAULT_MODEL_VARIANT,
    appendModelVariant,
    sanitizeModelVariant,
    type OpenRouterModelVariant,
} from '~~/shared/openrouter/model-variants';

const DEFAULT_MODEL = '~openai/gpt-luna-latest';
const LAST_MODEL_KEY = 'last_selected_model';

function stripThinkingSuffix(modelId: string): string {
    return modelId.endsWith(':thinking')
        ? modelId.slice(0, -':thinking'.length)
        : modelId;
}

export function useChatModelSelection(options: {
    threadId: () => string | undefined;
    onChange: (modelId: string) => void;
}): {
    selectedModel: Ref<string>;
    modelVariant: Ref<OpenRouterModelVariant>;
    thinkingEnabled: Ref<boolean>;
    reasoningEffort: Ref<string | undefined>;
    modelReasoningEfforts: Readonly<Ref<OpenRouterReasoningEffort[]>>;
    modelDefaultReasoningEffort: Readonly<Ref<OpenRouterReasoningEffort>>;
    modelSupportsThinking: Readonly<Ref<boolean>>;
    modelInherited: Readonly<Ref<boolean>>;
    useInheritedModel: () => Promise<void>;
    restoreDraftModel: (model: string | undefined, variant: OpenRouterModelVariant) => void;
    /** Call right before a new-chat composer sends; the chat that send creates keeps an explicit choice. */
    armNewChatSelection: () => void;
} {
    const { favoriteModels, getFavoriteModels, catalog, fetchModels } =
        useModelStore();
    const { settings } = useAiSettings();
    const selectedModel = ref(DEFAULT_MODEL);
    const modelVariant = ref<OpenRouterModelVariant>(DEFAULT_MODEL_VARIANT);
    const thinkingEnabled = ref(true);
    const reasoningEffort = ref<string>();
    const persistedModel = useLocalStorage(LAST_MODEL_KEY, DEFAULT_MODEL);
    const modelInherited = ref(true);
    let inheritedProjectModel: string | null = null;
    let policySubscription: Subscription | undefined;
    let applyingSelection = false;
    let persistence = Promise.resolve();

    const selectedModelMeta = computed<OpenRouterModel | undefined>(() => {
        const modelId = stripThinkingSuffix(selectedModel.value);
        const matchesSelectedModel = (model: OpenRouterModel) =>
            model.id === modelId || model.canonical_slug === modelId;
        return (
            catalog.value.find(matchesSelectedModel) ??
            favoriteModels.value.find(matchesSelectedModel)
        );
    });
    const modelReasoningEfforts = computed(() =>
        getSupportedReasoningEfforts(selectedModelMeta.value),
    );
    const modelDefaultReasoningEffort = computed(() =>
        getDefaultReasoningEffort(selectedModelMeta.value),
    );
    const modelSupportsThinking = computed(() =>
        modelSupportsReasoning(selectedModelMeta.value),
    );

    function applySelection(
        model: string,
        variant: OpenRouterModelVariant = DEFAULT_MODEL_VARIANT,
    ) {
        applyingSelection = true;
        try {
            selectedModel.value = model;
            modelVariant.value = variant;
        } finally {
            applyingSelection = false;
        }
    }
    function chatDefault() {
        return settings.value.defaultModelMode === 'fixed' &&
            settings.value.fixedModelId
            ? settings.value.fixedModelId
            : persistedModel.value || DEFAULT_MODEL;
    }
    const defaultVariant = () => sanitizeModelVariant(settings.value.defaultModelVariant);
    function stopPolicySubscription() {
        policySubscription?.unsubscribe();
        policySubscription = undefined;
    }
    let selectionRevision = 0;
    async function applyChatDefault() {
        const revision = ++selectionRevision;
        stopPolicySubscription();
        inheritedProjectModel = null;
        modelInherited.value = true;
        const id = options.threadId();
        const db = getDb();
        const generation = getWorkspaceGeneration();
        applySelection(chatDefault(), defaultVariant());
        if (!id) return;
        const current = () =>
            !disposed &&
            revision === selectionRevision &&
            id === options.threadId() &&
            db === getDb() &&
            generation === getWorkspaceGeneration();
        try {
            await persistence;
            const { row } = await getKvRecordByName('chat-model:' + id, db);
            if (!current()) return;
            if (row?.value) {
                let saved: { model?: unknown; variant?: unknown } | null = null;
                try { saved = JSON.parse(row.value); } catch { /* Invalid preferences inherit the current default. */ }
                if (
                    saved &&
                    typeof saved.model === 'string' &&
                    saved.model.trim()
                ) {
                    modelInherited.value = false;
                    applySelection(
                        saved.model,
                        sanitizeModelVariant(saved.variant),
                    );
                    return;
                }
            }
            policySubscription = liveQuery(async () => {
                const owner = await resolveChatProject(db, id);
                const row = owner ? await db.posts.get(projectSettingsId(owner)) : undefined;
                return row && !row.deleted
                    ? readPersistedProjectRecord(ProjectSettingsSchema, row.content)?.default_model ?? null
                    : null;
            }).subscribe({ next(model) {
                if (!current() || !modelInherited.value) return;
                inheritedProjectModel = model;
                applySelection(model ?? chatDefault(), defaultVariant());
            }, error() { /* Invalid project policy is surfaced by request admission. */ } });
        } catch {
            /* Invalid project state is surfaced by request admission. */
        }
    }
    async function useInheritedModel() {
        const id = options.threadId();
        if (!id) { await applyChatDefault(); return; }
        const revision = ++selectionRevision;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        // Clear through the existing guarded KV writer, serialized with earlier
        // explicit choices. A later user choice must win over this reset.
        const reset = persistence.then(() => setKvByName('chat-model:' + id, 'null', db, {
            isValid: () => !disposed && db === getDb() && generation === getWorkspaceGeneration(),
        }));
        persistence = reset.then(() => undefined, () => undefined);
        await reset;
        if (!disposed && revision === selectionRevision && id === options.threadId()
            && db === getDb() && generation === getWorkspaceGeneration()) await applyChatDefault();
    }
    function restoreDraftModel(model: string | undefined, variant: OpenRouterModelVariant) {
        // Existing chats hydrate their durable override or project policy;
        // only unsent, pre-chat drafts own a cached model selection.
        if (options.threadId()) return;
        if (model !== undefined) {
            selectionRevision++;
            modelInherited.value = false;
            stopPolicySubscription();
        }
        applySelection(model ?? selectedModel.value, variant);
    }
    let disposed = false;
    onMounted(async () => {
        const revision = selectionRevision;
        const catalogHydration = fetchModels().catch(() => undefined);
        await getFavoriteModels();
        if (!process.client || disposed) return;
        if (revision === selectionRevision) await applyChatDefault();
        window.addEventListener('or3:model-selected', onCatalogModelSelected);
        await catalogHydration;
    });
    const stopWorkspace = subscribeActiveWorkspaceDb(() => {
        void applyChatDefault();
    });
    onBeforeUnmount(() => {
        disposed = true;
        stopPolicySubscription();
        stopWorkspace();
        if (process.client) {
            window.removeEventListener(
                'or3:model-selected',
                onCatalogModelSelected,
            );
        }
    });

    function onCatalogModelSelected(event: Event): void {
        const modelId = (event as CustomEvent<{ modelId?: string }>).detail
            .modelId;
        if (modelId && modelId !== selectedModel.value) {
            selectedModel.value = modelId;
        }
    }

    // Set only by this composer's own new-chat send that explicitly chose a model.
    let newChatSentAt: number | undefined;
    function armNewChatSelection(): void {
        if (!options.threadId() && !modelInherited.value) newChatSentAt = Date.now();
    }
    watch(options.threadId, async (id, previous) => {
        const sentAt = newChatSentAt;
        newChatSentAt = undefined;
        if (id && !previous && sentAt !== undefined && !modelInherited.value) {
            const thread = await getDb().threads.get(id);
            // The thread must have been created by that send, not merely opened afterwards.
            if (thread && thread.created_at * 1000 >= sentAt - 1000 && id === options.threadId()) {
                persistChoice(id, selectedModel.value, modelVariant.value);
                return;
            }
        }
        void applyChatDefault();
    });
    watch([chatDefault, defaultVariant], () => {
        if (modelInherited.value) applySelection(inheritedProjectModel ?? chatDefault(), defaultVariant());
    });
    watch(
        [selectedModelMeta, modelReasoningEfforts],
        ([model, efforts]) => {
            if (!modelSupportsReasoning(model)) {
                reasoningEffort.value = undefined;
                return;
            }
            if (
                reasoningEffort.value &&
                efforts.includes(
                    reasoningEffort.value as OpenRouterReasoningEffort,
                )
            ) {
                return;
            }
            const orderedEfforts = [...efforts].sort(
                (a, b) =>
                    OPENROUTER_REASONING_EFFORTS.indexOf(a) -
                    OPENROUTER_REASONING_EFFORTS.indexOf(b),
            );
            reasoningEffort.value = efforts.includes('medium')
                ? 'medium'
                : (orderedEfforts[
                      Math.floor((orderedEfforts.length - 1) / 2)
                  ] ?? getDefaultReasoningEffort(model));
        },
        { immediate: true },
    );
    watch(
        [selectedModel, modelVariant],
        ([modelId, variant]) => {
            options.onChange(
                appendModelVariant(stripThinkingSuffix(modelId), variant),
            );
        },
        { immediate: true },
    );
    watch(
        [selectedModel, modelVariant],
        ([modelId, variant]) => {
            if (!process.client || applyingSelection) return;
            selectionRevision++;
            modelInherited.value = false;
            stopPolicySubscription();
            persistedModel.value = modelId;
            const id = options.threadId();
            if (id) persistChoice(id, modelId, variant);
        },
        { flush: 'sync' },
    );
    function persistChoice(id: string, modelId: string, variant: OpenRouterModelVariant) {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const value = JSON.stringify({ model: modelId, variant });
        // Serialize explicit choices so an earlier asynchronous hook cannot
        // overwrite a newer choice. Navigation doesn't cancel captured intent.
        persistence = persistence
            .then(async () => {
                await setKvByName('chat-model:' + id, value, db, {
                    isValid: () =>
                        db === getDb() &&
                        generation === getWorkspaceGeneration(),
                });
            })
            .catch((error) => {
                console.warn(
                    '[chat] Model preference could not be saved',
                    error,
                );
            });
    }

    return {
        selectedModel,
        modelVariant,
        thinkingEnabled,
        reasoningEffort,
        modelReasoningEfforts,
        modelDefaultReasoningEffort,
        modelSupportsThinking,
        modelInherited,
        useInheritedModel,
        restoreDraftModel,
        armNewChatSelection,
    };
}
