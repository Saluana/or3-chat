<template>
    <div v-theme="'document.history'" class="history-panel" data-context="document">
        <div class="history-heading">
            <div>
                <span>Document timeline</span>
                <strong>Revision history</strong>
                <p>Review and restore compressed checkpoints synced with this workspace.</p>
            </div>
            <UButton :icon="plusIcon" color="neutral" variant="outline" size="sm" block class="checkpoint-button rounded-xl!" label="Create checkpoint" :loading="busy" @click="checkpoint" />
        </div>

        <UCard v-if="selected" class="revision-preview">
            <template #header>
                <div class="preview-title">
                    <div>
                        <strong>{{ selected.snapshot.title }}</strong>
                        <span>{{ formatDate(selected.manifest.createdAt) }}</span>
                    </div>
                    <UButton :icon="closeIcon" color="neutral" variant="ghost" size="xs" square aria-label="Close revision preview" @click="selected = null" />
                </div>
            </template>
            <div class="preview-body">
                <p v-for="(line, index) in previewLines(selected.snapshot.content)" :key="index">{{ line }}</p>
            </div>
            <template #footer>
                <UButton color="primary" block class="rounded-xl!" label="Restore this version" :disabled="busy" @click="restoreSelected" />
            </template>
        </UCard>

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
                class="revision-item h-auto! min-h-[4.5rem]! rounded-xl! px-3! py-2.5!"
                :class="{ selected: selected?.manifest.revisionId === revision.manifest.revisionId }"
                @click="selected = revision"
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
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
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
const closeIcon = useIcon('editor.close');
const plusIcon = useIcon('ui.plus');
const chevronIcon = useIcon('ui.chevron.right');

const revisions = ref<CompleteDocumentRevision[]>([]);
const selected = ref<CompleteDocumentRevision | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');

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

function restoreSelected() {
    if (!selected.value) return;
    emit('restore', selected.value);
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

watch(() => props.documentId, () => { selected.value = null; void load(); });
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
.revision-item { width: 100%; height: auto; min-height: 4.5rem; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; justify-content: stretch; gap: .65rem; padding: .65rem .75rem; border: 1px solid var(--md-outline-variant); background: var(--md-surface-container-low) !important; text-align: left; white-space: normal; box-shadow: 0 1px 1px color-mix(in oklab, var(--md-on-surface), transparent 96%); }
.revision-item:hover { border-color: color-mix(in oklab, var(--md-primary), var(--md-outline-variant) 55%); background: var(--md-surface-container) !important; }
.revision-item.selected { border-color: var(--md-primary); background: color-mix(in oklab, var(--md-primary-container), transparent 60%) !important; box-shadow: 0 0 0 2px color-mix(in oklab, var(--md-primary), transparent 88%); }
.revision-icon { width: 2rem; height: 2rem; display: grid; place-items: center; border-radius: calc(var(--md-border-radius) + .1rem); color: var(--md-primary); background: color-mix(in oklab, var(--md-primary-container), transparent 38%); }
.revision-icon svg { width: 1rem; height: 1rem; }
.revision-copy { min-width: 0; display: grid; gap: .28rem; }
.revision-copy strong { overflow: hidden; font-size: .76rem; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.revision-meta { display: flex; align-items: center; gap: .4rem; min-width: 0; }
.revision-copy small { min-width: 0; overflow: hidden; color: var(--md-on-surface-variant); font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }
.revision-chevron { width: .9rem; height: .9rem; color: var(--md-on-surface-variant); }
.revision-preview { overflow: hidden; border-color: color-mix(in oklab, var(--md-primary), var(--md-outline-variant) 55%); }
.preview-title { display: flex; justify-content: space-between; gap: .75rem; }
.preview-title > div { display: grid; }
.preview-title span { color: var(--md-on-surface-variant); font-size: .7rem; }
.preview-body { min-height: 4rem; max-height: 14rem; overflow: auto; padding: .8rem; border-radius: calc(var(--md-border-radius) + .2rem); background: var(--md-surface); }
.preview-body p { margin: 0 0 .45rem; font-size: .76rem; line-height: 1.45; }
.history-error { color: var(--md-error); font-size: .78rem; }
</style>
