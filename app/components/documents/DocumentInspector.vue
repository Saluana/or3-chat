<template>
    <aside v-theme="'document.inspector'" class="document-inspector" data-context="document" aria-label="Document inspector">
        <header>
            <UTabs
                v-model="activeTab"
                v-theme="'document.inspector-tab'"
                :items="tabs"
                :content="false"
                color="primary"
                variant="link"
                size="xs"
                class="inspector-tabs"
                aria-label="Inspector tabs"
            />
            <UButton v-theme="'document.inspector-close'" :icon="icons.close" color="neutral" variant="ghost" size="sm" square class="close-inspector" aria-label="Close inspector" @click="$emit('close')" />
        </header>

        <div class="inspector-body">
            <section v-if="activeTab === 'outline'" class="outline-panel">
                <div class="outline-heading">
                    <div>
                        <span>Document structure</span>
                        <strong>Outline</strong>
                        <p>Jump between headings and see how this document is organized.</p>
                    </div>
                    <UBadge color="neutral" variant="soft" size="xs">
                        {{ outline.length }} {{ outline.length === 1 ? 'section' : 'sections' }}
                    </UBadge>
                </div>
                <div v-if="outline.length" class="outline-tree" role="tree" aria-label="Document heading hierarchy">
                    <div
                        v-for="(item, index) in outline"
                        :key="item.id"
                        class="outline-node"
                        :class="[`level-${item.level}`, { nested: item.level > 1 }]"
                        :style="{ '--outline-depth': item.level - 1 }"
                    >
                        <UButton
                            v-theme="'document.outline-item'"
                            color="neutral"
                            variant="ghost"
                            class="outline-item h-auto! min-h-14! bg-transparent! px-2.5! py-2!"
                            :class="{ active: item.id === activeOutlineId }"
                            role="treeitem"
                            :aria-level="item.level"
                            :aria-current="item.id === activeOutlineId ? 'location' : undefined"
                            @click="$emit('outline-select', item)"
                        >
                            <span class="outline-marker">{{ index + 1 }}</span>
                            <span class="outline-copy">
                                <strong>{{ item.text }}</strong>
                                <small>H{{ item.level }} · {{ headingLabel(item.level) }}</small>
                            </span>
                            <UIcon :name="icons.chevron" class="outline-chevron" />
                        </UButton>
                    </div>
                </div>
                <div v-else class="empty-panel outline-empty">
                    <span><UIcon :name="icons.outline" /></span>
                    <strong>No headings yet</strong>
                    <p>Add H1–H3 headings to build a navigable outline.</p>
                </div>
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
                <div class="info-heading">
                    <span>Document insights</span>
                    <strong>At a glance</strong>
                    <p>Live details about this document and your reading flow.</p>
                </div>

                <UCard
                    class="info-overview"
                    :ui="{ body: 'p-0! grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch' }"
                >
                    <div class="overview-stat">
                        <span>Words</span>
                        <strong>{{ stats.words.toLocaleString() }}</strong>
                    </div>
                    <div class="overview-divider" />
                    <div class="overview-stat">
                        <span>Reading time</span>
                        <strong>{{ stats.readingMinutes }} <small>min</small></strong>
                    </div>
                </UCard>

                <dl class="info-grid">
                    <div>
                        <dt>Characters</dt>
                        <dd>{{ stats.characters.toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>Blocks</dt>
                        <dd>{{ stats.blocks.toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>Document size</dt>
                        <dd>{{ formatBytes(stats.serializedBytes) }}</dd>
                    </div>
                    <div>
                        <dt>Last saved</dt>
                        <dd>{{ lastSaved }}</dd>
                    </div>
                </dl>

                <div class="info-note">
                    <UIcon :name="icons.info" />
                    <p>Reading time uses 200 words per minute. These insights stay local and are never persisted.</p>
                </div>
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
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue';
import type { Editor } from '@tiptap/core';
import { useIcon } from '~/composables/useIcon';
import type { DocumentOutlineItem, DocumentStats } from '~/composables/documents/useDocumentInsights';
import type { EditorInspectorPanel } from '~/composables/editor/useEditorInspectorPanels';
import type { CompleteDocumentRevision } from '~/db/document-revisions';

const DocumentHistoryPanel = defineAsyncComponent(() => import('./DocumentHistoryPanel.vue'));
const icons = reactive({
    outline: useIcon('editor.outline'),
    history: useIcon('editor.history'),
    info: useIcon('editor.info'),
    plugin: useIcon('editor.plugin'),
    close: useIcon('editor.close'),
    chevron: useIcon('ui.chevron.right'),
});

const props = defineProps<{
    editor: Editor | null;
    documentId: string;
    createCheckpoint: () => Promise<void>;
    outline: readonly DocumentOutlineItem[];
    activeOutlineId?: string;
    stats: DocumentStats;
    savedAt?: number;
    pluginPanels: readonly EditorInspectorPanel[];
    initialTab?: string;
}>();

const emit = defineEmits<{
    close: [];
    'outline-select': [item: DocumentOutlineItem];
    restore: [revision: CompleteDocumentRevision];
    'update:active-tab': [tab: string];
}>();

const activeTab = ref(props.initialTab || 'outline');
watch(() => props.initialTab, (tab) => { if (tab) activeTab.value = tab; });
watch(activeTab, (tab) => emit('update:active-tab', tab));
const tabs = computed(() => [
    { value: 'outline', label: 'Outline', icon: icons.outline },
    { value: 'history', label: 'History', icon: icons.history },
    { value: 'info', label: 'Info', icon: icons.info },
    ...props.pluginPanels.map((panel) => ({
        value: panel.id,
        label: panel.label,
        icon: panel.icon || icons.plugin,
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
function headingLabel(level: number) {
    return level === 1 ? 'Section' : level === 2 ? 'Subsection' : 'Detail';
}
</script>

<style scoped>
.document-inspector { width: 320px; min-width: 320px; height: 100%; display: flex; flex-direction: column; border-inline-start: var(--md-border-width) solid var(--md-border-color); background: color-mix(in oklab, var(--md-surface), transparent 2%); box-shadow: -12px 0 36px rgb(0 0 0 / 4%); }
header { display: flex; align-items: center; min-height: 3.25rem; padding: 0 .55rem; border-bottom: var(--md-border-width) solid var(--md-border-color); }
.inspector-tabs { min-width: 0; flex: 1; overflow-x: auto; scrollbar-width: none; }
.inspector-tabs :deep([role='tablist']) { width: max-content; min-width: 100%; }
.inspector-tabs :deep([role='tab']) { min-width: 3.25rem; min-height: 2.6rem; padding: .25rem .45rem; font-size: .64rem; }
.close-inspector { flex: 0 0 auto; justify-content: center; }
.inspector-body { flex: 1; min-height: 0; overflow-y: auto; padding: 1rem; }
.panel-loading, .empty-panel { min-height: 10rem; display: grid; place-items: center; text-align: center; color: var(--md-on-surface-variant); font-size: .8rem; }
.outline-panel { display: grid; gap: 1rem; }
.outline-heading { display: flex; align-items: start; justify-content: space-between; gap: .75rem; }
.outline-heading > div { min-width: 0; display: grid; gap: .2rem; }
.outline-heading > div > span { color: var(--md-primary); font-size: .62rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.outline-heading strong { font-size: 1.05rem; line-height: 1.25; }
.outline-heading p { margin: 0; color: var(--md-on-surface-variant); font-size: .72rem; line-height: 1.45; }
.outline-heading :deep([data-slot='base']) { flex: 0 0 auto; }
.outline-tree { display: grid; gap: .3rem; }
.outline-node { --outline-depth: 0; position: relative; min-width: 0; padding-inline-start: calc(var(--outline-depth) * .8rem); }
.outline-node.nested::before { content: ''; position: absolute; inset-block: -.3rem; inset-inline-start: calc((var(--outline-depth) * .8rem) - .42rem); width: 1px; background: var(--md-outline-variant); }
.outline-node.nested::after { content: ''; position: absolute; inset-block-start: 50%; inset-inline-start: calc((var(--outline-depth) * .8rem) - .42rem); width: .42rem; height: 1px; background: var(--md-outline-variant); }
.outline-item { position: relative; z-index: 1; width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; justify-content: stretch; gap: .65rem; border: var(--md-border-width) solid transparent; border-radius: var(--md-border-radius); color: var(--md-on-surface); text-align: left; white-space: normal; }
.outline-item:hover { border-color: var(--md-border-color); background: var(--md-surface-container-low) !important; }
.outline-item.active { border-color: color-mix(in oklab, var(--md-primary), var(--md-border-color) 55%); background: color-mix(in oklab, var(--md-primary-container), transparent 66%) !important; box-shadow: 0 0 0 var(--md-border-width) color-mix(in oklab, var(--md-primary), transparent 90%); }
.outline-marker { width: 1.75rem; height: 1.75rem; display: grid; place-items: center; border-radius: var(--md-border-radius); color: var(--md-on-surface-variant); background: var(--md-surface-container); font-size: .68rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.outline-item.active .outline-marker { color: var(--md-primary); background: var(--md-primary-container); }
.outline-copy { min-width: 0; display: grid; gap: .12rem; }
.outline-copy strong { overflow: hidden; font-size: .75rem; font-weight: 630; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.outline-copy small { color: var(--md-on-surface-variant); font-size: .61rem; line-height: 1.3; }
.outline-chevron { width: .8rem; height: .8rem; color: var(--md-on-surface-variant); opacity: .55; }
.outline-empty { align-content: center; gap: .4rem; padding: 1.25rem; border: var(--md-border-width) dashed var(--md-border-color); border-radius: var(--md-border-radius); background: var(--md-surface-container-low); }
.outline-empty > span { width: 2.2rem; height: 2.2rem; display: grid; place-items: center; border-radius: var(--md-border-radius); color: var(--md-on-primary); background: var(--md-primary); }
.outline-empty p { max-width: 13rem; margin: 0; line-height: 1.45; }
.info-panel { display: grid; gap: 1rem; }
.info-heading { display: grid; gap: .2rem; }
.info-heading > span { color: var(--md-primary); font-size: .62rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.info-heading > strong { font-size: 1.05rem; line-height: 1.25; }
.info-heading p { margin: 0; color: var(--md-on-surface-variant); font-size: .72rem; line-height: 1.45; }
.info-overview { overflow: hidden; }
.overview-stat { display: grid; align-content: center; gap: .3rem; min-height: 5.4rem; padding: .85rem; }
.overview-stat span { color: var(--md-on-surface-variant); font-size: .67rem; }
.overview-stat strong { color: var(--md-on-surface); font-size: 1.45rem; font-weight: 680; font-variant-numeric: tabular-nums; line-height: 1; }
.overview-stat small { color: var(--md-on-surface-variant); font-size: .65rem; font-weight: 600; }
.overview-divider { width: 1px; margin-block: .8rem; background: var(--md-outline-variant); }
.info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; margin: 0; }
.info-grid > div { min-width: 0; min-height: 4.5rem; display: grid; align-content: space-between; gap: .5rem; padding: .75rem; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); background: var(--md-surface-container-low); }
.info-grid dt { color: var(--md-on-surface-variant); font-size: .66rem; }
.info-grid dd { min-width: 0; margin: 0; overflow: hidden; color: var(--md-on-surface); font-size: .9rem; font-weight: 650; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
.info-note { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: .55rem; padding: .7rem .75rem; border-radius: var(--md-border-radius); color: var(--md-on-surface-variant); background: color-mix(in oklab, var(--md-primary-container), transparent 68%); }
.info-note svg { width: .9rem; height: .9rem; margin-top: .08rem; color: var(--md-primary); }
.info-note p { margin: 0; font-size: .67rem; line-height: 1.45; }
</style>
