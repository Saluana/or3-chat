<template>
    <section class="section-card space-y-3" aria-labelledby="title-model-label">
        <div class="dashboard-setting-heading">
            <span class="dashboard-setting-icon" aria-hidden="true"><UIcon name="i-lucide-text-cursor-input" class="h-5 w-5" /></span>
            <div>
                <h2 id="title-model-label" class="dashboard-section-title">Title Generation Model</h2>
                <p class="supporting-text mt-1">Names new chats and documents. Changes apply to future titles; existing names stay as they are.</p>
            </div>
        </div>
        <USelectMenu id="dashboard-title-model" v-bind="selectProps" :model-value="baseModel" :items="items"
            value-key="value" aria-label="Title Generation Model" class="w-full" :disabled="!editable || busy"
            @update:model-value="pickModel" />
        <USelect id="dashboard-title-routing" v-bind="selectProps" :model-value="variant" :items="variants"
            value-key="value" aria-label="Title model routing" :disabled="!editable || busy" @update:model-value="pickVariant" />
        <p class="supporting-text break-all">{{ model }}</p>
        <p v-if="!editable" class="supporting-text">A workspace administrator can change this model.</p>
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRuntimeConfig } from '#imports';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { getActiveWorkspaceId, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { DEFAULT_TITLE_MODEL } from '~~/shared/titles/title';
import { appendModelVariant, stripModelVariantSuffix } from '~~/shared/openrouter/model-variants';

const cloud = useRuntimeConfig().public.ssrAuthEnabled === true;
const settings = useAiSettings();
const { catalog } = useModelStore();
const model = ref(DEFAULT_TITLE_MODEL);
const busy = ref(true);
let revision = 0;
const error = ref('');
const editable = computed(() => !cloud || getCachedSessionContext()?.role === 'owner' || getCachedSessionContext()?.deploymentAdmin === true);
const baseModel = computed(() => stripModelVariantSuffix(model.value));
const variant = computed(() => model.value.endsWith(':nitro') ? 'nitro' : model.value.endsWith(':floor') ? 'floor' : 'off');
const variants = [{ label: 'Standard routing', value: 'off' }, { label: 'Nitro — fastest providers', value: 'nitro' }, { label: 'Floor — lowest price', value: 'floor' }];
const selectProps = useThemeOverrides({ component: 'selectmenu', context: 'dashboard', identifier: 'dashboard.ai.title-model', isNuxtUI: true });
const items = computed(() => {
    const choices = catalog.value.filter(m => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
        .map(m => ({ label: m.name || m.id, value: m.id }));
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
    } catch { if (operation === revision && generation === getWorkspaceGeneration()) error.value = 'Could not load the title model.'; }
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
        if (operation === revision && generation === getWorkspaceGeneration()) model.value = next;
    } catch { if (generation === getWorkspaceGeneration()) error.value = 'Could not save the title model. Check your access and connection, then try again.'; }
    finally { if (operation === revision) busy.value = false; }
}
function pickModel(value: unknown) { if (typeof value === 'string') void save(appendModelVariant(value, variant.value)); }
function pickVariant(value: unknown) { if (value === 'off' || value === 'nitro' || value === 'floor') void save(appendModelVariant(baseModel.value, value)); }
watch(() => settings.settings.value.titleGenerationModel, value => { if (!cloud) model.value = value; });
onMounted(load);
const stop = subscribeActiveWorkspaceDb(() => { model.value = DEFAULT_TITLE_MODEL; void load(); });
onBeforeUnmount(stop);
</script>
