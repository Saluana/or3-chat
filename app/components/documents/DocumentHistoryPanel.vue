<template>
    <div class="history-panel">
        <div class="history-heading">
            <div>
                <strong>Revision history</strong>
                <p>Synced, compressed checkpoints</p>
            </div>
            <button type="button" :disabled="busy" @click="checkpoint">Create checkpoint</button>
        </div>

        <div v-if="selected" class="revision-preview">
            <div class="preview-title">
                <div>
                    <strong>{{ selected.snapshot.title }}</strong>
                    <span>{{ formatDate(selected.manifest.createdAt) }}</span>
                </div>
                <button type="button" aria-label="Close revision preview" @click="selected = null">×</button>
            </div>
            <div class="preview-body">
                <p v-for="(line, index) in previewLines(selected.snapshot.content)" :key="index">{{ line }}</p>
            </div>
            <button type="button" class="restore-button" :disabled="busy" @click="restoreSelected">Restore this version</button>
        </div>

        <div v-if="loading" class="empty-state">Loading history…</div>
        <div v-else-if="!revisions.length" class="empty-state">
            <UIcon name="lucide:history" />
            <strong>No checkpoints yet</strong>
            <span>History appears after 30 seconds of inactivity or when you create one.</span>
        </div>
        <div v-else class="revision-list">
            <button
                v-for="revision in revisions"
                :key="revision.manifest.revisionId"
                type="button"
                @click="selected = revision"
            >
                <span class="revision-dot" />
                <span class="revision-copy">
                    <strong>{{ sourceLabel(revision.manifest.source) }}</strong>
                    <small>{{ formatDate(revision.manifest.createdAt) }}</small>
                </span>
                <span class="revision-size">{{ formatSize(revision.manifest.encodedBytes) }}</span>
            </button>
        </div>
        <p v-if="error" class="history-error" role="alert">{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { JSONContent } from '@tiptap/core';
import {
    listCompleteDocumentRevisions,
    type CompleteDocumentRevision,
} from '~/db/document-revisions';

const props = defineProps<{
    documentId: string;
    createCheckpoint: () => Promise<void>;
}>();
const emit = defineEmits<{ restore: [revision: CompleteDocumentRevision] }>();

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
.history-panel { display: grid; gap: 1rem; }
.history-heading { display: flex; align-items: start; justify-content: space-between; gap: .75rem; }
.history-heading p { margin: .2rem 0 0; color: var(--md-on-surface-variant); font-size: .75rem; }
.history-heading button, .restore-button { min-height: 2.25rem; padding: .4rem .65rem; border-radius: .6rem; background: var(--md-primary); color: var(--md-on-primary); font-size: .72rem; font-weight: 600; }
.empty-state { min-height: 12rem; display: grid; place-content: center; justify-items: center; gap: .45rem; text-align: center; color: var(--md-on-surface-variant); font-size: .78rem; }
.empty-state svg { width: 1.5rem; height: 1.5rem; }
.revision-list { display: grid; }
.revision-list > button { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .65rem; min-height: 3.75rem; padding: .5rem .25rem; border-bottom: 1px solid var(--md-outline-variant); text-align: left; }
.revision-dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--md-primary); }
.revision-copy { display: grid; gap: .15rem; }
.revision-copy strong { font-size: .78rem; }
.revision-copy small, .revision-size { color: var(--md-on-surface-variant); font-size: .68rem; }
.revision-preview { display: grid; gap: .75rem; padding: .8rem; border: 1px solid var(--md-outline-variant); border-radius: .8rem; background: var(--md-surface-container-low); }
.preview-title { display: flex; justify-content: space-between; }
.preview-title > div { display: grid; }
.preview-title span { color: var(--md-on-surface-variant); font-size: .7rem; }
.preview-title button { font-size: 1.2rem; }
.preview-body { max-height: 14rem; overflow: auto; padding: .7rem; border-radius: .55rem; background: var(--md-surface); }
.preview-body p { margin: 0 0 .45rem; font-size: .76rem; line-height: 1.45; }
.history-error { color: var(--md-error); font-size: .78rem; }
</style>
