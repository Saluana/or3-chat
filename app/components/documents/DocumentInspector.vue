<template>
    <aside class="document-inspector" aria-label="Document inspector">
        <header>
            <nav aria-label="Inspector tabs">
                <button
                    v-for="tab in tabs"
                    :key="tab.id"
                    type="button"
                    :class="{ active: activeTab === tab.id }"
                    :aria-selected="activeTab === tab.id"
                    role="tab"
                    @click="activeTab = tab.id"
                >
                    <UIcon :name="tab.icon" />
                    <span>{{ tab.label }}</span>
                </button>
            </nav>
            <button type="button" class="close-inspector" aria-label="Close inspector" @click="$emit('close')">
                <UIcon name="lucide:x" />
            </button>
        </header>

        <div class="inspector-body">
            <Suspense v-if="activeTab === 'ai'">
                <DocumentAiPanel
                    v-bind="ai"
                    :selection-available="selectionAvailable"
                    :plugin-actions="aiActions"
                    @submit="(prompt, scope) => $emit('ai-submit', prompt, scope)"
                    @estimate="(prompt, scope) => $emit('ai-estimate', prompt, scope)"
                    @accept="$emit('ai-accept')"
                    @reject="$emit('ai-reject')"
                    @abort="$emit('ai-abort')"
                />
                <template #fallback><div class="panel-loading">Loading document agent…</div></template>
            </Suspense>

            <section v-else-if="activeTab === 'outline'" class="outline-panel">
                <div class="panel-heading">
                    <strong>Outline</strong>
                    <span>{{ outline.length }} sections</span>
                </div>
                <div v-if="outline.length" class="outline-list">
                    <button
                        v-for="item in outline"
                        :key="item.id"
                        type="button"
                        :class="{ active: item.id === activeOutlineId }"
                        :style="{ paddingInlineStart: `${.65 + (item.level - 1) * .8}rem` }"
                        @click="$emit('outline-select', item)"
                    >
                        <span>H{{ item.level }}</span>{{ item.text }}
                    </button>
                </div>
                <div v-else class="empty-panel">Add H1–H3 headings to build a live outline.</div>
            </section>

            <Suspense v-else-if="activeTab === 'history'">
                <DocumentHistoryPanel
                    :document-id="documentId"
                    :create-checkpoint="createCheckpoint"
                    @restore="(revision) => $emit('restore', revision)"
                />
                <template #fallback><div class="panel-loading">Loading revision history…</div></template>
            </Suspense>

            <section v-else-if="activeTab === 'info'" class="info-panel">
                <div class="panel-heading"><strong>Document info</strong></div>
                <dl>
                    <div><dt>Words</dt><dd>{{ stats.words.toLocaleString() }}</dd></div>
                    <div><dt>Characters</dt><dd>{{ stats.characters.toLocaleString() }}</dd></div>
                    <div><dt>Blocks</dt><dd>{{ stats.blocks.toLocaleString() }}</dd></div>
                    <div><dt>Reading time</dt><dd>{{ stats.readingMinutes }} min</dd></div>
                    <div><dt>Serialized size</dt><dd>{{ formatBytes(stats.serializedBytes) }}</dd></div>
                    <div><dt>Last saved</dt><dd>{{ lastSaved }}</dd></div>
                </dl>
                <p>Reading time uses a calm 200 words per minute. Outline and stats stay local and are never persisted.</p>
            </section>

            <component
                :is="activePluginPanel.component"
                v-else-if="activePluginPanel"
                :editor="editor"
                :document-id="documentId"
            />
        </div>
    </aside>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import type { Editor } from '@tiptap/core';
import type { DocumentOutlineItem, DocumentStats } from '~/composables/documents/useDocumentInsights';
import type { DocumentAiAction, DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import type { EditorInspectorPanel } from '~/composables/editor/useEditorInspectorPanels';
import type { CompleteDocumentRevision } from '~/db/document-revisions';

const DocumentAiPanel = defineAsyncComponent(() => import('./DocumentAiPanel.vue'));
const DocumentHistoryPanel = defineAsyncComponent(() => import('./DocumentHistoryPanel.vue'));

const props = defineProps<{
    editor: Editor | null;
    documentId: string;
    createCheckpoint: () => Promise<void>;
    outline: readonly DocumentOutlineItem[];
    activeOutlineId?: string;
    stats: DocumentStats;
    savedAt?: number;
    selectionAvailable: boolean;
    aiActions: readonly DocumentAiAction[];
    pluginPanels: readonly EditorInspectorPanel[];
    initialTab?: string;
    ai: {
        status: string;
        error: string;
        tokenEstimate: number;
        proposal: {
            readonly diff: {
                readonly changed: number;
                readonly added: number;
                readonly removed: number;
                readonly entries: readonly {
                    readonly kind: 'added' | 'removed' | 'changed';
                    readonly before?: string;
                    readonly after?: string;
                }[];
            };
        } | null;
        stale: boolean;
    };
}>();

defineEmits<{
    close: [];
    'outline-select': [item: DocumentOutlineItem];
    'ai-submit': [prompt: string, scope: DocumentAiScope];
    'ai-estimate': [prompt: string, scope: DocumentAiScope];
    'ai-accept': [];
    'ai-reject': [];
    'ai-abort': [];
    restore: [revision: CompleteDocumentRevision];
}>();

const activeTab = ref(props.initialTab || 'ai');
watch(() => props.initialTab, (tab) => { if (tab) activeTab.value = tab; });
const tabs = computed(() => [
    { id: 'ai', label: 'AI', icon: 'lucide:sparkles' },
    { id: 'outline', label: 'Outline', icon: 'lucide:list-tree' },
    { id: 'history', label: 'History', icon: 'lucide:history' },
    { id: 'info', label: 'Info', icon: 'lucide:info' },
    ...props.pluginPanels.map((panel) => ({
        id: panel.id,
        label: panel.label,
        icon: panel.icon || 'lucide:puzzle',
    })),
]);
const activePluginPanel = computed(() =>
    props.pluginPanels.find((panel) => panel.id === activeTab.value)
);
const lastSaved = computed(() => props.savedAt
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(props.savedAt * 1000)
    : 'Not saved yet'
);
function formatBytes(bytes: number) {
    if (!bytes) return '—';
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
</script>

<style scoped>
.document-inspector { width: 320px; min-width: 320px; height: 100%; display: flex; flex-direction: column; border-inline-start: 1px solid var(--md-outline-variant); background: color-mix(in oklab, var(--md-surface), transparent 2%); box-shadow: -12px 0 36px rgb(0 0 0 / 4%); }
header { display: flex; align-items: center; min-height: 3.5rem; padding: .45rem .55rem .25rem; border-bottom: 1px solid var(--md-outline-variant); }
nav { min-width: 0; flex: 1; display: flex; overflow-x: auto; scrollbar-width: none; }
nav button { min-width: 3.25rem; min-height: 2.6rem; display: grid; place-items: center; gap: .1rem; padding: .25rem .45rem; border-bottom: 2px solid transparent; color: var(--md-on-surface-variant); font-size: .64rem; }
nav button svg { width: .9rem; height: .9rem; }
nav button.active { color: var(--md-primary); border-color: var(--md-primary); }
.close-inspector { width: 2.5rem; height: 2.5rem; display: grid; place-items: center; border-radius: .6rem; }
.inspector-body { flex: 1; min-height: 0; overflow-y: auto; padding: 1rem; }
.panel-loading, .empty-panel { min-height: 10rem; display: grid; place-items: center; text-align: center; color: var(--md-on-surface-variant); font-size: .8rem; }
.panel-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: .8rem; }
.panel-heading span { color: var(--md-on-surface-variant); font-size: .72rem; }
.outline-list { display: grid; }
.outline-list button { min-height: 2.6rem; display: flex; align-items: center; gap: .55rem; padding: .45rem .6rem; border-radius: .55rem; color: var(--md-on-surface-variant); text-align: left; font-size: .78rem; }
.outline-list button span { min-width: 1.2rem; font-size: .61rem; opacity: .55; }
.outline-list button.active { color: var(--md-primary); background: color-mix(in oklab, var(--md-primary-container), transparent 65%); }
.info-panel dl { display: grid; }
.info-panel dl > div { min-height: 3rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--md-outline-variant); }
.info-panel dt { color: var(--md-on-surface-variant); font-size: .78rem; }
.info-panel dd { font-weight: 620; font-variant-numeric: tabular-nums; }
.info-panel p { color: var(--md-on-surface-variant); font-size: .72rem; line-height: 1.5; }
</style>
