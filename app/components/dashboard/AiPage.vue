<template>
    <div class="px-4 py-4 space-y-12 text-sm">
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>

        <!-- Master System Prompt -->
        <section
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
                class="w-full leading-snug focus:ring-0 focus:outline-0"
                :value="local.masterPrompt"
                @input="onPromptInput"
                :ui="{
                    base: 'min-h-40 my-3',
                }"
                :aria-describedby="'ai-master-help ai-master-count'"
                spellcheck="false"
                placeholder="e.g. You are a concise, helpful assistant who prefers structured, minimal answers."
            ></UTextarea>
            <div class="flex items-center justify-between">
                <span
                    id="ai-master-count"
                    class="text-xs opacity-70 tabular-nums"
                    >{{ local.masterPrompt.length }} chars</span
                >
                <UButton
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
                        v-bind="modelModeButtonProps"
                        :class="{
                            'bg-primary/50 hover:bg-primary/50':
                                settings.defaultModelMode === 'lastSelected',
                        }"
                        :aria-pressed="
                            settings.defaultModelMode === 'lastSelected'
                        "
                        :disabled="settings.defaultModelMode === 'lastSelected'"
                        @click="set({ defaultModelMode: 'lastSelected' })"
                        >Use last selected</UButton
                    >
                    <UButton
                        v-bind="modelModeButtonProps"
                        :class="{
                            'bg-primary/50 hover:bg-primary/50':
                                settings.defaultModelMode === 'fixed',
                        }"
                        :aria-pressed="settings.defaultModelMode === 'fixed'"
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
                <label class="text-xs" for="model-search">Search models</label>
                <UInput
                    id="model-search"
                    v-bind="modelSearchInputProps"
                    class="w-full"
                    placeholder="Search by name, id, or description"
                    v-model="searchQuery"
                    :disabled="modelsBusy"
                />
                <div
                    class="max-h-56 overflow-auto border-2 rounded-[3px] p-1 space-y-1"
                    role="listbox"
                    aria-label="Model results"
                >
                    <button
                        v-for="m in limitedResults"
                        :key="m.id"
                        type="button"
                        v-bind="modelItemButtonProps"
                        :class="[
                            'retro-btn px-2 py-0.5 hover:bg-primary/5 cursor-pointer w-full flex items-center justify-between',
                            m.id === settings.fixedModelId ? 'active' : '',
                            (modelItemButtonProps as any)?.class || '',
                        ]"
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
                    </button>
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
                <div class="flex items-center justify-between">
                    <div class="text-xs opacity-70">
                        Selected:
                        <span class="tabular-nums">{{
                            settings.fixedModelId || 'none'
                        }}</span>
                    </div>
                    <UButton
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
        variant: 'basic' as const,
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
        variant: 'basic' as const,
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
        isNuxtUI: false,
    });
    return overrides.value;
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
        variant: 'basic' as const,
        ...(overrides.value as any),
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
        variant: 'basic' as const,
        ...(overrides.value as any),
    };
});
</script>

<style scoped>
/* Match ThemePage.vue styling */
.section-card {
    position: relative;
    padding: 1.25rem 1rem 1rem 1rem; /* MD3 dense card spacing */
    border: 2px solid var(--md-inverse-surface);
    background: linear-gradient(
        0deg,
        color-mix(
            in oklab,
            var(--md-surface) 95%,
            var(--md-surface-variant) 5%
        ),
        color-mix(in oklab, var(--md-surface) 92%, var(--md-surface-variant) 8%)
    );
    border-radius: 6px;
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
}
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

@media (prefers-reduced-motion: reduce) {
    .section-card {
        transition: none;
    }
}
</style>
