<template>
    <div id="dashboard-ai-page-container" class="dashboard-page-frame text-sm">
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>

        <header class="dashboard-page-intro">
            <div>
                <p class="dashboard-page-eyebrow">Settings</p>
                <h1 class="dashboard-page-title">AI preferences</h1>
                <p class="dashboard-page-description">
                    Set the defaults applied when a new conversation starts. You
                    can still change the model and prompt per thread.
                </p>
            </div>
        </header>

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
                        Prepended to new chats and combined with thread-level
                        instructions. Keep it short and general.
                    </p>
                </div>
            </div>
            <UTextarea
                id="dashboard-ai-master-textarea"
                v-bind="masterPromptTextareaProps"
                :value="local.masterPrompt"
                @input="onPromptInput"
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
                <div class="flex items-center gap-3">
                    <span
                        v-if="promptSaved && !promptDirty"
                        class="ai-saved-state"
                    >
                        <UIcon
                            :name="useIcon('ui.check').value"
                            class="h-4 w-4"
                        />
                        Saved
                    </span>
                    <UButton
                        id="dashboard-ai-save-master-btn"
                        v-bind="savePromptButtonProps"
                        @click="saveMasterPrompt"
                        :disabled="savingPrompt || !promptDirty"
                    >
                        {{ savingPrompt ? 'Saving…' : 'Save changes' }}
                    </UButton>
                </div>
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
                        <h2
                            id="ai-section-model"
                            class="dashboard-section-title"
                        >
                            Model defaults
                        </h2>
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
                >Reset to defaults</UButton
            >
        </section>

        <p class="ai-settings-note">
            <UIcon :name="useIcon('ui.hint').value" class="h-4 w-4" />
            Model defaults apply immediately. The master prompt is saved when
            you choose Save changes.
        </p>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useIcon } from '#imports';
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
const promptDirty = ref(false);
const promptSaved = ref(true);
function onPromptInput(e: Event) {
    const t = e.target as HTMLTextAreaElement;
    local.value.masterPrompt = t.value || '';
    promptDirty.value =
        local.value.masterPrompt.trim() !== settings.value.masterSystemPrompt;
    promptSaved.value = false;
}
async function saveMasterPrompt() {
    savingPrompt.value = true;
    set({ masterSystemPrompt: local.value.masterPrompt.trim() });
    if (liveStatus.value) liveStatus.value.textContent = 'Master prompt saved';
    local.value.masterPrompt = local.value.masterPrompt.trim();
    promptDirty.value = false;
    promptSaved.value = true;
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
    promptDirty.value = false;
    promptSaved.value = true;
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
.ai-saved-state {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--md-success, var(--md-primary));
    font-size: 0.72rem;
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
.ai-settings-note {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.5rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.7rem;
    opacity: 0.72;
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
