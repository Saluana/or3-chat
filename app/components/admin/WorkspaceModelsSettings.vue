<template>
    <section aria-label="Workspace models" class="space-y-4 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-6">
        <h2 class="text-lg font-medium">Workspace models</h2>
        <form v-if="loaded" class="space-y-4" @submit.prevent="save">
            <UFormField label="Default model">
                <USelectMenu v-model="policy.defaultModel" aria-label="Workspace default model" :items="defaultChoices" value-key="value" class="w-full" :disabled="saving || catalogLoading" />
            </UFormField>
            <UFormField label="Workspace picks" description="Pin models for everyone in this workspace.">
                <USelectMenu v-model="policy.pinned" aria-label="Workspace picks" :items="visibleChoices" value-key="value" multiple class="w-full" :disabled="saving || catalogLoading" />
            </UFormField>
            <UFormField label="Hidden models" description="These models cannot be chosen for new responses in this workspace.">
                <USelectMenu v-model="policy.hidden" aria-label="Hidden models" :items="choices" value-key="value" multiple class="w-full" :disabled="saving || catalogLoading" />
            </UFormField>
            <UButton type="submit" :loading="saving" :disabled="saving">Save workspace models</UButton>
        </form>
        <p v-else-if="!error" role="status">Loading models…</p>
        <p v-if="error" role="alert" class="text-sm text-[var(--md-error)]">{{ error }}</p>
        <UButton v-if="error && !loaded" color="neutral" variant="soft" @click="load">Try again</UButton>
        <p v-if="catalogLoading" role="status" class="text-sm">Loading available models…</p>
        <p v-if="catalogError" role="alert" class="text-sm text-[var(--md-error)]">{{ catalogError }}</p>
        <UButton v-if="catalogError" color="neutral" variant="soft" :loading="catalogLoading" @click="loadCatalog">Retry loading models</UButton>
        <p v-if="saved" role="status" class="text-sm">Workspace models saved.</p>
    </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import { formatModelName, isChatModel } from '~/utils/modelCatalog';
import { modelIdentity } from '~~/shared/ai/model-catalog';
import { emptyWorkspaceModels, WorkspaceModelsSchema, isModelHidden } from '~~/shared/ai/workspace-models';
const props = defineProps<{ workspaceId?: string }>();
const policy = ref(emptyWorkspaceModels());
const loaded = ref(false); const saving = ref(false); const saved = ref(false); const error = ref('');
const target = ref('');
const catalog = ref<OpenRouterModel[]>([]);
const catalogLoading = ref(false); const catalogError = ref('');
const choices = computed(() => {
    const rows = catalog.value.filter(isChatModel).map(model => ({ value: model.id,
        label: `${formatModelName(model.name)} · ${modelIdentity(model).platformName}` }));
    for (const id of [...policy.value.hidden, ...policy.value.pinned, policy.value.defaultModel].filter((id): id is string => !!id))
        if (!rows.some(row => row.value === id)) rows.push({ value: id, label: id });
    return rows;
});
const visibleChoices = computed(() => choices.value.filter(row => !isModelHidden(policy.value, row.value)));
const defaultChoices = computed(() => [{ label: 'Use personal preference', value: null }, ...visibleChoices.value]);
let revision = 0;
async function loadCatalog() {
    const owner = revision;
    catalogLoading.value = true; catalogError.value = '';
    try {
        const result = await $fetch<{ data: OpenRouterModel[]; unavailable: string[] }>('/api/admin/workspace/model-catalog', { query: { workspaceId: target.value } });
        if (owner !== revision) return;
        catalog.value = result.data;
        if (result.unavailable.length) catalogError.value = `Could not load ${result.unavailable.join(' and ')} models. Try again.`;
    } catch { if (owner === revision) catalogError.value = 'Could not load available models. Try again.'; }
    finally { if (owner === revision) catalogLoading.value = false; }
}
async function load() {
    if (import.meta.server) return;
    const owner = ++revision; const id = props.workspaceId;
    loaded.value = false; saved.value = false; error.value = '';
    catalog.value = []; catalogError.value = ''; catalogLoading.value = false;
    try {
        const result = await $fetch<{ workspaceId: string; policy: unknown }>('/api/admin/workspace/models', { query: { workspaceId: id } });
        if (owner !== revision) return;
        policy.value = WorkspaceModelsSchema.parse(result.policy); target.value = result.workspaceId; loaded.value = true;
        void loadCatalog();
    } catch { if (owner === revision) error.value = 'Could not load workspace models.'; }
}
watch(() => props.workspaceId, load, { immediate: true });
async function save() {
    if (saving.value) return;
    const owner = revision;
    const parsed = WorkspaceModelsSchema.safeParse(policy.value);
    if (!parsed.success) { error.value = 'Remove hidden models from your picks and default before saving.'; return; }
    saving.value = true; error.value = ''; saved.value = false;
    try {
        await $fetch('/api/admin/workspace/models', { method: 'POST', headers: ADMIN_HEADERS, body: { workspaceId: target.value, policy: parsed.data } });
        if (owner === revision) saved.value = true;
    } catch { if (owner === revision) error.value = 'Could not save workspace models. Try again.'; }
    finally { saving.value = false; }
}
</script>
