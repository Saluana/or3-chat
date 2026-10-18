<template>
    <section class="space-y-4 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-6" aria-label="Cloud file cache settings">
        <div>
            <h2 class="text-lg font-medium">Cloud files and browser cache</h2>
            <p class="text-sm opacity-70">Settings apply to this workspace on its next file operation. Local-only originals and unfinished uploads are always protected.</p>
        </div>
        <form v-if="policy" class="space-y-4" @submit.prevent="save">
            <div class="grid gap-4 sm:grid-cols-2">
                <UFormField v-for="field in fields" :key="field.key" :label="field.label" :name="field.key">
                    <UInput v-model.number="values[field.key]" type="number" :min="field.min" :max="field.max" step="1" required :aria-label="field.label" />
                </UFormField>
            </div>
            <p class="text-xs opacity-70">Zero disables caching. The total budget covers reusable caches across this browser origin; protected originals may exceed it. Cloud backup includes originals even when they are not cached.</p>
            <UButton type="submit" :loading="saving">Save file settings</UButton>
        </form>
        <p v-else-if="!error" role="status">Loading file settings…</p>
        <p v-if="error" role="alert" class="text-[var(--md-error)]">{{ error }}</p>
        <p v-if="saved" role="status">File settings saved. No restart required.</p>
    </section>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { FilePolicySchema, MIB, type FilePolicy } from '~~/shared/storage/file-policy';
const props = defineProps<{ workspaceId?: string }>();
const policy = ref<FilePolicy | null>(null);
const targetWorkspaceId = ref('');
const values = reactive({ maxCachedFileBytes: 10, maxCacheBytes: 250, retentionDays: 14, maxUploadBytes: 100 });
const fields = [
    { key: 'maxCachedFileBytes' as const, label: 'Maximum cached file (MiB)', min: 0, max: 50 },
    { key: 'maxCacheBytes' as const, label: 'Browser cache budget (MiB)', min: 0, max: 2048 },
    { key: 'retentionDays' as const, label: 'Cache retention (days)', min: 1, max: 365 },
    { key: 'maxUploadBytes' as const, label: 'Maximum Cloud upload (MiB)', min: 1, max: 1024 },
];
const error = ref('');
const saving = ref(false);
const saved = ref(false);
watch(() => props.workspaceId, async id => {
    policy.value = null; targetWorkspaceId.value = ''; error.value = ''; saved.value = false;
    try {
        const result = await $fetch<{ workspaceId: string; policy: FilePolicy }>('/api/admin/workspace/file-policy', { query: { workspaceId: id } });
        if (props.workspaceId !== id) return;
        targetWorkspaceId.value = result.workspaceId;
        policy.value = result.policy;
        for (const field of fields) values[field.key] = result.policy[field.key] / (field.key === 'retentionDays' ? 1 : MIB);
    } catch { if (props.workspaceId === id) error.value = 'Unable to load file settings. Refresh to retry.'; }
}, { immediate: true });
async function save() {
    if (saving.value || !targetWorkspaceId.value) return;
    const id = props.workspaceId;
    const workspaceId = targetWorkspaceId.value;
    error.value = ''; saved.value = false; saving.value = true;
    try {
        const next = FilePolicySchema.parse(Object.fromEntries(fields.map(field => [field.key, Number(values[field.key]) * (field.key === 'retentionDays' ? 1 : MIB)])));
        await $fetch('/api/admin/workspace/file-policy', { method: 'POST', headers: ADMIN_HEADERS, body: { workspaceId, policy: next } });
        if (props.workspaceId === id && targetWorkspaceId.value === workspaceId) { policy.value = next; saved.value = true; }
    } catch { if (props.workspaceId === id) error.value = 'Could not save. Check the limits, or refresh if your account or workspace changed.'; }
    finally { saving.value = false; }
}
</script>
