<script setup lang="ts">
import type { StorageGenerationCandidatePage } from '~~/server/admin/stores/types';
import { formatBytes } from '~/utils/admin/customer-display';
const props = defineProps<{ workspaceId: string }>();
const page = ref<StorageGenerationCandidatePage | null>(null);
const error = ref('');
const busy = ref(false);
watch(() => props.workspaceId, () => { page.value = null; error.value = ''; });
async function inspect(cursor?: string) {
    const workspaceId = props.workspaceId;
    busy.value = true; error.value = '';
    try {
        const result = await $fetch<{ available: true; page: StorageGenerationCandidatePage } | { available: false; reason: string }>('/api/admin/storage/candidates', { query: { workspaceId, cursor }, retry: 0 });
        if (workspaceId !== props.workspaceId) return;
        if (result.available) page.value = result.page;
        else { page.value = null; error.value = result.reason; }
    } catch { error.value = 'Generation inspection unavailable. No objects or accounting were changed.'; }
    finally { busy.value = false; }
}
</script>
<template>
    <section class="space-y-3 border-t border-[var(--md-outline-variant)] pt-4" aria-labelledby="generation-preview-heading">
        <h3 id="generation-preview-heading" class="font-medium">Retained-file dry run</h3>
        <p class="text-sm opacity-70">Only explicitly enrolled immutable generations in this workspace are inspected, with a seven-day retention cutoff. Mutable legacy objects are excluded. This does not scan physical storage or authorize deletion. Cleanup and automation await provider qualification.</p>
        <UButton color="neutral" variant="soft" :loading="busy" @click="inspect()">Inspect managed generations</UButton>
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
            <p class="text-xs opacity-70">{{ page.complete ? 'End of this canonical scope.' : 'More generations exist; this page is incomplete.' }} Eligibility is rechecked by any future qualified claim; this read creates no claim.</p>
        </template>
    </section>
</template>
