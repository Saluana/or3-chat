<template>
    <section class="dashboard-list-group" aria-labelledby="fast-model-label">
        <label id="fast-model-label" class="dashboard-list-heading" for="dashboard-title-model">Model</label>
        <USelectMenu id="dashboard-title-model" v-bind="selectProps" :model-value="baseModel" :items="items"
            value-key="value" aria-label="Fast Model" class="w-full" :disabled="!editable || busy"
            @update:model-value="pickModel" />
        <template v-if="!openAi">
            <span class="dashboard-list-heading mt-3">Routing</span>
            <USelect id="dashboard-title-routing" v-bind="selectProps" :model-value="variant" :items="variants"
                value-key="value" aria-label="Fast model routing" class="w-full" :disabled="!editable || busy" @update:model-value="pickVariant" />
        </template>
        <p class="dashboard-list-footnote">A small, quick model for chat and document titles, editor autocomplete and project memories. Existing titles and memories stay as they are.</p>
        <p v-if="!editable" class="dashboard-list-footnote">A workspace administrator can change this model.</p>
        <p v-if="error" class="dashboard-list-footnote text-error" role="alert">{{ error }}</p>
    </section>
</template>
<script setup lang="ts">
import { modelIdentity } from '~~/shared/ai/model-catalog';
import { formatModelName } from '~/utils/modelCatalog';
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRuntimeConfig } from '#imports';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { getActiveWorkspaceId, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { DEFAULT_FAST_MODEL } from '~~/shared/ai/fast-model';
import { forgetFastModel } from '~/utils/fast-model';
import { appendModelVariant } from '~~/shared/openrouter/model-variants';
import { splitOpenRouterVariant } from '~~/shared/openrouter/selection';
import { isOpenAiModel } from '~~/shared/openai/models';

const cloud = useRuntimeConfig().public.ssrAuthEnabled === true;
const settings = useAiSettings();
const { catalog } = useModelStore();
const model = ref(DEFAULT_FAST_MODEL);
const busy = ref(true);
let revision = 0;
const error = ref('');
const editable = computed(() => !cloud || getCachedSessionContext()?.role === 'owner' || getCachedSessionContext()?.deploymentAdmin === true);
const selection = computed(() => splitOpenRouterVariant(model.value));
const baseModel = computed(() => selection.value.model);
const openAi = computed(() => isOpenAiModel(baseModel.value));
const variant = computed(() => selection.value.variant === 'nitro' || selection.value.variant === 'floor' ? selection.value.variant : 'off');
const variants = [{ label: 'Standard routing', value: 'off' }, { label: 'Nitro — fastest providers', value: 'nitro' }, { label: 'Floor — lowest price', value: 'floor' }];
const selectProps = useThemeOverrides({ component: 'selectmenu', context: 'dashboard', identifier: 'dashboard.ai.title-model', isNuxtUI: true });
const items = computed(() => {
    const choices = catalog.value.filter(m => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
        .map(m => ({ label: `${formatModelName(m.name || m.id)} · ${modelIdentity(m).platformName}`, value: m.id }));
    if (!choices.some(m => m.value === baseModel.value)) choices.unshift({ label: baseModel.value === 'deepseek/deepseek-v4.1-flash' ? 'DeepSeek V4.1 Flash' : baseModel.value, value: baseModel.value });
    return choices;
});
async function load() {
    const operation = ++revision;
    busy.value = true;
    const generation = getWorkspaceGeneration();
    try {
        let next: string;
        if (cloud) {
            const response = await fetch('/api/openrouter/title-model', { cache: 'no-store', credentials: 'same-origin' });
            if (!response.ok) throw new Error();
            next = (await response.json() as { model: string }).model;
        } else {
            await settings.ensureLoaded();
            next = settings.settings.value.titleGenerationModel;
        }
        if (operation === revision && generation === getWorkspaceGeneration()) { model.value = next; error.value = ''; }
    } catch { if (operation === revision && generation === getWorkspaceGeneration()) error.value = 'Could not load the fast model.'; }
    finally { if (operation === revision) busy.value = false; }
}
async function save(next: string) {
    if (!editable.value || busy.value) return;
    const generation = getWorkspaceGeneration();
    const workspaceId = getActiveWorkspaceId();
    const operation = ++revision;
    busy.value = true;
    error.value = '';
    try {
        if (cloud) {
            const response = await fetch('/api/admin/title-model', { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'x-or3-admin-intent': 'admin' }, body: JSON.stringify({ workspaceId, model: next }) });
            if (!response.ok) throw new Error();
        } else await settings.set({ titleGenerationModel: next });
        forgetFastModel();
        if (operation === revision && generation === getWorkspaceGeneration()) model.value = next;
    } catch { if (generation === getWorkspaceGeneration()) error.value = 'Could not save the fast model. Check your access, key and connection, then try again.'; }
    finally { if (operation === revision) busy.value = false; }
}
function pickModel(value: unknown) { if (typeof value === 'string') void save(appendModelVariant(value, variant.value)); }
function pickVariant(value: unknown) { if (value === 'off' || value === 'nitro' || value === 'floor') void save(appendModelVariant(baseModel.value, value)); }
watch(() => settings.settings.value.titleGenerationModel, value => { if (!cloud) model.value = value; });
onMounted(load);
const stop = subscribeActiveWorkspaceDb(() => { model.value = DEFAULT_FAST_MODEL; void load(); });
onBeforeUnmount(stop);
</script>
