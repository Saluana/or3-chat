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
                This prompt is prepended to all new chats. Keep it short and
                general.
            </p>
            <textarea
                class="retro-input w-full min-h-40 leading-snug"
                :value="local.masterPrompt"
                @input="onPromptInput"
                :aria-describedby="'ai-master-help ai-master-count'"
                spellcheck="false"
                placeholder="e.g. You are a concise, helpful assistant who prefers structured, minimal answers."
            ></textarea>
            <div class="flex items-center justify-between">
                <span
                    id="ai-master-count"
                    class="text-xs opacity-70 tabular-nums"
                    >{{ local.masterPrompt.length }} chars</span
                >
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-btn"
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
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        :class="
                            settings.defaultModelMode === 'lastSelected'
                                ? 'active'
                                : ''
                        "
                        :aria-pressed="
                            settings.defaultModelMode === 'lastSelected'
                        "
                        :disabled="settings.defaultModelMode === 'lastSelected'"
                        @click="set({ defaultModelMode: 'lastSelected' })"
                        >Use last selected</UButton
                    >
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        :class="
                            settings.defaultModelMode === 'fixed'
                                ? 'active'
                                : ''
                        "
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
                <input
                    id="model-search"
                    class="retro-input w-full"
                    type="text"
                    placeholder="Search by name, id, or description"
                    v-model="modelSearch.query"
                    :disabled="modelsBusy"
                />
                <div
                    class="max-h-56 overflow-auto border-2 p-1 space-y-1"
                    role="listbox"
                    aria-label="Model results"
                >
                    <button
                        v-for="m in limitedResults"
                        :key="m.id"
                        type="button"
                        class="retro-btn w-full flex items-center justify-between"
                        :class="m.id === settings.fixedModelId ? 'active' : ''"
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
                        size="sm"
                        variant="basic"
                        class="retro-btn"
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
                size="sm"
                variant="basic"
                class="retro-btn"
                @click="onReset"
                >Reset to defaults</UButton
            >
        </section>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAiSettings } from '~/composables/useAiSettings';
import { useModelStore } from '~/composables/useModelStore';
import { useModelSearch } from '~/composables/useModelSearch';

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
const modelsBusy = computed(() => modelSearch.busy.value);
const limitedResults = computed(() => modelSearch.results.value.slice(0, 100));
function onPickModel(id: string) {
    set({ fixedModelId: id });
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
</script>
