<template>
    <div v-theme="'document.history'" class="history-panel" data-context="document">
        <div class="history-heading">
            <div>
                <span>Document timeline</span>
                <strong>Revision history</strong>
                <p>Review and restore compressed checkpoints synced with this workspace.</p>
            </div>
            <UButton
                :icon="plusIcon"
                color="neutral"
                variant="outline"
                size="sm"
                block
                class="checkpoint-button"
                label="Create checkpoint"
                :loading="busy"
                @click="checkpoint"
            />
        </div>

        <div v-if="loading" class="empty-state">Loading history…</div>
        <div v-else-if="!revisions.length" class="empty-state">
            <UIcon :name="historyIcon" />
            <strong>No checkpoints yet</strong>
            <span>History appears after 30 seconds of inactivity or when you create one.</span>
        </div>
        <div v-else class="revision-list">
            <UButton
                v-for="revision in revisions"
                :key="revision.manifest.revisionId"
                color="neutral"
                variant="ghost"
                class="revision-item h-auto! min-h-[4.5rem]! px-3! py-2.5!"
                :class="{ selected: selected?.manifest.revisionId === revision.manifest.revisionId }"
                @click="openPreview(revision)"
            >
                <span class="revision-icon"><UIcon :name="historyIcon" /></span>
                <span class="revision-copy">
                    <strong>{{ sourceLabel(revision.manifest.source) }}</strong>
                    <span class="revision-meta">
                        <small>{{ formatDate(revision.manifest.createdAt) }}</small>
                        <UBadge color="neutral" variant="soft" size="xs">{{ formatSize(revision.manifest.encodedBytes) }}</UBadge>
                    </span>
                </span>
                <UIcon :name="chevronIcon" class="revision-chevron" />
            </UButton>
        </div>
        <p v-if="error" class="history-error" role="alert">{{ error }}</p>

        <UModal
            v-model:open="previewOpen"
            :title="previewTitle"
            :description="previewDescription"
            :ui="{ content: 'sm:max-w-lg' }"
        >
            <template #body>
                <div v-if="selected" class="preview-body">
                    <p v-for="(line, index) in selectedPreviewLines" :key="index">{{ line }}</p>
                    <p v-if="!selectedPreviewLines.length" class="preview-empty">This checkpoint has no readable text preview.</p>
                </div>
            </template>
            <template #footer>
                <div class="preview-actions">
                    <UButton color="neutral" variant="soft" label="Cancel" @click="closePreview" />
                    <UButton color="primary" label="Restore this version" :disabled="busy || !selected" @click="restoreSelected" />
                </div>
            </template>
        </UModal>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { JSONContent } from '@tiptap/core';
import { useIcon } from '~/composables/useIcon';
import {
    listCompleteDocumentRevisions,
    type CompleteDocumentRevision,
} from '~/db/document-revisions';

const props = defineProps<{
    documentId: string;
    createCheckpoint: () => Promise<void>;
}>();
const emit = defineEmits<{ restore: [revision: CompleteDocumentRevision] }>();
const historyIcon = useIcon('editor.history');
const plusIcon = useIcon('ui.plus');
const chevronIcon = useIcon('ui.chevron.right');

const revisions = ref<CompleteDocumentRevision[]>([]);
const selected = ref<CompleteDocumentRevision | null>(null);
const previewOpen = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref('');

const previewTitle = computed(() => selected.value?.snapshot.title || 'Checkpoint preview');
const previewDescription = computed(() => {
    if (!selected.value) return 'Review this checkpoint before restoring it.';
    return `${sourceLabel(selected.value.manifest.source)} · ${formatDate(selected.value.manifest.createdAt)} · ${formatSize(selected.value.manifest.encodedBytes)}`;
});
const selectedPreviewLines = computed(() =>
    selected.value ? previewLines(selected.value.snapshot.content) : []
);

async function load() {
    loading.value = true;
    error.value = '';
    try {
        revisions.value = await listCompleteDocumentRevisions(props.documentId);
    } catch (caught) {
        error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
        loading.value = false;
    }
}

async function checkpoint() {
    busy.value = true;
    error.value = '';
    try {
        await props.createCheckpoint();
        await load();
    } catch (caught) {
        error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
        busy.value = false;
    }
}

function openPreview(revision: CompleteDocumentRevision) {
    selected.value = revision;
    previewOpen.value = true;
}

function closePreview() {
    previewOpen.value = false;
    selected.value = null;
}

function restoreSelected() {
    if (!selected.value) return;
    const revision = selected.value;
    closePreview();
    emit('restore', revision);
}

function formatDate(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(timestamp * 1000);
}

function formatSize(bytes: number) {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function sourceLabel(source: string) {
    return source === 'ai' ? 'Before AI edit'
        : source === 'restore' ? 'Before restore'
        : source === 'manual' ? 'Manual checkpoint'
        : 'Automatic checkpoint';
}

function nodeText(node: JSONContent): string {
    if (node.text) return node.text;
    return (node.content ?? []).map(nodeText).join('');
}

function previewLines(content: JSONContent) {
    return (content.content ?? []).slice(0, 12)
        .map(nodeText)
        .map((line) => line.trim())
        .filter(Boolean);
}

watch(previewOpen, (open) => {
    if (!open) selected.value = null;
});
watch(() => props.documentId, () => {
    closePreview();
    void load();
});
onMounted(load);
</script>

<style scoped>
.history-panel { display: grid; gap: 1.1rem; }
.history-heading { display: grid; gap: .85rem; }
.history-heading > div { display: grid; gap: .2rem; }
.history-heading > div > span { color: var(--md-primary); font-size: .62rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.history-heading strong { font-size: 1.05rem; line-height: 1.25; }
.history-heading p { margin: 0; color: var(--md-on-surface-variant); font-size: .72rem; line-height: 1.45; }
.checkpoint-button { justify-content: center; }
.empty-state { min-height: 12rem; display: grid; place-content: center; justify-items: center; gap: .45rem; text-align: center; color: var(--md-on-surface-variant); font-size: .78rem; }
.empty-state svg { width: 1.5rem; height: 1.5rem; }
.revision-list { display: grid; gap: .65rem; }
.revision-item {
    width: 100%;
    height: auto;
    min-height: 4.5rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    justify-content: stretch;
    gap: .65rem;
    padding: .65rem .75rem;
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    background: var(--md-surface-container-low) !important;
    text-align: left;
    white-space: normal;
}
.revision-item:hover {
    border-color: color-mix(in oklab, var(--md-primary), var(--md-border-color) 55%);
    background: var(--md-surface-container) !important;
}
.revision-item.selected {
    border-width: var(--md-border-width-strong, var(--md-border-width));
    border-color: var(--md-primary);
    background: color-mix(in oklab, var(--md-primary-container), transparent 60%) !important;
}
.revision-icon {
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    color: var(--md-primary);
    background: color-mix(in oklab, var(--md-primary-container), transparent 38%);
}
.revision-icon svg { width: 1rem; height: 1rem; }
.revision-copy { min-width: 0; display: grid; gap: .28rem; }
.revision-copy strong { overflow: hidden; font-size: .76rem; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.revision-meta { display: flex; align-items: center; gap: .4rem; min-width: 0; }
.revision-copy small { min-width: 0; overflow: hidden; color: var(--md-on-surface-variant); font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }
.revision-chevron { width: .9rem; height: .9rem; color: var(--md-on-surface-variant); }
.preview-body {
    min-height: 4rem;
    max-height: min(50vh, 22rem);
    overflow: auto;
    padding: .85rem;
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    background: var(--md-surface-container-low);
}
.preview-body p { margin: 0 0 .45rem; font-size: .76rem; line-height: 1.45; }
.preview-empty { color: var(--md-on-surface-variant); }
.preview-actions { display: flex; justify-content: flex-end; gap: .55rem; width: 100%; }
.history-error { color: var(--md-error); font-size: .78rem; }
</style>
