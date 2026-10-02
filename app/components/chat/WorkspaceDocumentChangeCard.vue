<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { liveQuery } from 'dexie';
import AppModal from '~/components/ui/AppModal.vue';
import type { WorkspaceDocumentChangeRef, WorkspaceDocumentChange } from '~/utils/chat/workspace-document-change';
import type { WorkspaceSource } from '~/utils/chat/workspace-items';
import { getActiveWorkspaceId, subscribeActiveWorkspaceDb } from '~/db/client';

const props = defineProps<{ receipt: WorkspaceDocumentChangeRef & { source: WorkspaceSource } }>();
const emit = defineEmits<{ resize: [] }>();
const change = ref<WorkspaceDocumentChange | null>(null);
const open = ref(false);
const busy = ref(false);
const error = ref('');
const available = ref(true);
const stale = ref(false);
const changes = ref<Array<{ label: string; beforePreview: string; afterPreview: string }>>([]);
const pending = computed(() => change.value?.status === 'pending');
let stop: (() => void) | undefined;
let subscription: { unsubscribe: () => void } | undefined;
let disposed = false;
let refreshGeneration = 0;
const status = computed(() => !available.value ? 'Originating workspace unavailable'
    : stale.value ? 'Document changed · Update proposal from a new read'
    : change.value?.status === 'applied' ? 'Changes saved locally'
    : change.value?.status === 'undone' ? 'Change undone locally'
    : change.value?.status === 'discarded' ? 'Changes discarded'
    : pending.value ? 'Review changes before saving' : 'Loading document change…');

async function refresh(review = false) {
    const generation = ++refreshGeneration;
    try {
        const module = await import('~/utils/chat/workspace-document-change');
        const loaded = await module.loadWorkspaceDocumentChange(props.receipt);
        if (disposed || generation !== refreshGeneration) return;
        change.value = loaded.change;
        available.value = true;
        if (review && loaded.change.status === 'pending') {
            const prepared = await module.prepareWorkspaceDocumentChange(loaded.scope, loaded.change, loaded.message.thread_id);
            loaded.scope.assertCurrent();
            if (disposed || generation !== refreshGeneration) return;
            changes.value = prepared.changes;
            stale.value = false;
        }
        emit('resize');
    } catch (caught) {
        if (disposed || generation !== refreshGeneration) return;
        error.value = caught instanceof Error ? caught.message : 'This change is unavailable.';
        stale.value = /document changed|proposal.*new read/iu.test(error.value);
        if (!stale.value) available.value = false;
        emit('resize');
    }
}
async function review() {
    error.value = '';
    busy.value = true;
    await refresh(true);
    busy.value = false;
    if (available.value && !stale.value) open.value = true;
}
async function act(action: 'apply' | 'undo' | 'discard') {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
        const module = await import('~/utils/chat/workspace-document-change');
        const result = action === 'apply' ? await module.applyWorkspaceDocumentChange(props.receipt)
            : action === 'undo' ? await module.undoWorkspaceDocumentChange(props.receipt)
            : await module.discardWorkspaceDocumentChange(props.receipt);
        if (disposed || props.receipt.workspaceId !== (getActiveWorkspaceId() ?? 'local')) return;
        change.value = result;
        open.value = false;
    } catch (caught) {
        error.value = caught instanceof Error ? caught.message : 'This change could not be saved.';
        stale.value = /changed|later/iu.test(error.value);
        // Re-read host state: a post-commit notification/navigation failure cannot claim unsaved content.
        await refresh();
    } finally { busy.value = false; emit('resize'); }
}
async function openDocument() {
    try {
        const { openWorkspaceSource } = await import('~/utils/chat/workspace-source-receipts');
        await openWorkspaceSource({ workspaceId: props.receipt.workspaceId, source: props.receipt.source, partial: false });
    } catch (caught) { error.value = caught instanceof Error ? caught.message : 'This document is unavailable.'; }
}
onMounted(async () => {
    stop = subscribeActiveWorkspaceDb(() => {
        refreshGeneration += 1;
        available.value = false; open.value = false; changes.value = [];
        subscription?.unsubscribe();
        emit('resize');
    });
    const module = await import('~/utils/chat/workspace-document-change');
    try {
        const { scope } = await module.loadWorkspaceDocumentChange(props.receipt);
        if (disposed) return;
        subscription = liveQuery(async () => {
            await scope.db.messages.get(props.receipt.messageId);
            await scope.db.posts.get(props.receipt.documentId);
            return true;
        }).subscribe({ next: () => { if (!busy.value) void refresh(open.value); }, error: () => { available.value = false; } });
        await refresh();
    } catch { available.value = false; }
});
onBeforeUnmount(() => { disposed = true; refreshGeneration += 1; stop?.(); subscription?.unsubscribe(); });
</script>

<template>
    <section class="mt-2 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-3 text-sm" aria-label="Document changes">
        <p class="font-medium text-[var(--md-on-surface)]">{{ receipt.source.title }}</p>
        <p role="status" class="mt-1 text-xs text-[var(--md-on-surface-variant)]">{{ status }}</p>
        <div class="mt-2 flex flex-wrap gap-2">
            <UButton v-if="pending" label="Review changes" color="neutral" variant="outline" class="min-h-11" :disabled="busy || !available || stale" @click="review" />
            <UButton v-if="pending" label="Discard" color="neutral" variant="ghost" class="min-h-11" :disabled="busy || !available" @click="act('discard')" />
            <UButton v-if="change?.status === 'applied' && !stale" label="Undo" color="neutral" variant="outline" class="min-h-11" :disabled="busy || !available" @click="act('undo')" />
            <UButton label="Open document" color="neutral" variant="ghost" class="min-h-11" :disabled="busy || !available" @click="openDocument" />
        </div>
        <p v-if="error" role="alert" class="mt-2 text-xs text-[var(--md-error)]">{{ error }}</p>
        <AppModal v-model:open="open" title="Review document changes" size="md" close-label="Close review">
            <div class="document-editor-root max-h-[60dvh] space-y-4 overflow-auto" data-context="document">
                <article v-for="(entry, index) in changes" :key="index" class="document-ai-hunk">
                    <div class="document-ai-hunk-header"><span class="document-ai-hunk-badge">{{ index + 1 }}</span><strong class="document-ai-hunk-title">{{ entry.label }}</strong></div>
                    <div class="document-ai-hunk-body is-expanded">
                        <div v-if="entry.beforePreview" class="document-ai-hunk-pane is-before"><span class="document-ai-hunk-pane-mark" aria-hidden="true">−</span><div class="document-ai-hunk-pane-stack"><span class="document-ai-hunk-pane-label">Removed</span><div class="document-ai-hunk-pane-text">{{ entry.beforePreview }}</div></div></div>
                        <div v-if="entry.afterPreview" class="document-ai-hunk-pane is-after"><span class="document-ai-hunk-pane-mark" aria-hidden="true">+</span><div class="document-ai-hunk-pane-stack"><span class="document-ai-hunk-pane-label">Added</span><div class="document-ai-hunk-pane-text">{{ entry.afterPreview }}</div></div></div>
                    </div>
                </article>
                <p v-if="error" role="alert" class="text-sm text-[var(--md-error)]">{{ error }}</p>
            </div>
            <template #footer>
                <UButton label="Discard" color="neutral" variant="ghost" class="min-h-11" :disabled="busy || !available" @click="act('discard')" />
                <UButton label="Apply changes" class="min-h-11" :loading="busy" :disabled="busy || !available || stale || !pending" @click="act('apply')" />
            </template>
        </AppModal>
    </section>
</template>
