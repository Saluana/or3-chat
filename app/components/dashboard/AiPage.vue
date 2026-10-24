<template>
    <div id="dashboard-ai-page-container" class="dashboard-page-frame text-sm">
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>

        <p class="dashboard-page-description">
            AI preferences save automatically. Chat model defaults can be
            overridden in each chat.
        </p>

        <section
            id="dashboard-ai-master-prompt-section"
            class="section-card space-y-4"
            role="group"
            aria-labelledby="ai-section-master-prompt"
        >
            <div class="dashboard-setting-heading">
                <span class="dashboard-setting-icon" aria-hidden="true">
                    <UIcon :name="useIcon('ui.chat').value" class="h-5 w-5" />
                </span>
                <div>
                    <h2
                        id="ai-section-master-prompt"
                        class="dashboard-section-title"
                    >
                        Master system prompt
                    </h2>
                    <p id="ai-master-help" class="supporting-text mt-1">
                        Applies to new chats alongside each thread’s instructions.
                    </p>
                </div>
            </div>
            <UTextarea
                id="dashboard-ai-master-textarea"
                aria-labelledby="ai-section-master-prompt"
                v-bind="masterPromptTextareaProps"
                :value="local.masterPrompt"
                @input="onPromptInput"
                @blur="onPromptBlur"
                aria-describedby="ai-master-help ai-master-count"
                spellcheck="false"
                :maxlength="4000"
                placeholder="e.g. You are a concise, helpful assistant who prefers structured, minimal answers."
            ></UTextarea>
            <div
                id="dashboard-ai-master-actions"
                class="flex flex-wrap items-center justify-between gap-3"
            >
                <span
                    id="ai-master-count"
                    class="text-xs opacity-70 tabular-nums"
                    >{{ local.masterPrompt.length }} / 4000 characters</span
                >
                <AiSaveStatus
                    id="ai-prompt-status"
                    :status="promptAutosave.status.value"
                    retryable
                    @retry="promptAutosave.flush"
                />
            </div>
        </section>

        <section
            id="dashboard-ai-model-defaults-section"
            class="section-card space-y-3"
            role="group"
            aria-labelledby="ai-section-model"
        >
            <div class="flex flex-wrap items-center justify-between gap-4">
                <div class="dashboard-setting-heading">
                    <span class="dashboard-setting-icon" aria-hidden="true">
                        <UIcon
                            :name="useIcon('dashboard.plugins').value"
                            class="h-5 w-5"
                        />
                    </span>
                    <div>
                        <div class="flex flex-wrap items-center gap-x-3">
                            <h2
                                id="ai-section-model"
                                class="dashboard-section-title"
                            >
                                Model defaults
                            </h2>
                            <AiSaveStatus
                                id="ai-model-status"
                                :status="modelStatus"
                            />
                        </div>
                        <p class="supporting-text mt-1">
                            Choose how new chats pick their starting model.
                        </p>
                    </div>
                </div>
                <div
                    class="ai-model-mode"
                    role="tablist"
                    aria-label="Default model mode"
                >
                    <UButton
                        id="dashboard-ai-model-last-selected-btn"
                        v-bind="modelModeButtonProps"
                        class="model-mode-btn"
                        :aria-pressed="
                            settings.defaultModelMode === 'lastSelected'
                        "
                        :active="settings.defaultModelMode === 'lastSelected'"
                        :disabled="settings.defaultModelMode === 'lastSelected'"
                        @click="saveModelDefaults({ defaultModelMode: 'lastSelected' })"
                        >Use last selected</UButton
                    >
                    <UButton
                        id="dashboard-ai-model-fixed-btn"
                        v-bind="modelModeButtonProps"
                        class="model-mode-btn"
                        :aria-pressed="settings.defaultModelMode === 'fixed'"
                        :active="settings.defaultModelMode === 'fixed'"
                        :disabled="settings.defaultModelMode === 'fixed'"
                        @click="saveModelDefaults({ defaultModelMode: 'fixed' })"
                        >Use fixed model</UButton
                    >
                </div>
            </div>
            <div
                v-if="settings.defaultModelMode === 'fixed'"
                class="ai-model-picker space-y-3"
            >
                <label class="text-xs" for="dashboard-model-search-input"
                    >Search models</label
                >
                <UInput
                    id="dashboard-model-search-input"
                    v-bind="modelSearchInputProps"
                    class="w-full"
                    placeholder="Search by name, id, or description"
                    v-model="searchQuery"
                    :disabled="modelsBusy"
                />
                <div
                    id="dashboard-ai-model-results"
                    class="max-h-64 overflow-auto border-[var(--md-border-width)] border-[var(--md-border-color)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-surface)] p-1 space-y-1"
                    role="listbox"
                    aria-label="Model results"
                >
                    <UButton
                        v-for="m in limitedResults"
                        :key="m.id"
                        :id="`dashboard-model-option-${m.id}`"
                        v-bind="modelItemButtonProps"
                        :class="m.id === settings.fixedModelId ? 'active' : ''"
                        :active="m.id === settings.fixedModelId"
                        @click="onPickModel(m.id)"
                        :aria-selected="m.id === settings.fixedModelId"
                        role="option"
                    >
                        <span class="truncate text-left">{{
                            m.name || m.id
                        }}</span>
                        <span class="opacity-60 text-xs ml-2 truncate">{{
                            m.canonical_slug || m.id
                        }}</span>
                    </UButton>
                    <div
                        v-if="!limitedResults.length && !modelsBusy"
                        class="text-xs opacity-70 px-1 py-2"
                    >
                        No results
                    </div>
                    <div v-if="modelsBusy" class="text-xs opacity-70 px-1 py-2">
                        Loading…
                    </div>
                </div>
                <div
                    id="dashboard-ai-model-selection-row"
                    class="flex items-center justify-between"
                >
                    <div class="text-xs opacity-70">
                        Selected:
                        <span class="tabular-nums">{{
                            settings.fixedModelId || 'none'
                        }}</span>
                    </div>
                    <UButton
                        id="dashboard-ai-clear-model-btn"
                        v-bind="clearModelButtonProps"
                        @click="clearModel"
                        :disabled="!settings.fixedModelId"
                        >Clear</UButton
                    >
                </div>
            </div>
            <div
                id="dashboard-ai-variant-row"
                class="flex flex-wrap items-center justify-between gap-3"
            >
                <div>
                    <label
                        class="text-xs font-medium"
                        for="dashboard-ai-variant-select"
                        >Model variant</label
                    >
                    <p class="supporting-text mt-1">
                        Default routing for new chats: fastest (Nitro),
                        cheapest (Floor), or web search (Online).
                    </p>
                </div>
                <ChatModelVariantSelect
                    id="dashboard-ai-variant-select"
                    :model-value="settings.defaultModelVariant"
                    class="w-full sm:w-64"
                    @update:model-value="onPickVariant"
                />
            </div>
        </section>

        <TitleModelSetting />

        <!-- Native generations capture this workspace preference at admission. -->
        <section
            id="dashboard-ai-context-section"
            class="section-card space-y-3"
            role="group"
            aria-labelledby="ai-section-context"
        >
            <h2 id="ai-section-context" class="dashboard-section-title">Context</h2>
            <label class="text-xs font-medium" for="dashboard-ai-max-context-input">Maximum context tokens</label>
            <p id="ai-max-context-help" class="supporting-text">
                Leave blank to use the model limit. A saved maximum can be larger
                than one model's window; each model still has its own capacity.
            </p>
            <div class="flex flex-wrap items-center gap-3">
                <UInput
                    id="dashboard-ai-max-context-input"
                    v-bind="contextInputProps"
                    v-model="contextInput"
                    type="text"
                    inputmode="numeric"
                    placeholder="Use model limit"
                    :aria-invalid="contextError ? 'true' : undefined"
                    :aria-describedby="contextError ? 'ai-max-context-help ai-max-context-error' : 'ai-max-context-help'"
                    @update:model-value="onContextInput"
                    @blur="contextAutosave.flush"
                    @keydown.enter="contextAutosave.flush"
                />
                <AiSaveStatus
                    id="ai-context-status"
                    :status="contextAutosave.status.value"
                    retryable
                    @retry="contextAutosave.flush"
                />
            </div>
            <p v-if="contextError" id="ai-max-context-error" class="text-sm text-error" role="alert">{{ contextError }}</p>
        </section>

        <section
            id="dashboard-ai-reset-section"
            class="section-card flex flex-wrap items-center justify-between gap-4"
            role="group"
            aria-labelledby="ai-section-reset"
        >
            <div class="dashboard-setting-heading">
                <span
                    class="dashboard-setting-icon dashboard-setting-icon--error"
                    aria-hidden="true"
                >
                    <UIcon
                        :name="useIcon('ui.refresh').value"
                        class="h-5 w-5"
                    />
                </span>
                <div>
                    <h2 id="ai-section-reset" class="dashboard-section-title">
                        Reset
                    </h2>
                    <p class="supporting-text mt-1">
                        Restore all AI preferences to their defaults.
                    </p>
                </div>
            </div>
            <UButton
                id="dashboard-ai-reset-btn"
                v-bind="resetButtonProps"
                @click="onReset"
                :disabled="resetting"
                >Reset to defaults</UButton
            >
            <p v-if="resetError" id="ai-reset-error" class="basis-full text-sm text-error" role="alert">{{ resetError }}</p>
        </section>

    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useIcon } from '#imports';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { sanitizeModelVariant } from '~~/shared/openrouter/model-variants';import { useModelStore } from '~/composables/chat/useModelStore';
import { useModelSearch } from '~/core/search/useModelSearch';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import AiSaveStatus from './AiSaveStatus.vue';
import TitleModelSetting from './TitleModelSetting.vue';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';

const liveStatus = ref<HTMLElement | null>(null);
const { settings: settingsRef, set, reset, ensureLoaded } = useAiSettings();
const settings = computed(() => settingsRef.value!);
const announce = (message: string) => {
    if (liveStatus.value) liveStatus.value.textContent = message;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
const PROMPT_SAVE_DELAY_MS = 800;

/**
 * Autosave for one field. `touch()` records an edit (and, with a delay, saves
 * after a pause); `flush()` saves now: on blur, Enter, retry and unmount. A
 * commit returns 'failed' to keep the edit pending so a later flush retries it;
 * results from an older edit or another workspace never overwrite newer state.
 */
function useAutosave(
    commit: () => Promise<'saved' | 'invalid' | 'failed'>,
    delay: number | null,
) {
    const status = ref<SaveStatus>('idle');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let edits = 0;
    let pending = false;
    function touch() {
        edits++;
        pending = true;
        clearTimeout(timer);
        timer = undefined;
        if (delay === null) {
            status.value = 'idle';
            return;
        }
        status.value = 'saving';
        timer = setTimeout(() => void flush(), delay);
    }
    function discard() {
        clearTimeout(timer);
        timer = undefined;
        edits++;
        pending = false;
        status.value = 'idle';
    }
    async function flush() {
        if (!pending) return;
        clearTimeout(timer);
        timer = undefined;
        const edit = edits;
        const generation = getWorkspaceGeneration();
        status.value = 'saving';
        const outcome = await commit().catch(() => 'failed' as const);
        if (edit !== edits || generation !== getWorkspaceGeneration()) return;
        pending = outcome === 'failed';
        status.value = outcome === 'saved' ? 'saved' : outcome === 'failed' ? 'error' : 'idle';
    }
    return { status, touch, discard, flush, hasPendingEdit: () => pending };
}

// Context maximum. A half-typed number is a valid number, so it saves on
// blur or Enter rather than on a pause.
const contextInput = ref(settings.value.maxContextTokens?.toString() ?? '');
const contextError = ref('');
const resetError = ref('');
const resetting = ref(false);
const contextAutosave = useAutosave(commitContextMaximum, null);
function onContextInput() {
    contextError.value = '';
    contextAutosave.touch();
}
watch(() => settings.value.maxContextTokens, (value) => {
    if (contextAutosave.hasPendingEdit()) return;
    contextInput.value = value?.toString() ?? '';
    contextError.value = '';
});

async function commitContextMaximum() {
    const text = contextInput.value.trim();
    const value = text === '' ? null : Number(text);
    if (value !== null && (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0)) {
        contextError.value = 'Enter a positive whole integer, or leave blank to use the model limit.';
        return 'invalid';
    }
    const generation = getWorkspaceGeneration();
    contextError.value = '';
    try {
        await set({ maxContextTokens: value });
    } catch {
        if (generation === getWorkspaceGeneration()) contextError.value = 'Could not save the context maximum. Retry.';
        return 'failed';
    }
    if (generation !== getWorkspaceGeneration()) return 'saved';
    // Normalise ("0042 " -> "42") only when the user has not typed since.
    if (contextInput.value.trim() === text) contextInput.value = value?.toString() ?? '';
    announce('Context maximum saved');
    return 'saved';
}

// Master prompt: saves after a pause. The text box keeps what was typed; the
// stored value is trimmed, and the box adopts it on blur.
const local = ref({ masterPrompt: settings.value.masterSystemPrompt });
const promptAutosave = useAutosave(commitMasterPrompt, PROMPT_SAVE_DELAY_MS);
function onPromptInput(e: Event) {
    local.value.masterPrompt = (e.target as HTMLTextAreaElement).value || '';
    promptAutosave.touch();
}
function onPromptBlur() {
    local.value.masterPrompt = local.value.masterPrompt.trim();
    void promptAutosave.flush();
}
async function commitMasterPrompt() {
    try {
        await set({ masterSystemPrompt: local.value.masterPrompt.trim() });
    } catch {
        announce('Master prompt could not be saved');
        return 'failed';
    }
    announce('Master prompt saved');
    return 'saved';
}

const stopWorkspace = subscribeActiveWorkspaceDb(() => {
    contextAutosave.discard();
    promptAutosave.discard();
    resetError.value = '';
    contextInput.value = '';
    contextError.value = '';
    resetting.value = false;
    void ensureLoaded().then(() => {
        local.value.masterPrompt = settings.value.masterSystemPrompt;
    });
});
// Closing the dashboard (or leaving this page) saves any edit still waiting.
onBeforeUnmount(() => {
    stopWorkspace();
    void promptAutosave.flush();
    void contextAutosave.flush();
});

// Models
const { catalog, fetchModels } = useModelStore();
const modelSearch = useModelSearch(catalog);
// Bridge query through a computed to ensure the native input always binds a string
const searchQuery = computed({
    get: () => String(modelSearch.query.value || ''),
    set: (v: string) => {
        modelSearch.query.value = v ?? '';
    },
});
const modelsBusy = computed(() => modelSearch.busy.value);
const limitedResults = computed(() => modelSearch.results.value.slice(0, 100));
const modelStatus = ref<SaveStatus>('idle');
let modelSaves = 0;
async function saveModelDefaults(patch: Parameters<typeof set>[0]) {
    const save = ++modelSaves;
    const generation = getWorkspaceGeneration();
    modelStatus.value = 'saving';
    const failed = await set(patch).then(() => false, () => true);
    if (save === modelSaves && generation === getWorkspaceGeneration()) {
        modelStatus.value = failed ? 'error' : 'saved';
    }
}
function onPickModel(id: string) {
    void saveModelDefaults({ fixedModelId: id, defaultModelMode: 'fixed' });
    if (liveStatus.value)
        liveStatus.value.textContent = `Selected fixed model: ${id}`;
}
function clearModel() {
    void saveModelDefaults({ fixedModelId: null });
}

// Model variant default for new chats
function onPickVariant(value: unknown) {
    const variant = sanitizeModelVariant(value);
    void saveModelDefaults({ defaultModelVariant: variant });
    if (liveStatus.value)
        liveStatus.value.textContent = `Selected default variant: ${variant}`;
}
onMounted(async () => {
    try {
        await fetchModels();
    } catch {
        // Silent; UI shows empty results
    }
});

async function onReset() {
    const generation = getWorkspaceGeneration();
    contextAutosave.discard();
    promptAutosave.discard();
    modelSaves++;
    modelStatus.value = 'idle';
    resetting.value = true;
    contextError.value = '';
    resetError.value = '';
    try {
        await reset();
        if (generation !== getWorkspaceGeneration()) return;
        contextInput.value = '';
        local.value.masterPrompt = '';
        announce('AI settings reset to defaults');
    } catch {
        if (generation === getWorkspaceGeneration()) resetError.value = 'Could not reset AI preferences. Retry.';
    } finally {
        if (generation === getWorkspaceGeneration()) resetting.value = false;
    }
}

// Theme overrides for buttons
const contextInputProps = computed(() => ({
    ...useThemeOverrides({
        component: 'input', context: 'dashboard', identifier: 'dashboard.ai.max-context', isNuxtUI: true,
    }).value,
}));
const modelModeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.ai.model-mode',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'soft' as const,
        color: 'primary' as const,
        activeVariant: 'solid' as const,
        activeColor: 'primary' as const,
        activeClass: 'model-mode-btn--active',
        inactiveClass: 'model-mode-btn--inactive',
        ...(overrides.value as any),
    };
});

const modelSearchInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'dashboard',
        identifier: 'dashboard.ai.model-search',
        isNuxtUI: true,
    });
    return {
        type: 'text' as const,
        ...(overrides.value as any),
    };
});

const modelItemButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.ai.model-item',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        variant: 'ghost' as const,
        class: 'model-result-item theme-btn px-2 py-0.5 hover:bg-primary/5 cursor-pointer w-full flex items-center justify-between',
        block: true as const,
        ...(overrides.value as any),
    };
});

const clearModelButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.ai.clear-model',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'primary' as const,
        ...(overrides.value as any),
    };
});

const masterPromptTextareaProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'textarea',
        context: 'dashboard',
        identifier: 'dashboard.ai.master-prompt',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
    const overrideUi = (overridesValue.ui as Record<string, any>) || {};
    const textareaClasses = [
        'theme-input',
        'w-full',
        'leading-snug',
        'focus:ring-0',
        'focus:outline-0',
        'min-h-40',
        'my-3',
        overrideUi.textarea,
    ]
        .filter(Boolean)
        .join(' ')
        .trim();

    return {
        ...(overridesValue as any),
        ui: {
            root: 'w-full',
            textarea: textareaClasses,
            ...overrideUi,
        },
    };
});

const resetButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.ai.reset',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'primary' as const,
        ...(overrides.value as any),
    };
});
</script>

<style scoped>
.supporting-text {
    font-size: 0.78rem;
    line-height: 1.45;
    max-width: min(82ch, 100%);
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.76;
    overflow-wrap: break-word;
}
.dashboard-setting-heading {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    gap: 0.8rem;
}
.dashboard-setting-icon {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: 0 0 auto;
    place-items: center;
    color: var(--md-primary);
    background: var(--md-primary-container);
    border: var(--md-border-width, 1px) solid var(--md-outline-variant);
    border-radius: var(--md-border-radius-small, var(--md-border-radius, 0.5rem));
}
.dashboard-setting-icon--error {
    color: var(--md-error);
    background: var(--md-error-container);
}
.ai-model-mode {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.3rem;
    padding: 0.3rem;
    background: var(--md-surface-container-low);
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius, 0.5rem));
}
.ai-model-picker {
    padding-top: 1rem;
    border-top: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--md-outline-variant);
}
.model-mode-btn {
    text-transform: none;
    padding-inline: 0.75rem;
    min-width: 8rem;
}
.model-mode-btn--active {
    box-shadow:
        inset 0 0 0 1px var(--md-on-surface),
        0 0 0 1px var(--md-primary);
}
.model-mode-btn--inactive {
    opacity: 0.7;
    border-color: var(--md-outline-variant);
}
@media (max-width: 640px) {
    .ai-model-mode {
        width: 100%;
    }
    .model-mode-btn {
        min-width: 0;
    }
}
</style>
