<template>
    <div id="dashboard-ai-page-container" class="px-4 py-4 space-y-12 text-sm">
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>

        <!-- Master System Prompt -->
        <section
            id="dashboard-ai-master-prompt-section"
            class="section-card space-y-3"
            role="group"
            aria-labelledby="ai-section-master-prompt"
        >
            <h2
                id="ai-section-master-prompt"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Master System Prompt
            </h2>
            <p id="ai-master-help" class="supporting-text">
                This prompt is prepended to all new chats and works alongside
                the threads system prompts. Keep it short and general.
            </p>
            <UTextarea
                id="dashboard-ai-master-textarea"
                v-bind="masterPromptTextareaProps"
                :value="local.masterPrompt"
                @input="onPromptInput"
                :aria-describedby="'ai-master-prompt-input'"
                spellcheck="false"
                placeholder="e.g. You are a concise, helpful assistant who prefers structured, minimal answers."
            ></UTextarea>
            <div
                id="dashboard-ai-master-actions"
                class="flex items-center justify-between"
            >
                <span
                    id="ai-master-count"
                    class="text-xs opacity-70 tabular-nums"
                    >{{ local.masterPrompt.length }} chars</span
                >
                <UButton
                    id="dashboard-ai-save-master-btn"
                    v-bind="savePromptButtonProps"
                    @click="saveMasterPrompt"
                    :disabled="savingPrompt"
                >
                    Save
                </UButton>
            </div>
        </section>

        <!-- Model Defaults -->
        <section
            id="dashboard-ai-model-defaults-section"
            class="section-card space-y-3"
            role="group"
            aria-labelledby="ai-section-model"
        >
            <div class="flex items-center justify-between flex-wrap gap-3">
                <h2
                    id="ai-section-model"
                    class="font-heading text-base uppercase tracking-wide group-heading"
                >
                    Model Defaults
                </h2>
                <div
                    class="flex gap-2 items-center"
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
                        @click="set({ defaultModelMode: 'lastSelected' })"
                        >Use last selected</UButton
                    >
                    <UButton
                        id="dashboard-ai-model-fixed-btn"
                        v-bind="modelModeButtonProps"
                        class="model-mode-btn"
                        :aria-pressed="settings.defaultModelMode === 'fixed'"
                        :active="settings.defaultModelMode === 'fixed'"
                        :disabled="settings.defaultModelMode === 'fixed'"
                        @click="set({ defaultModelMode: 'fixed' })"
                        >Use fixed model</UButton
                    >
                </div>
            </div>
            <p class="supporting-text">
                Choose how new chats pick their starting model. You can still
                switch per-thread.
            </p>

            <div v-if="settings.defaultModelMode === 'fixed'" class="space-y-3">
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
                    class="max-h-56 overflow-auto border-[var(--md-border-width)] rounded-[var(--md-border-radius)] p-1 space-y-1"
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
        </section>

        <!-- Reset -->
        <section
            id="dashboard-ai-reset-section"
            class="section-card space-y-2"
            role="group"
            aria-labelledby="ai-section-reset"
        >
            <h2
                id="ai-section-reset"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Reset
            </h2>
            <p class="text-xs opacity-70">
                Reset all AI settings back to defaults.
            </p>
            <UButton
                id="dashboard-ai-reset-btn"
                v-bind="resetButtonProps"
                @click="onReset"
                >Reset to defaults</UButton
            >
        </section>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useModelSearch } from '~/core/search/useModelSearch';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const liveStatus = ref<HTMLElement | null>(null);
const { settings: settingsRef, set, reset } = useAiSettings();
const settings = computed(() => settingsRef.value!);

// Master prompt
const local = ref({ masterPrompt: settings.value.masterSystemPrompt });
const savingPrompt = ref(false);
function onPromptInput(e: Event) {
    const t = e.target as HTMLTextAreaElement;
    local.value.masterPrompt = t.value || '';
}
async function saveMasterPrompt() {
    savingPrompt.value = true;
    set({ masterSystemPrompt: local.value.masterPrompt.trim() });
    if (liveStatus.value) liveStatus.value.textContent = 'Master prompt saved';
    savingPrompt.value = false;
}

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
function onPickModel(id: string) {
    set({ fixedModelId: id, defaultModelMode: 'fixed' });
    if (liveStatus.value)
        liveStatus.value.textContent = `Selected fixed model: ${id}`;
}
function clearModel() {
    set({ fixedModelId: null });
}
onMounted(async () => {
    try {
        await fetchModels();
    } catch {
        // Silent; UI shows empty results
    }
});

function onReset() {
    reset();
    local.value.masterPrompt = '';
    if (liveStatus.value)
        liveStatus.value.textContent = 'AI settings reset to defaults';
}

// Theme overrides for buttons
const savePromptButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.ai.save-prompt',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'solid' as const,
        color: 'primary' as const,
        ...(overrides.value as any),
    };
});

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
/* Component-specific layout and typography (non-decorative) */
.group-heading {
    margin-top: -0.25rem; /* optical align */
    letter-spacing: 0.08em;
}
.supporting-text {
    font-size: 15px;
    line-height: 1.2;
    max-width: 82ch;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.7;
}
.model-mode-btn {
    text-transform: none;
    padding-inline: 0.75rem;
    min-width: 8rem;
}
.model-mode-btn--active {
    box-shadow: inset 0 0 0 1px var(--md-on-surface),
        0 0 0 1px var(--md-primary);
}
.model-mode-btn--inactive {
    opacity: 0.7;
    border-color: var(--md-outline-variant);
}
</style>
