<script setup lang="ts">
import type { StorageGenerationCandidatePage } from '~~/server/admin/stores/types';
import type { StorageReclamationProgress } from '~~/server/storage/gateway/types';
import { formatBytes } from '~/utils/admin/customer-display';
import AppModal from '~/components/ui/AppModal.vue';
const props = defineProps<{ workspaceId: string }>();
const page = ref<StorageGenerationCandidatePage | null>(null);
const error = ref('');
const busy = ref(false);
const reviewOpen = ref(false);
const cleanupAvailable = ref(false);
const pageCursor = ref<string | undefined>();
const progress = ref<StorageReclamationProgress | null>(null);
const cleaning = ref(false);
const eligibleCount = computed(() => page.value?.items.filter(item => item.status === 'eligible' || item.status === 'claimed').length ?? 0);
watch(() => props.workspaceId, () => { page.value = null; error.value = ''; reviewOpen.value = false; cleanupAvailable.value = false; progress.value = null; });
async function inspect(cursor?: string) {
    const workspaceId = props.workspaceId;
    busy.value = true; error.value = '';
    try {
        const result = await $fetch<{ available: true; page: StorageGenerationCandidatePage; cleanupAvailable: boolean } | { available: false; reason: string }>('/api/admin/storage/candidates', { query: { workspaceId, cursor }, retry: 0 });
        if (workspaceId !== props.workspaceId) return;
        if (result.available) { page.value = result.page; cleanupAvailable.value = result.cleanupAvailable; pageCursor.value = cursor; progress.value = null; }
        else { page.value = null; cleanupAvailable.value = false; error.value = result.reason; }
    } catch { error.value = 'Generation inspection unavailable. No objects or accounting were changed.'; }
    finally { busy.value = false; }
}
async function cleanup() {
    const workspaceId = props.workspaceId;
    busy.value = true; cleaning.value = true; error.value = ''; reviewOpen.value = false;
    try {
        const generationIds = page.value?.items.filter(item => item.status === 'eligible' || item.status === 'claimed').map(item => item.generation.generationId) ?? [];
        const result = await $fetch<StorageReclamationProgress>('/api/admin/storage/cleanup', { method: 'POST', headers: { 'x-or3-admin-intent': 'admin' }, body: { workspaceId, cursor: pageCursor.value, generationIds }, retry: 0 });
        if (workspaceId === props.workspaceId) progress.value = result;
    } catch {
        if (workspaceId === props.workspaceId) error.value = 'Cleanup did not finish. Some files may already have been removed; inspect and retry this page to resume safely.';
    } finally { busy.value = false; cleaning.value = false; }
}
</script>
<template>
    <section class="space-y-3 border-t border-[var(--md-outline-variant)] pt-4" aria-labelledby="generation-preview-heading">
        <h3 id="generation-preview-heading" class="font-medium">Retained-file dry run</h3>
        <p class="text-sm opacity-70">Only explicitly enrolled immutable generations in this workspace are inspected, with a seven-day retention cutoff. Mutable legacy objects are excluded. This inspection does not scan physical storage or authorize deletion.</p>
        <UButton color="neutral" variant="soft" :loading="busy" @click="inspect()">Inspect managed generations</UButton>
        <UButton :to="`/admin/activity?targetId=${encodeURIComponent(workspaceId)}`" color="neutral" variant="soft">Cleanup history and interrupted actions</UButton>
        <p v-if="cleaning" role="status" class="text-sm">Cleanup batch is running. Its result will appear here; an interrupted action remains visible in history.</p>
        <p v-if="error" role="status" class="text-sm">{{ error }}</p>
        <template v-if="page">
            <p role="status" class="text-sm">Observed {{ new Date(page.observedAt * 1000).toLocaleString() }}. This page: {{ page.items.length }} generations; {{ page.estimatedLogicalBytes === null ? 'unknown' : formatBytes(page.estimatedLogicalBytes) }} potentially eligible logical bytes. Freed disk space is unknown.</p>
            <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr><th scope="col" class="p-2">Exact identity</th><th scope="col" class="p-2">Logical size</th><th scope="col" class="p-2">Advisory result</th></tr></thead><tbody>
                <tr v-for="item in page.items" :key="item.generation.generationId" class="border-t border-[var(--md-outline-variant)]">
                    <td class="p-2 font-mono text-xs break-all">{{ item.generation.generationId }}<div>{{ item.generation.hash }}</div><div>{{ item.generation.storageId }}</div></td>
                    <td class="p-2">{{ formatBytes(item.generation.sizeBytes) }}</td><td class="p-2">{{ item.status }}<div>{{ item.reason }}</div></td>
                </tr><tr v-if="!page.items.length"><td colspan="3" class="p-2">No enrolled generations in this scope. Legacy usage is not classified by this inspection.</td></tr>
            </tbody></table></div>
            <UButton v-if="page.nextCursor" color="neutral" variant="soft" :disabled="busy" @click="inspect(page.nextCursor ?? undefined)">Next 25 generations</UButton>
            <UButton color="neutral" variant="soft" :disabled="busy || eligibleCount === 0" @click="reviewOpen = true">Review cleanup</UButton>
            <p v-if="progress" role="status" class="text-sm">Last batch: {{ progress.examined }} examined, {{ progress.completed }} completed, {{ progress.blocked }} blocked and {{ progress.pending }} pending. {{ progress.pending ? 'Review and retry this page to resume.' : 'Inspect again for current results.' }}</p>
            <p class="text-xs opacity-70">{{ page.complete ? 'End of this canonical scope.' : 'More generations exist; this page is incomplete.' }} Eligibility is rechecked by any future qualified claim; this read creates no claim.</p>
            <AppModal v-model:open="reviewOpen" title="Review retained-file cleanup" description="Current preview page">
                <div class="space-y-4">
                    <p class="text-sm">{{ eligibleCount }} generations on this page are eligible or already claimed for retry. The estimate for newly eligible generations is {{ page.estimatedLogicalBytes === null ? 'unknown' : formatBytes(page.estimatedLogicalBytes) }} of logical storage; actual freed disk space may differ.</p>
                    <p class="text-sm">This preview covers only this page and excludes legacy files. Eligibility must be checked again before deletion.</p>
                    <UAlert v-if="!cleanupAvailable" color="neutral" variant="soft" title="Cleanup unavailable" description="This storage provider pairing has not completed the safety qualification. Manual and automatic cleanup are unavailable for this pairing." />
                    <div class="flex flex-wrap gap-2"><UButton color="neutral" variant="soft" @click="reviewOpen = false">Close</UButton><UButton :disabled="!cleanupAvailable || busy" @click="cleanup">Confirm cleanup</UButton></div>
                </div>
            </AppModal>
        </template>
    </section>
</template>
