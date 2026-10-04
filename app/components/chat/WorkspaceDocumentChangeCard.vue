<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { liveQuery } from 'dexie';
import AppModal from '~/components/ui/AppModal.vue';
import type { WorkspaceDocumentChangeRef, WorkspaceDocumentChange } from '~/utils/chat/workspace-document-change';
import type { WorkspaceSource } from '~/utils/chat/workspace-items';
import { getActiveWorkspaceId, subscribeActiveWorkspaceDb } from '~/db/client';
import { isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { captureWorkspaceOperation } from '~/utils/chat/workspace-access';

const DocumentHistoryPanel = defineAsyncComponent(() => import('~/components/documents/DocumentHistoryPanel.vue'));
const historyOpen = ref(false);

const props = defineProps<{ receipt: WorkspaceDocumentChangeRef & { source: WorkspaceSource } }>();
const emit = defineEmits<{ resize: [] }>();
const change = ref<WorkspaceDocumentChange | null>(null);
const open = ref(false);
const busy = ref(false);
const error = ref('');
const available = ref(true);
const stale = ref(false);
const requestPrepared = ref(false);
const changes = ref<Array<{ label: string; beforePreview: string; afterPreview: string }>>([]);
const pending = computed(() => change.value?.status === 'pending');
let stop: (() => void) | undefined;
let subscription: { unsubscribe: () => void } | undefined;
let disposed = false;
let refreshGeneration = 0;
const status = computed(() => !available.value ? 'Document or originating workspace unavailable'
    : requestPrepared.value ? 'Fresh-read request added to your draft · Send it to prepare a new proposal'
    : stale.value ? change.value?.status === 'applied' ? 'Document changed · View history to preserve later edits' : 'Document changed · Update proposal from a new read'
    : change.value?.status === 'applied' ? 'Changes saved locally'
    : change.value?.status === 'undone' ? 'Change undone locally'
    : change.value?.status === 'discarded' ? 'Changes discarded'
    : pending.value ? 'Review changes before saving' : 'Loading document change…');

function captureOrigin() {
    return captureWorkspaceOperation({ subject: null, workspaceId: props.receipt.workspaceId,
        threadId: 'document-review', messageId: props.receipt.messageId, callId: props.receipt.changeId,
        requestId: props.receipt.changeId, abortSignal: new AbortController().signal });
}

async function refresh(review = false) {
    const generation = ++refreshGeneration;
    try {
        const origin = captureOrigin();
        const module = await import('~/utils/chat/workspace-document-change');
        origin.assertCurrent();
        const loaded = await module.loadWorkspaceDocumentChange(props.receipt);
        origin.assertCurrent();
        if (disposed || generation !== refreshGeneration) return;
        change.value = loaded.change;
        available.value = true;
        if (loaded.change.status === 'pending' || loaded.change.status === 'applied') {
            const row = await loaded.scope.db.posts.get(props.receipt.documentId);
            loaded.scope.assertCurrent();
            if (disposed || generation !== refreshGeneration) return;
            if (!row || row.postType !== 'doc' || !isVisibleWorkspaceItem(row)) throw new Error('This document is unavailable.');
            const { workspaceRevision } = await import('~/utils/chat/workspace-items');
            const revision = await workspaceRevision(row);
            loaded.scope.assertCurrent();
            if (disposed || generation !== refreshGeneration) return;
            stale.value = revision !== (loaded.change.status === 'pending' ? loaded.change.baseRevision : loaded.change.afterRevision);
            if (stale.value) { changes.value = []; open.value = false; }
        }
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
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    error.value = '';
    busy.value = true;
    await refresh(true);
    busy.value = false;
    await nextTick();
    if (!disposed && available.value && !stale.value) {
        // Disabling the trigger during preparation blurs it. Restore it before
        // the shared modal records the opener for Escape/close focus return.
        if (opener?.isConnected) opener.focus();
        open.value = true;
    }
}
async function act(action: 'apply' | 'undo' | 'discard') {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
        const origin = captureOrigin();
        origin.assertCurrent('write');
        const module = await import('~/utils/chat/workspace-document-change');
        origin.assertCurrent('write');
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
        const origin = captureOrigin();
        const { openWorkspaceSource } = await import('~/utils/chat/workspace-source-receipts');
        origin.assertCurrent();
        await openWorkspaceSource({ workspaceId: props.receipt.workspaceId, source: props.receipt.source, partial: false });
    } catch (caught) { error.value = caught instanceof Error ? caught.message : 'This document is unavailable.'; }
}
async function updateProposal() {
    if (busy.value || requestPrepared.value) return;
    busy.value = true; error.value = '';
    try {
        const origin = captureOrigin();
        const [{ loadWorkspaceDocumentChange }, { readWorkspaceItem }, { getGlobalMultiPaneApi }, { programmaticInsertReference }] = await Promise.all([
            import('~/utils/chat/workspace-document-change'), import('~/utils/chat/workspace-items'),
            import('~/utils/multiPaneApi'), import('~/composables/chat/useChatInputBridge'),
        ]);
        origin.assertCurrent();
        const loaded = await loadWorkspaceDocumentChange(props.receipt);
        origin.assertCurrent();
        const latest = await readWorkspaceItem(origin, { kind: 'document', id: props.receipt.documentId });
        origin.assertCurrent();
        const api = getGlobalMultiPaneApi();
        const index = api?.panes.value.findIndex(pane => pane.mode === 'chat' && pane.threadId === loaded.message.thread_id) ?? -1;
        if (!api || index < 0) throw new Error('Return to the originating chat and retry.');
        const pane = api.panes.value[index]!;
        api.setActive(index);
        const result = programmaticInsertReference(pane.id, { id: latest.source.id, source: 'document', label: latest.source.title },
            'Read the latest version of this document and prepare a new proposal for the requested changes. Do not apply it.');
        if (result.status !== 'ready') throw new Error('Enable document mentions in this chat and retry.');
        requestPrepared.value = true;
        open.value = false;
    } catch (caught) { error.value = caught instanceof Error ? caught.message : 'This proposal could not be updated.'; }
    finally { busy.value = false; }
}
onMounted(async () => {
    stop = subscribeActiveWorkspaceDb(() => {
        refreshGeneration += 1;
        available.value = false; open.value = false; historyOpen.value = false; changes.value = [];
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
            <UButton size="touch" v-if="pending" label="Review changes" color="neutral" variant="outline" class="min-h-11" :disabled="busy || !available || stale" @click="review" />
            <UButton size="touch" v-if="pending && stale" label="Update proposal" color="neutral" variant="outline" :disabled="busy || !available || requestPrepared" @click="updateProposal" />
            <UButton size="touch" v-if="pending" label="Discard" color="neutral" variant="ghost" class="min-h-11" :disabled="busy || !available" @click="act('discard')" />
            <UButton size="touch" v-if="change?.status === 'applied' && !stale" label="Undo" color="neutral" variant="outline" class="min-h-11" :disabled="busy || !available" @click="act('undo')" />
            <UButton size="touch" v-if="change?.status === 'applied' && stale" label="View history" color="neutral" variant="outline" class="min-h-11" :disabled="busy || !available" @click="historyOpen = true" />
            <UButton size="touch" label="Open document" color="neutral" variant="ghost" class="min-h-11" :disabled="busy || !available" @click="openDocument" />
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
                <UButton size="touch" label="Discard" color="neutral" variant="ghost" class="min-h-11" :disabled="busy || !available" @click="act('discard')" />
                <UButton size="touch" label="Apply changes" class="min-h-11" :loading="busy" :disabled="busy || !available || stale || !pending" @click="act('apply')" />
            </template>
        </AppModal>
        <AppModal v-model:open="historyOpen" title="Document history" size="md" close-label="Close history">
            <DocumentHistoryPanel v-if="historyOpen && available" :document-id="receipt.documentId" read-only />
        </AppModal>
    </section>
</template>
