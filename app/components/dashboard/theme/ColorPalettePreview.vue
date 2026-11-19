<script setup lang="ts">
import { nextTick, reactive, ref, useId } from 'vue';
import SidebarRenameEntityModal from '~/components/sidebar/SidebarRenameEntityModal.vue';
import { createSidebarModalProps } from '~/components/sidebar/modalProps';
import { useIcon } from '~/composables/useIcon';
import { useThemeOverrides } from '~/composables/useThemeResolver';

type SampleKind = 'chat' | 'document';

const selected = ref<SampleKind>('chat');
const titles = reactive({ chat: 'Trip notes', document: 'Packing list' });
const rename = ref<{ kind: SampleKind; title: string }>();
const frame = ref<HTMLElement | null>(null);
const id = useId();
const chatIcon = useIcon('sidebar.chat');
const documentIcon = useIcon('sidebar.note');
const moreIcon = useIcon('ui.more');
const editIcon = useIcon('ui.edit');
const checkIcon = useIcon('ui.check');
const attachIcon = useIcon('chat.attach');
const sendIcon = useIcon('chat.send');
const boldIcon = useIcon('editor.format.bold');
const listIcon = useIcon('editor.format.task-list');
const renameModalProps = createSidebarModalProps('sidebar.rename', {
    ui: { footer: 'justify-end' },
});
const bubbleOverrides = useThemeOverrides({
    component: 'div',
    context: 'message',
    identifier: 'message.user-container',
    isNuxtUI: false,
});
const renameActionOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.unified-item.rename',
    isNuxtUI: true,
});

const samples = [
    { kind: 'chat', icon: chatIcon },
    { kind: 'document', icon: documentIcon },
] as const;

function beginRename(kind: SampleKind) {
    selected.value = kind;
    rename.value = { kind, title: titles[kind] };
}

async function closeRename() {
    const kind = rename.value?.kind;
    rename.value = undefined;
    await nextTick();
    document.getElementById(`${id}-${kind}-actions`)?.focus();
}

function saveRename() {
    const draft = rename.value;
    const title = draft?.title.trim();
    if (!draft || !title) return;
    titles[draft.kind] = title;
    void closeRename();
}
</script>

<template>
    <section class="palette-preview" :aria-labelledby="`${id}-heading`">
        <h3 :id="`${id}-heading`" class="preview-heading">Live preview</h3>
        <div ref="frame" class="preview-frame">
            <div class="preview-workspace" :inert="Boolean(rename)">
                <div class="preview-sidebar" role="group" aria-label="Sample items">
                    <div class="preview-brand">
                        <img src="/logos/icon-logo-svg.svg" alt="" width="20" height="20" />
                        or3.chat
                    </div>
                    <div
                        v-for="sample in samples"
                        :key="sample.kind"
                        class="preview-row"
                        :class="{ 'is-selected': selected === sample.kind }"
                    >
                        <UButton
                            :icon="sample.icon.value"
                            :label="titles[sample.kind]"
                            :aria-pressed="selected === sample.kind"
                            :aria-controls="`${id}-content`"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :ui="{ base: 'gap-1.5 px-1.5! max-md:px-1.5!' }"
                            class="preview-item"
                            @click="selected = sample.kind"
                        />
                        <UPopover
                            :content="{ side: 'right', align: 'start', sideOffset: 6, collisionBoundary: frame, collisionPadding: 8, hideWhenDetached: true }"
                        >
                            <UButton
                                :id="`${id}-${sample.kind}-actions`"
                                :aria-label="`Actions for ${titles[sample.kind]}`"
                                :icon="moreIcon"
                                color="neutral"
                                variant="ghost"
                                square
                                size="sm"
                                class="preview-more"
                            />
                            <template #content="{ close }">
                                <div class="or3-action-menu w-56 max-w-[calc(100vw-2rem)] p-1">
                                    <UButton
                                        :icon="editIcon"
                                        color="neutral"
                                        variant="popover"
                                        size="sm"
                                        v-bind="renameActionOverrides"
                                        class="w-full justify-start"
                                        @click="close(); beginRename(sample.kind)"
                                    >Rename</UButton>
                                </div>
                            </template>
                        </UPopover>
                    </div>
                </div>

                <div :id="`${id}-content`" class="preview-pane">
                    <div class="preview-tab">
                        <UIcon :name="selected === 'chat' ? chatIcon : documentIcon" class="size-4 shrink-0" />
                        <span class="truncate">{{ titles[selected] }}</span>
                    </div>
                    <template v-if="selected === 'chat'">
                        <div class="preview-conversation">
                            <p class="preview-bubble cm-user bg-primary text-white dark:text-white/95" :class="bubbleOverrides?.class">What should I pack?</p>
                            <p>A rain jacket and a small daypack.</p>
                        </div>
                        <div class="preview-composer" aria-hidden="true">
                            <UIcon :name="attachIcon" class="size-4 shrink-0" />
                            <span class="min-w-0 flex-1 truncate">Write something…</span>
                            <span class="preview-send">
                                <UIcon :name="sendIcon" class="size-4" />
                            </span>
                        </div>
                    </template>
                    <template v-else>
                        <div class="preview-toolbar" aria-hidden="true">
                            <span>Text</span>
                            <UIcon :name="boldIcon" class="size-4" />
                            <UIcon :name="listIcon" class="size-4" />
                        </div>
                        <div class="preview-document">
                            <h4>{{ titles.document }}</h4>
                            <ul>
                                <li><UIcon :name="checkIcon" class="size-4" /> Rain jacket</li>
                                <li><span class="preview-check" aria-hidden="true" /> Small daypack</li>
                            </ul>
                        </div>
                    </template>
                </div>
            </div>

            <div v-if="rename" class="preview-scrim">
                <!-- Keep this dialog local so the color controls remain available. -->
                <SidebarRenameEntityModal
                    :modal-props="{ ...renameModalProps, contained: true }"
                    :open="true"
                    :title="rename.kind === 'chat' ? 'Rename chat' : 'Rename document'"
                    :placeholder="rename.kind === 'chat' ? 'Chat title' : 'Document title'"
                    :icon="editIcon"
                    v-model:value="rename.title"
                    @update:open="!$event && closeRename()"
                    @submit="saveRename"
                />
            </div>
        </div>
    </section>
</template>

<style scoped>
.palette-preview {
    --preview-divider: var(--md-border-width) solid var(--md-border-color);
    container-type: inline-size;
    min-width: 0;
    color: var(--md-on-surface);
    font-size: 0.8125rem;
}
.preview-heading {
    margin-bottom: 0.45rem;
    font-size: 0.95rem;
    font-weight: 650;
}
.preview-frame {
    position: relative;
    display: grid;
    isolation: isolate;
    aspect-ratio: 1;
    background: var(--md-surface);
    border: var(--preview-divider);
    border-radius: var(--md-border-radius);
}
.preview-workspace,
.preview-pane {
    display: grid;
    min-width: 0;
}
.preview-workspace {
    grid-template-rows: auto 1fr;
    border-radius: inherit;
}
.preview-sidebar {
    min-width: 0;
    padding: 0.4rem;
    background: var(--app-sidebar-bg-color, var(--md-surface-container-lowest));
    border-block-end: var(--preview-divider);
    border-start-start-radius: inherit;
    border-start-end-radius: inherit;
}
.dark .preview-sidebar {
    background: var(--app-sidebar-bg-color, var(--md-surface-container-low));
}
.preview-brand {
    display: none;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.4rem 0.5rem;
    font-weight: 700;
}
.preview-row {
    display: flex;
    align-items: center;
    min-width: 0;
    border-radius: var(--md-border-radius-small);
}
.preview-row:hover {
    background: var(--md-surface-hover);
}
.preview-row.is-selected {
    background: var(--md-surface-active);
}
.preview-row + .preview-row {
    margin-top: 0.1rem;
}
.preview-item {
    flex: 1;
    min-width: 0;
}
.preview-item,
.preview-more {
    font-size: inherit;
}
.preview-row .preview-item {
    justify-content: flex-start;
    color: var(--md-on-surface);
}
.preview-more {
    flex-shrink: 0;
    color: var(--md-on-surface-variant);
}
.preview-pane {
    grid-template-rows: auto 1fr auto;
    align-items: start;
}
.preview-tab,
.preview-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.45rem 0.75rem;
    border-bottom: var(--preview-divider);
}
.preview-tab {
    font-weight: 600;
}
.preview-conversation {
    display: grid;
    gap: 0.45rem;
    padding: 0.45rem 0.75rem;
}
.preview-bubble {
    justify-self: end;
    padding: 0.35rem 0.55rem;
    border-radius: var(--md-border-radius);
}
.preview-composer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    margin: 0 0.65rem 0.55rem;
    padding: 0.18rem 0.25rem 0.18rem 0.55rem;
    color: var(--md-on-surface-variant);
    border: var(--md-border-width) solid var(--md-outline);
    border-radius: var(--md-border-radius-large);
}
.preview-send {
    display: grid;
    width: 1.55rem;
    height: 1.55rem;
    flex-shrink: 0;
    place-items: center;
    color: var(--md-on-primary);
    background: var(--md-primary);
    border-radius: var(--md-border-radius-large);
}
.preview-toolbar {
    grid-row: 2;
    color: var(--md-on-surface-variant);
    background: var(--md-surface-container-lowest);
}
.preview-pane:has(.preview-document) {
    grid-template-rows: auto auto 1fr;
}
.preview-document {
    padding: 0.4rem 0.75rem 0.55rem;
}
.preview-document h4 {
    font-size: 1.15rem;
    font-weight: 700;
    overflow-wrap: anywhere;
}
.preview-document li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.15rem;
}
.preview-check {
    flex: none;
    width: 1rem;
    height: 1rem;
    border: var(--preview-divider);
    border-radius: var(--md-border-radius-small);
}
.preview-scrim {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 0.45rem clamp(0.45rem, 8cqi, 2.5rem);
    background: var(--md-dialog-backdrop);
    border-radius: inherit;
}

@container (min-width: 21rem) {
    .preview-workspace {
        grid-template: 1fr / minmax(6.5rem, 38%) minmax(0, 1fr);
    }
    .preview-sidebar {
        border-block-end: 0;
        border-inline-end: var(--preview-divider);
        border-start-end-radius: 0;
        border-end-start-radius: inherit;
    }
    .preview-brand {
        display: flex;
    }
}
</style>
