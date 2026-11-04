<template>
    <div id="dashboard-ai-page-container" class="dashboard-page-frame ai-settings text-sm">
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>

        <UButton
            v-if="!subpage && view !== 'root'"
            color="neutral"
            variant="link"
            class="self-start"
            :icon="useIcon('ui.chevron.left').value"
            @click="closeView"
            >AI Settings</UButton
        >

        <template v-if="view === 'root'">
            <section class="dashboard-list-group" aria-labelledby="ai-group-chat">
                <h3 id="ai-group-chat" class="dashboard-list-heading">Chat</h3>
                <div class="dashboard-list">
                    <DashboardListRow
                        id="dashboard-ai-model-row"
                        icon-token="chat.model.catalog"
                        label="Starting model"
                        description="Default for new chats"
                        :value="startingModelLabel"
                        @click="openView('model')"
                    />
                    <DashboardListRow
                        id="dashboard-ai-prompt-row"
                        icon-token="chat.system_prompt"
                        label="Master system prompt"
                        description="Instructions for new chats"
                        :value="local.masterPrompt.trim() ? 'Custom' : undefined"
                        @click="openView('prompt')"
                    />
                </div>
            </section>

            <section class="dashboard-list-group" aria-labelledby="ai-group-preferences">
                <h3 id="ai-group-preferences" class="dashboard-list-heading">Preferences</h3>
                <div class="dashboard-list">
                    <DashboardListRow
                        id="dashboard-ai-variant-row"
                        icon-token="chat.model.settings"
                        label="Model variant"
                        description="Default routing for new chats"
                        :value="variantLabel"
                        @click="openView('variant')"
                    />
                    <DashboardListRow
                        static
                        icon-token="chat.tool.wrench"
                        label="Tools"
                        description="Enabled by default in new chats"
                    >
                        <template #trailing>
                            <USwitch
                                aria-label="Enable all tools by default"
                                :model-value="settings.defaultToolsEnabled"
                                :disabled="toolsStatus === 'saving'"
                                @update:model-value="saveToolDefault"
                            />
                        </template>
                    </DashboardListRow>
                </div>
                <AiSaveStatus id="ai-tools-status" class="dashboard-list-footnote" :status="toolsStatus" />
            </section>

            <section class="dashboard-list-group" aria-labelledby="ai-group-advanced">
                <h3 id="ai-group-advanced" class="dashboard-list-heading">Advanced</h3>
                <div class="dashboard-list">
                    <DashboardListRow
                        id="dashboard-ai-title-row"
                        icon-token="catalog.text"
                        label="Title model"
                        description="Names new chats and documents"
                        @click="openView('title')"
                    />
                    <DashboardListRow
                        id="dashboard-ai-context-row"
                        icon-token="catalog.context"
                        label="Context limit"
                        description="Maximum tokens sent to a model"
                        :value="contextLabel"
                        @click="openView('context')"
                    />
                </div>
            </section>

            <section id="dashboard-ai-reset-section" class="dashboard-list-group">
                <div class="dashboard-list">
                    <DashboardListRow
                        id="dashboard-ai-reset-btn"
                        icon-token="ui.refresh"
                        label="Reset AI settings"
                        description="Restore all AI preferences to their defaults"
                        danger
                        :disabled="resetting"
                        @click="onReset"
                    >
                        <template #trailing><span /></template>
                    </DashboardListRow>
                </div>
                <p v-if="resetError" id="ai-reset-error" class="dashboard-list-footnote text-error" role="alert">{{ resetError }}</p>
            </section>
        </template>

        <template v-else-if="view === 'model'">
            <section id="dashboard-ai-model-defaults-section" class="dashboard-list-group">
                <div class="dashboard-list" role="group" aria-label="Default model mode">
                    <DashboardListRow
                        id="dashboard-ai-model-last-selected-btn"
                        label="Last selected"
                        description="Start with the model you used most recently"
                        :selected="settings.defaultModelMode === 'lastSelected'"
                        @click="pickModelMode('lastSelected')"
                    />
                    <DashboardListRow
                        id="dashboard-ai-model-fixed-btn"
                        label="Fixed model"
                        description="Always start with the same model"
                        :selected="settings.defaultModelMode === 'fixed'"
                        @click="pickModelMode('fixed')"
                    />
                </div>
                <AiSaveStatus id="ai-model-status" class="dashboard-list-footnote" :status="modelStatus" />
            </section>

            <section
                v-if="settings.defaultModelMode === 'fixed'"
                class="dashboard-list-group"
                aria-labelledby="ai-fixed-model-heading"
            >
                <h3 id="ai-fixed-model-heading" class="dashboard-list-heading">Model</h3>
                <div class="dashboard-list">
                    <div class="dashboard-list-body">
                        <UInput
                            id="dashboard-model-search-input"
                            v-bind="modelSearchInputProps"
                            class="w-full"
                            aria-label="Search models"
                            placeholder="Search by name, id, or description"
                            v-model="searchQuery"
                            :disabled="modelsBusy"
                        />
                        <div
                            id="dashboard-ai-model-results"
                            class="ai-model-results"
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
                                <span class="max-w-full truncate text-left">{{
                                    m.name || m.id
                                }}</span>
                                <span class="max-w-full opacity-60 text-xs sm:ml-2 truncate">{{
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
                    </div>
                    <DashboardListRow
                        id="dashboard-ai-model-selection-row"
                        static
                        label="Selected"
                        :value="settings.fixedModelId || 'None'"
                    >
                        <template #trailing>
                            <UButton
                                id="dashboard-ai-clear-model-btn"
                                v-bind="clearModelButtonProps"
                                @click="clearModel"
                                :disabled="!settings.fixedModelId"
                                >Clear</UButton
                            >
                        </template>
                    </DashboardListRow>
                </div>
            </section>
        </template>

        <section
            v-else-if="view === 'prompt'"
            id="dashboard-ai-master-prompt-section"
            class="dashboard-list-group"
        >
            <label
                id="ai-section-master-prompt"
                class="dashboard-list-heading"
                for="dashboard-ai-master-textarea"
                >Instructions</label
            >
            <UTextarea
                id="dashboard-ai-master-textarea"
                v-bind="masterPromptTextareaProps"
                :value="local.masterPrompt"
                @input="onPromptInput"
                @blur="onPromptBlur"
                aria-describedby="ai-master-help ai-master-count"
                spellcheck="false"
                :rows="8"
                :maxlength="4000"
                placeholder="Enter instructions for new chats…"
            ></UTextarea>
            <p id="ai-master-help" class="dashboard-list-footnote">
                Applies to new chats alongside each thread’s instructions.
                Changes save automatically.
            </p>
            <div class="dashboard-list-footnote flex flex-wrap items-center justify-between gap-3">
                <span id="ai-master-count" class="tabular-nums"
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

        <section v-else-if="view === 'variant'" class="dashboard-list-group">
            <div class="dashboard-list" role="group" aria-label="Default model variant">
                <DashboardListRow
                    v-for="option in MODEL_VARIANT_OPTIONS"
                    :id="`dashboard-ai-variant-${option.value}`"
                    :key="option.value"
                    :label="option.label"
                    :description="option.description"
                    :selected="settings.defaultModelVariant === option.value"
                    @click="onPickVariant(option.value)"
                />
            </div>
            <AiSaveStatus id="ai-model-status" class="dashboard-list-footnote" :status="modelStatus" />
        </section>

        <TitleModelSetting v-else-if="view === 'title'" />

        <!-- Native generations capture this workspace preference at admission. -->
        <section
            v-else-if="view === 'context'"
            id="dashboard-ai-context-section"
            class="dashboard-list-group"
        >
            <label class="dashboard-list-heading" for="dashboard-ai-max-context-input">Maximum context tokens</label>
            <div class="flex flex-wrap items-center gap-3">
                <UInput
                    id="dashboard-ai-max-context-input"
                    v-bind="contextInputProps"
                    v-model="contextInput"
                    class="min-w-0 flex-1"
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
            <p id="ai-max-context-help" class="dashboard-list-footnote">
                Leave blank to use the model limit. A saved maximum can be larger
                than one model's window; each model still has its own capacity.
            </p>
            <p v-if="contextError" id="ai-max-context-error" class="dashboard-list-footnote text-error" role="alert">{{ contextError }}</p>
        </section>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue';
import { useIcon } from '#imports';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { MODEL_VARIANT_OPTIONS, sanitizeModelVariant } from '~~/shared/openrouter/model-variants';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useModelSearch } from '~/core/search/useModelSearch';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { DASHBOARD_SUBPAGE_KEY } from '~/core/dashboard/dashboard-navigation-types';
import AiSaveStatus from './AiSaveStatus.vue';
import DashboardListRow from './DashboardListRow.vue';
import TitleModelSetting from './TitleModelSetting.vue';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';

const liveStatus = ref<HTMLElement | null>(null);
const { settings: settingsRef, set, reset, ensureLoaded } = useAiSettings();
const settings = computed(() => settingsRef.value!);
const announce = (message: string) => {
    if (liveStatus.value) liveStatus.value.textContent = message;
};

// Each setting opens in its own view; the dashboard header shows its title and
// a back link. Edits live in this component, so leaving a view keeps them.
type AiView = 'root' | 'model' | 'prompt' | 'variant' | 'title' | 'context';
const VIEW_TITLES: Record<Exclude<AiView, 'root'>, string> = {
    model: 'Starting model',
    prompt: 'Master system prompt',
    variant: 'Model variant',
    title: 'Title model',
    context: 'Context limit',
};
const view = ref<AiView>('root');
const subpage = inject(DASHBOARD_SUBPAGE_KEY, null);
function openView(next: Exclude<AiView, 'root'>) {
    view.value = next;
}
function closeView() {
    const from = view.value;
    view.value = 'root';
    void nextTick(() => document.getElementById(`dashboard-ai-${from}-row`)?.focus({ preventScroll: true }));
}
watch(view, (current) => {
    if (subpage) subpage.value = current === 'root' ? null : { title: VIEW_TITLES[current], back: closeView };
}, { immediate: true });

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
    toolsStatus.value = 'idle';
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
    if (subpage) subpage.value = null;
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
const startingModelLabel = computed(() => {
    if (settings.value.defaultModelMode !== 'fixed') return 'Last selected';
    const id = settings.value.fixedModelId;
    if (!id) return 'Fixed model';
    return catalog.value.find((m) => m.id === id)?.name || id;
});
const variantLabel = computed(() =>
    MODEL_VARIANT_OPTIONS.find((o) => o.value === settings.value.defaultModelVariant)?.label ?? 'Off'
);
const contextLabel = computed(() =>
    settings.value.maxContextTokens ? settings.value.maxContextTokens.toLocaleString() : 'Model limit'
);
const toolsStatus = ref<SaveStatus>('idle');
async function saveToolDefault(enabled: boolean) {
    const generation = getWorkspaceGeneration();
    toolsStatus.value = 'saving';
    const failed = await set({ defaultToolsEnabled: enabled }).then(() => false, () => true);
    if (generation === getWorkspaceGeneration()) {
        toolsStatus.value = failed ? 'error' : 'saved';
        if (!failed) announce('Default chat tools saved');
    }
}
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
function pickModelMode(mode: 'lastSelected' | 'fixed') {
    if (settings.value.defaultModelMode === mode) return;
    void saveModelDefaults({ defaultModelMode: mode });
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
    toolsStatus.value = 'idle';
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
        class: 'model-result-item theme-btn px-2 py-0.5 hover:bg-primary/5 cursor-pointer w-full flex items-center justify-between! max-sm:flex-col max-sm:items-start! max-sm:justify-center! max-sm:gap-0',
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

</script>

<style scoped>
.ai-settings {
    gap: 28px;
}
.ai-model-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 16rem;
    overflow: auto;
    padding: 4px;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}
</style>
