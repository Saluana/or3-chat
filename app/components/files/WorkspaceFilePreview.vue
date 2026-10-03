<script setup lang="ts">
defineProps<{
    title: string;
    type: string;
    size: string;
    icon: string;
    coverage: string;
    project: string;
    text: string;
    imageUrl: string;
    partial: boolean;
    disabled: boolean;
    document: boolean;
    status?: string;
}>();
defineEmits<{ ask: []; download: []; open: [] }>();
const chatIcon = useIcon('sidebar.chat');
const openIcon = useIcon('ui.open_tab');
const downloadIcon = useIcon('ui.download');
</script>

<template>
    <div class="file-preview">
        <div class="preview-summary">
            <span class="preview-icon"><UIcon :name="icon" class="size-8" /></span>
            <h2>{{ title }}</h2>
            <p>{{ type }}<template v-if="size !== '—'"> · {{ size }}</template></p>
        </div>
        <div class="preview-actions">
            <UButton size="workspace" label="Ask in chat" :icon="chatIcon" class="justify-center flex-1 gap-2" :disabled="disabled" @click="$emit('ask')" />
            <UButton size="workspace" :icon="downloadIcon" aria-label="Download" :title="document ? 'Download as Markdown' : 'Download original'" color="neutral" variant="outline" square :disabled="disabled" @click="$emit('download')" />
        </div>
        <UButton v-if="document" size="workspace" label="Open document" :icon="openIcon" color="neutral" variant="outline" class="w-full justify-center mb-5" @click="$emit('open')" />
        <div class="preview-content">
            <img v-if="imageUrl" :src="imageUrl" :alt="title" class="max-h-[40dvh] max-w-full object-contain mx-auto" />
            <p v-if="!document && !imageUrl && partial" class="preview-note">{{ text ? 'Showing the searchable portion of this file.' : 'A preview is not available for this format. Download the original to open it.' }}</p>
            <pre v-if="text">{{ text }}</pre>
            <p v-else-if="document" class="preview-note">This document is empty.</p>
        </div>
        <div class="preview-information">
            <h3>File details</h3>
            <dl>
                <div><dt>Type</dt><dd>{{ type }}</dd></div>
                <div v-if="size !== '—'"><dt>Size</dt><dd>{{ size }}</dd></div>
                <div><dt>Project</dt><dd>{{ project || 'No project' }}</dd></div>
                <div><dt>Search</dt><dd>{{ coverage }}</dd></div>
                <div v-if="status"><dt>Storage</dt><dd>{{ status }}</dd></div>
            </dl>
        </div>
    </div>
</template>

<style scoped>
.file-preview { min-width: 0; color: var(--md-on-surface); }
.preview-summary { text-align: center; padding: 24px 16px; border-radius: var(--md-border-radius); background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); }
.preview-icon { display: inline-grid; place-items: center; width: 64px; height: 64px; margin-bottom: 16px; color: var(--md-primary); background: var(--md-surface); border-radius: var(--md-border-radius-small); }
.preview-summary h2 { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; line-height: 1.5; }
.preview-summary p { font-size: 13px; color: var(--md-on-surface-variant); margin-top: 4px; }
.preview-actions { display: flex; gap: 10px; margin: 16px 0 24px; }
.preview-content { font-size: 13px; line-height: 1.7; }
.preview-content pre { white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; max-height: 36dvh; padding: 16px; background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); border-radius: var(--md-border-radius-small); }
.preview-note { color: var(--md-on-surface-variant); margin-bottom: 12px; }
.preview-information { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--md-border-color,var(--md-outline-variant)); }
.preview-information h3 { font-size: 13px; font-weight: 600; margin-bottom: 14px; }
.preview-information dl { display: grid; gap: 12px; font-size: 12px; }
.preview-information dl > div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 12px; }
.preview-information dt { color: var(--md-on-surface-variant); }
.preview-information dd { overflow-wrap: anywhere; }
</style>
