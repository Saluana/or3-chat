<template>
    <div v-theme="'document.editor'" class="document-editor-root" data-context="document">
        <header v-theme="'document.header'" class="editor-topbar">
            <div class="document-identity">
                <UIcon :name="icons.document" />
                <span class="topbar-title">{{ titleDraft || 'Untitled' }}</span>
                <UBadge color="neutral" variant="soft" size="xs" class="save-state" :class="`is-${state.status}`" role="status" aria-live="polite"> <span class="save-dot" />{{ statusText }} </UBadge>
            </div>
            <div class="topbar-actions">
                <UButton v-theme="'document.find'" :icon="icons.search" color="neutral" variant="ghost" size="sm" square aria-label="Find in document" :aria-pressed="findOpen" @click="findOpen = !findOpen" />
                <UButton v-theme="'document.inspector-toggle'" :icon="icons.inspector" color="neutral" variant="ghost" size="sm" square aria-label="Open document inspector" :aria-pressed="inspectorOpen" @click="toggleInspector()" />
            </div>
        </header>

        <div v-theme="'document.toolbar'" class="editor-toolbar document-editor-toolbar" role="toolbar" aria-label="Document formatting">
            <USelect
                :model-value="activeBlock"
                :items="blockTypeItems"
                value-key="value"
                label-key="label"
                size="sm"
                class="block-type-select"
                :content="{ align: 'start', sideOffset: 6 }"
                :ui="{
                    content: 'w-max! min-w-44!',
                    item: 'min-h-9 px-3',
                    itemLabel: 'whitespace-nowrap overflow-visible! text-clip!',
                }"
                aria-label="Text style"
                @update:model-value="setBlockType"
            />
            <span class="toolbar-separator" />
            <ToolbarButton v-for="button in formatButtons" :key="button.id" v-bind="button" :active="button.active?.()" @activate="button.run" />
            <span class="toolbar-separator toolbar-secondary" />
            <ToolbarButton v-for="button in insertButtons" :key="button.id" v-bind="button" class="toolbar-secondary" :active="button.active?.()" @activate="button.run" />
            <span class="toolbar-spacer" />
            <ToolbarButton :icon="icons.undo" label="Undo (⌘Z)" @activate="editor?.chain().focus().undo().run()" />
            <ToolbarButton :icon="icons.redo" label="Redo (⇧⌘Z)" @activate="editor?.chain().focus().redo().run()" />
            <UDropdownMenu v-model:open="overflowOpen" :items="toolbarOverflowItems" :content="{ align: 'end' }">
                <UButton v-theme="'document.toolbar-more'" :icon="icons.more" color="neutral" variant="ghost" size="sm" square class="more-button" aria-label="More editor tools" :aria-expanded="overflowOpen" />
            </UDropdownMenu>
        </div>

        <div v-if="findOpen" v-theme="'document.find-bar'" class="find-bar" role="search">
            <UInput ref="findInput" v-model="findQuery" class="find-input" size="sm" placeholder="Find" aria-label="Find text" @keydown.enter.prevent="findNext" />
            <span>{{ findStatus }}</span>
            <UButton :icon="icons.previous" color="neutral" variant="ghost" size="sm" square aria-label="Previous match" @click="findPrevious" />
            <UButton :icon="icons.next" color="neutral" variant="ghost" size="sm" square aria-label="Next match" @click="findNext" />
            <UInput v-model="replaceQuery" class="find-input" size="sm" placeholder="Replace" aria-label="Replacement text" />
            <UButton color="neutral" variant="soft" size="sm" label="Replace" @click="replaceCurrent" />
            <UButton color="neutral" variant="soft" size="sm" label="All" @click="replaceAll" />
            <UButton :icon="icons.close" color="neutral" variant="ghost" size="sm" square aria-label="Close find" @click="findOpen = false" />
        </div>

        <Transition name="table-toolbar">
            <div v-if="tableActive" v-theme="'document.table-menu'" class="table-toolbar" role="toolbar" aria-label="Table controls">
                <span class="table-toolbar-label"><UIcon :name="icons.table" /> Table</span>
                <span class="toolbar-separator" />
                <UButton color="neutral" variant="ghost" size="xs" label="Row above" @click="addRowBefore" />
                <UButton color="neutral" variant="ghost" size="xs" label="Row below" @click="addRowAfter" />
                <UButton color="neutral" variant="ghost" size="xs" label="Delete row" @click="deleteRow" />
                <span class="toolbar-separator" />
                <UButton color="neutral" variant="ghost" size="xs" label="Column left" @click="addColumnBefore" />
                <UButton color="neutral" variant="ghost" size="xs" label="Column right" @click="addColumnAfter" />
                <UButton color="neutral" variant="ghost" size="xs" label="Delete column" @click="deleteColumn" />
                <span class="toolbar-spacer" />
                <UButton color="error" variant="soft" size="xs" label="Delete table" @click="deleteTable" />
            </div>
        </Transition>

        <div class="editor-layout">
            <main class="editor-scroll" @mousedown="focusCanvas">
                <article v-theme="'document.canvas'" class="document-canvas">
                    <UTextarea :model-value="titleDraft" class="document-title-field" :rows="1" :maxrows="3" autoresize variant="none" maxlength="300" placeholder="Untitled" aria-label="Document title" @update:model-value="onTitleInput" />
                    <p class="document-byline">
                        <span>{{ stats.words.toLocaleString() }} words</span>
                        <span>{{ stats.readingMinutes }} min read</span>
                    </p>

                    <EditorContent v-if="editor" :editor="editor" class="document-content" />

                    <BubbleMenu v-if="editor" v-theme="'document.selection-menu'" :editor="editor" :options="{ placement: 'top' }" class="selection-menu">
                        <UButton :icon="icons.bold" color="neutral" variant="ghost" size="sm" square :class="{ active: editor.isActive('bold') }" aria-label="Bold" @click="editor.chain().focus().toggleBold().run()" />
                        <UButton :icon="icons.italic" color="neutral" variant="ghost" size="sm" square :class="{ active: editor.isActive('italic') }" aria-label="Italic" @click="editor.chain().focus().toggleItalic().run()" />
                        <UButton :icon="icons.underline" color="neutral" variant="ghost" size="sm" square :class="{ active: editor.isActive('underline') }" aria-label="Underline" @click="editor.chain().focus().toggleUnderline().run()" />
                        <UButton :icon="icons.ai" color="primary" variant="ghost" size="sm" square aria-label="Edit selection with AI" @click="openAiForSelection" />
                    </BubbleMenu>

                    <div v-if="slashOpen" ref="slashMenu" v-theme="'document.insert-menu'" class="slash-menu" role="listbox" aria-label="Insert block">
                        <div class="slash-menu-header">
                            <div class="slash-menu-label">Insert</div>
                            <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square aria-label="Close insert menu" @click="closeSlashMenu()" />
                        </div>
                        <UButton v-for="command in filteredSlashCommands" :key="command.id" color="neutral" variant="ghost" class="slash-command" role="option" @click="runSlashCommand(command)">
                            <span class="slash-command-icon"><UIcon :name="command.icon" /></span>
                            <span class="slash-command-copy"
                                ><strong>{{ command.label }}</strong
                                ><small>{{ command.description }}</small></span
                            >
                        </UButton>
                    </div>
                </article>

                <div class="ai-composer-dock">
                    <Suspense>
                        <DocumentAiPanel
                            v-bind="aiPanelState"
                            :document-id="documentId"
                            :selection-available="selectionAvailable"
                            :selected-text="selectedText"
                            :plugin-actions="documentAiActions"
                            :focus-nonce="aiFocusNonce"
                            :autocomplete="autocompleteStatus"
                            @submit="runAi"
                            @estimate="estimateAi"
                            @accept="acceptAi"
                            @accept-hunk="(id) => void ai.acceptHunk(id)"
                            @discard-hunk="ai.discardHunk"
                            @focus-hunk="ai.focusHunk"
                            @focus-next-hunk="ai.focusNextHunk(1)"
                            @focus-prev-hunk="ai.focusNextHunk(-1)"
                            @reject="ai.reject"
                            @abort="ai.abort"
                            @toggle-autocomplete="toggleAutocomplete"
                            @clear-scope-highlight="ai.clearScopeHighlight"
                        />
                        <template #fallback><div class="ai-composer-loading">Loading document AI…</div></template>
                    </Suspense>
                </div>
            </main>

            <Transition name="inspector-backdrop">
                <div v-if="inspectorOpen" class="inspector-backdrop" @click="inspectorOpen = false" />
            </Transition>
            <Transition name="document-inspector">
                <DocumentInspector v-if="inspectorOpen" :editor="editor" :document-id="documentId" :create-checkpoint="createManualCheckpoint" :outline="outline" :active-outline-id="activeOutlineId" :stats="stats" :saved-at="state.record?.updated_at" :plugin-panels="inspectorPanels" :initial-tab="inspectorTab" @close="inspectorOpen = false" @outline-select="scrollTo" @restore="restoreRevision" />
            </Transition>
        </div>

        <input ref="imageInput" class="sr-only" type="file" accept="image/*" multiple @change="onImageInput" />

        <UModal v-model:open="linkDialogOpen" title="Edit link" description="Add a safe web address to the selected text.">
            <template #body>
                <UFormField label="Link URL" :error="linkError">
                    <UInput v-model="linkHref" type="url" placeholder="https://example.com" autofocus @keydown.enter.prevent="applyLink" />
                </UFormField>
            </template>
            <template #footer>
                <div class="link-dialog-actions">
                    <UButton v-if="editor?.isActive('link')" color="error" variant="ghost" label="Remove link" @click="removeLink" />
                    <span />
                    <UButton color="neutral" variant="soft" label="Cancel" @click="linkDialogOpen = false" />
                    <UButton color="primary" label="Apply" @click="applyLink" />
                </div>
            </template>
        </UModal>

        <UModal v-model:open="tableDialogOpen" title="Insert table" description="Choose the starting size. You can add or remove rows and columns later.">
            <template #body>
                <div class="table-dialog-fields">
                    <UFormField label="Rows">
                        <UInput v-model.number="tableRows" type="number" inputmode="numeric" :min="1" :max="20" aria-label="Table rows" />
                    </UFormField>
                    <UFormField label="Columns">
                        <UInput v-model.number="tableColumns" type="number" inputmode="numeric" :min="1" :max="20" aria-label="Table columns" />
                    </UFormField>
                    <USwitch v-model="tableHeaderRow" label="Header row" class="table-header-switch" />
                    <p>Tables can start between 1 × 1 and 20 × 20.</p>
                </div>
            </template>
            <template #footer>
                <div class="table-dialog-actions">
                    <UButton color="neutral" variant="soft" label="Cancel" @click="tableDialogOpen = false" />
                    <UButton color="primary" label="Insert table" @click="insertTable" />
                </div>
            </template>
        </UModal>
    </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, toRef, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { Editor, EditorContent, type JSONContent } from '@tiptap/vue-3';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import ToolbarButton from './ToolbarButton.vue';
import DocumentInspector from './DocumentInspector.vue';
import { useIcon } from '~/composables/useIcon';
import AutocompleteState from '~/plugins/EditorAutocomplete/state';
import { Or3DocumentImage } from '~/extensions/or3-document-image';
import { DocumentAiHunks } from '~/plugins/DocumentAiHunks/TiptapExtension';
import { flush, loadDocument, setDocumentContent, setDocumentTitle, useDocumentState } from '~/composables/documents/useDocumentsStore';
import { registerDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { useDocumentInsights } from '~/composables/documents/useDocumentInsights';
import {
    useDocumentAiAgent,
    type DocumentAiEstimateRequest,
    type DocumentAiSubmission,
} from '~/composables/documents/useDocumentAiAgent';
import { useDocumentAiActions, useEditorInspectorPanels, useEditorToolbarButtons } from '~/composables';
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';
import { listEditorExtensions, listEditorMarks, listEditorNodes } from '~/composables/editor/useEditorNodes';
import { useHooks } from '~/core/hooks/useHooks';
import { createOrRefFile } from '~/db/files';
import { createDocumentRevision, type CompleteDocumentRevision } from '~/db/document-revisions';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import type { EditorToolbarButton } from '~/composables/editor/useEditorToolbar';
import type { TipTapDocument } from '~/types/database';
import { isAllowedDocumentHref } from '~/utils/documents/document-href';

const props = defineProps<{ documentId: string }>();
const DocumentAiPanel = defineAsyncComponent(() => import('./DocumentAiPanel.vue'));
const icons = reactive({
    document: useIcon('editor.document'),
    search: useIcon('editor.search'),
    inspector: useIcon('editor.inspector'),
    more: useIcon('editor.more'),
    close: useIcon('editor.close'),
    previous: useIcon('editor.previous'),
    next: useIcon('editor.next'),
    ai: useIcon('editor.ai'),
    plugin: useIcon('editor.plugin'),
    bold: useIcon('editor.format.bold'),
    italic: useIcon('editor.format.italic'),
    underline: useIcon('editor.format.underline'),
    strike: useIcon('editor.format.strike'),
    link: useIcon('editor.format.link'),
    quote: useIcon('editor.format.quote'),
    bulletList: useIcon('editor.format.bullet-list'),
    orderedList: useIcon('editor.format.ordered-list'),
    taskList: useIcon('editor.format.task-list'),
    text: useIcon('editor.insert.text'),
    heading1: useIcon('editor.insert.heading-1'),
    heading2: useIcon('editor.insert.heading-2'),
    code: useIcon('editor.code'),
    codeBlock: useIcon('editor.insert.code-block'),
    divider: useIcon('editor.insert.divider'),
    table: useIcon('editor.insert.table'),
    image: useIcon('editor.insert.image'),
    undo: useIcon('editor.undo'),
    redo: useIcon('editor.redo'),
});
const documentId = toRef(props, 'documentId');
const hooks = useHooks();
const editor = shallowRef<Editor | null>(null);
const state = computed(() => useDocumentState(props.documentId));
const titleDraft = ref('');
const capturedContent = ref<TipTapDocument>({
    type: 'doc',
    content: [{ type: 'paragraph' }],
});
const contentVersion = ref(0);
const editorStateVersion = ref(0);
const selectionAvailable = ref(false);
const selectedText = ref('');
const inspectorOpen = ref(true);
const inspectorTab = ref('outline');
const aiFocusNonce = ref(0);
const overflowOpen = ref(false);
const slashMenu = ref<HTMLElement>();
const imageInput = ref<HTMLInputElement>();
const findInput = ref<{ inputRef?: HTMLInputElement | null }>();
const findOpen = ref(false);
const findQuery = ref('');
const replaceQuery = ref('');
const findIndex = ref(-1);
const slashOpen = ref(false);
const slashQuery = ref('');
const slashDismissed = ref(false);
const linkDialogOpen = ref(false);
const linkHref = ref('');
const linkError = ref('');
const tableDialogOpen = ref(false);
const tableRows = ref(3);
const tableColumns = ref(3);
const tableHeaderRow = ref(true);
let didUnmount = false;
let captureTimer: ReturnType<typeof setTimeout> | undefined;
let revisionTimer: ReturnType<typeof setTimeout> | undefined;
let unregisterSession: (() => void) | undefined;
let lastAutomaticRevisionAt = 0;

const pluginButtons = useEditorToolbarButtons(editor);
const inspectorPanels = useEditorInspectorPanels();
const documentAiActions = useDocumentAiActions();
const { outline, activeOutlineId, stats, scrollTo, setSerializedSize, refresh } = useDocumentInsights(editor);

async function captureCurrent(flushNow = false) {
    const current = editor.value;
    if (!current || current.isDestroyed) return;
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = undefined;
    const json = current.getJSON();
    capturedContent.value = json;
    setSerializedSize(new TextEncoder().encode(JSON.stringify(json)).byteLength);
    setDocumentContent(props.documentId, json);
    if (flushNow) await flush(props.documentId);
}

const ai = useDocumentAiAgent({
    editor,
    documentId,
    title: titleDraft,
    contentVersion,
    persistCurrent: () => captureCurrent(true),
});

const aiPanelState = computed(() => ({
    status: ai.status.value,
    error: ai.error.value,
    tokenEstimate: ai.tokenEstimate.value,
    proposal: ai.proposal.value,
    stale: ai.stale.value,
    accepting: ai.accepting.value,
    agentStatus: ai.agentStatus.value,
    pendingHunkCount: ai.pendingHunkCount.value,
    focusedHunkId: ai.focusedHunkId.value,
}));
const autocompleteStatus = computed(() => ({
    enabled: AutocompleteState.value.isEnabled,
    loading: AutocompleteState.value.isLoading,
    error: AutocompleteState.value.lastError,
}));

onClickOutside(slashMenu, () => closeSlashMenu(false));

function emptyDocument(): TipTapDocument {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function normalizedContent(value: unknown): TipTapDocument {
    if (!value || typeof value !== 'object') return emptyDocument();
    const content = value as JSONContent;
    if (content.type !== 'doc' || !content.content?.length) return emptyDocument();
    return content as TipTapDocument;
}

function scheduleCapture() {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
        void captureCurrent(true);
    }, 750);
}

function scheduleAutomaticRevision() {
    if (revisionTimer) clearTimeout(revisionTimer);
    const fiveMinutes = 5 * 60 * 1000;
    const earliest = lastAutomaticRevisionAt ? Math.max(30_000, lastAutomaticRevisionAt + fiveMinutes - Date.now()) : 30_000;
    revisionTimer = setTimeout(async () => {
        const current = editor.value;
        if (!current || didUnmount) return;
        await captureCurrent(true);
        const created = await createDocumentRevision({
            documentId: props.documentId,
            title: titleDraft.value,
            content: current.getJSON(),
            source: 'auto',
        }).catch(() => null);
        if (created) lastAutomaticRevisionAt = Date.now();
    }, earliest);
}

function updateSlashMenu() {
    const current = editor.value;
    if (!current) return;
    const parent = current.state.selection.$from.parent;
    const text = parent.isTextblock ? parent.textContent : '';
    const match = /^\/([^\s]*)$/u.exec(text);
    if (!match) slashDismissed.value = false;
    slashOpen.value = Boolean(match) && !slashDismissed.value;
    slashQuery.value = match?.[1]?.toLowerCase() ?? '';
}

function updateSelectionContext() {
    const current = editor.value;
    if (!current) return;
    const { from, to, empty } = current.state.selection;
    selectionAvailable.value = !empty;
    selectedText.value = empty ? '' : current.state.doc.textBetween(from, to, ' ', ' ').trim();
    // Refresh caret-relative scope chrome only while the composer has it active.
    ai.syncScopeHighlight(undefined, 'refresh');
}

function onEditorUpdate(payload?: { transaction?: { docChanged?: boolean } }) {
    // Ignore soft updates (e.g. TipTap setEditable) that do not change the doc.
    if (payload?.transaction && payload.transaction.docChanged === false) return;
    contentVersion.value += 1;
    editorStateVersion.value += 1;
    updateSelectionContext();
    scheduleCapture();
    scheduleAutomaticRevision();
    updateSlashMenu();
    hooks.doActionSync('editor.updated:action:after', { editor: editor.value });
}

async function insertFiles(files: File[]) {
    const current = editor.value;
    if (!current) return;
    for (const file of files.filter((item) => item.type.startsWith('image/'))) {
        const stored = await createOrRefFile(file, file.name || 'Document image');
        current
            .chain()
            .focus()
            .insertContent({
                type: 'or3Image',
                attrs: {
                    hash: stored.hash,
                    alt: file.name.replace(/\.[^.]+$/u, ''),
                    width: 100,
                },
            })
            .run();
    }
}

async function makeEditor() {
    const loaded = await loadEditorExtensions(listEditorNodes(), listEditorMarks(), listEditorExtensions());
    if (didUnmount) return;
    editor.value?.destroy();
    editor.value = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
            TaskList,
            TaskItem.configure({ nested: true }),
            TableKit.configure({ table: { resizable: true } }),
            Or3DocumentImage,
            DocumentAiHunks,
            Placeholder.configure({
                placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : "Write, or press '/' for commands…"),
                showOnlyCurrent: true,
            }),
            ...loaded.extensions,
            ...loaded.nodes,
            ...loaded.marks,
        ],
        content: capturedContent.value,
        autofocus: false,
        editorProps: {
            attributes: {
                role: 'textbox',
                'aria-label': 'Document body',
                'aria-multiline': 'true',
            },
            handlePaste: (_view, event) => {
                const files = [...(event.clipboardData?.files ?? [])];
                if (!files.some((file) => file.type.startsWith('image/'))) return false;
                void insertFiles(files);
                return true;
            },
            handleDrop: (_view, event) => {
                const files = [...(event.dataTransfer?.files ?? [])];
                if (!files.some((file) => file.type.startsWith('image/'))) return false;
                event.preventDefault();
                void insertFiles(files);
                return true;
            },
            handleKeyDown: (_view, event) => {
                if (event.key !== 'Escape') return false;
                if (slashOpen.value) {
                    closeSlashMenu();
                    return true;
                }
                if (overflowOpen.value) {
                    overflowOpen.value = false;
                    return true;
                }
                return false;
            },
        },
        onUpdate: onEditorUpdate,
        onSelectionUpdate: () => {
            editorStateVersion.value += 1;
            updateSelectionContext();
            refresh();
            updateSlashMenu();
        },
    });
    hooks.doActionSync('editor.created:action:after', { editor: editor.value });
    updateSelectionContext();
    refresh();
}

async function loadActiveDocument(id: string) {
    await loadDocument(id);
    if (didUnmount || props.documentId !== id) return;
    titleDraft.value = state.value.record?.title ?? '';
    capturedContent.value = normalizedContent(state.value.record?.content);
    contentVersion.value = 0;
    await makeEditor();
    unregisterSession?.();
    unregisterSession = registerDocumentEditorSession(id, {
        capture: () => captureCurrent(false),
    });
}

watch(documentId, async (id, previous) => {
    if (previous && editor.value) await captureCurrent(true);
    ai.reset();
    await loadActiveDocument(id);
});

watch(
    () => state.value.record?.title,
    (title) => {
        if (typeof title === 'string' && state.value.pendingTitle === undefined && title !== titleDraft.value) {
            titleDraft.value = title;
        }
    },
);

watch(findOpen, async (open) => {
    if (open) {
        await nextTick();
        findInput.value?.inputRef?.focus();
    }
});

watch(findQuery, () => {
    findIndex.value = -1;
});

onMounted(() => {
    void loadActiveDocument(props.documentId);
});
onBeforeUnmount(() => {
    didUnmount = true;
    ai.abort();
    unregisterSession?.();
    if (captureTimer) clearTimeout(captureTimer);
    if (revisionTimer) clearTimeout(revisionTimer);
    const pending = captureCurrent(true);
    editor.value?.destroy();
    void pending;
});

function onTitleInput(value: string | number | null) {
    titleDraft.value = String(value ?? '');
    setDocumentTitle(props.documentId, titleDraft.value);
}

const statusText = computed(() => (state.value.status === 'loading' ? 'Loading' : state.value.status === 'saving' ? 'Saving' : state.value.status === 'error' ? 'Save failed' : state.value.status === 'saved' ? 'Saved' : 'Ready'));

const activeBlock = computed(() => {
    if (editor.value?.isActive('heading', { level: 1 })) return 'heading-1';
    if (editor.value?.isActive('heading', { level: 2 })) return 'heading-2';
    if (editor.value?.isActive('heading', { level: 3 })) return 'heading-3';
    return 'paragraph';
});
const tableActive = computed(() => {
    void editorStateVersion.value;
    return editor.value?.isActive('table') ?? false;
});
const blockTypeItems = [
    { label: 'Text', value: 'paragraph' },
    { label: 'Heading 1', value: 'heading-1' },
    { label: 'Heading 2', value: 'heading-2' },
    { label: 'Heading 3', value: 'heading-3' },
];

function setBlockType(value: string) {
    const chain = editor.value?.chain().focus();
    if (!chain) return;
    if (value === 'paragraph') chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(value.slice(-1)) as 1 | 2 | 3 }).run();
}

type ToolbarItem = {
    id: string;
    icon?: string;
    text?: string;
    label: string;
    active?: () => boolean;
    run: () => void;
};
const formatButtons = computed<ToolbarItem[]>(() => [
    {
        id: 'bold',
        icon: icons.bold,
        label: 'Bold (⌘B)',
        active: () => editor.value?.isActive('bold') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleBold().run();
        },
    },
    {
        id: 'italic',
        icon: icons.italic,
        label: 'Italic (⌘I)',
        active: () => editor.value?.isActive('italic') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleItalic().run();
        },
    },
    {
        id: 'underline',
        icon: icons.underline,
        label: 'Underline (⌘U)',
        active: () => editor.value?.isActive('underline') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleUnderline().run();
        },
    },
    {
        id: 'strike',
        icon: icons.strike,
        label: 'Strikethrough',
        active: () => editor.value?.isActive('strike') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleStrike().run();
        },
    },
    {
        id: 'code',
        icon: icons.code,
        label: 'Inline code',
        active: () => editor.value?.isActive('code') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleCode().run();
        },
    },
    {
        id: 'link',
        icon: icons.link,
        label: 'Link',
        active: () => editor.value?.isActive('link') ?? false,
        run: editLink,
    },
]);
const insertButtons = computed<ToolbarItem[]>(() => [
    {
        id: 'bullet',
        icon: icons.bulletList,
        label: 'Bullet list',
        active: () => editor.value?.isActive('bulletList') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleBulletList().run();
        },
    },
    {
        id: 'ordered',
        icon: icons.orderedList,
        label: 'Numbered list',
        active: () => editor.value?.isActive('orderedList') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleOrderedList().run();
        },
    },
    {
        id: 'tasks',
        icon: icons.taskList,
        label: 'Task list',
        active: () => editor.value?.isActive('taskList') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleTaskList().run();
        },
    },
    {
        id: 'quote',
        icon: icons.quote,
        label: 'Quote',
        active: () => editor.value?.isActive('blockquote') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleBlockquote().run();
        },
    },
]);
const overflowButtons = computed<ToolbarItem[]>(() => [
    {
        id: 'codeblock',
        icon: icons.codeBlock,
        label: 'Code block',
        run: () => {
            editor.value?.chain().focus().toggleCodeBlock().run();
        },
    },
    {
        id: 'divider',
        icon: icons.divider,
        label: 'Divider',
        run: () => {
            editor.value?.chain().focus().setHorizontalRule().run();
        },
    },
    { id: 'table', icon: icons.table, label: 'Table', run: openTableDialog },
    {
        id: 'image',
        icon: icons.image,
        label: 'Image',
        run: () => imageInput.value?.click(),
    },
]);
const toolbarOverflowItems = computed(() => [
    overflowButtons.value.map((button) => ({
        label: button.label,
        icon: button.icon || icons.plugin,
        onSelect: () => button.run(),
    })),
    ...(pluginButtons.value.length
        ? [
              pluginButtons.value.map((button) => ({
                  label: button.tooltip || button.id,
                  icon: button.icon || icons.plugin,
                  onSelect: () => handlePluginButton(button),
              })),
          ]
        : []),
]);

function handlePluginButton(button: EditorToolbarButton) {
    if (editor.value) void button.onClick(editor.value);
}

function editLink() {
    const current = editor.value;
    if (!current) return;
    linkHref.value = (current.getAttributes('link').href as string | undefined) || 'https://';
    linkError.value = '';
    linkDialogOpen.value = true;
}

function applyLink() {
    const current = editor.value;
    if (!current) return;
    const href = linkHref.value.trim();
    if (!href) {
        removeLink();
        return;
    }
    if (!isAllowedDocumentHref(href)) {
        linkError.value = 'Use an http, https, mailto, or relative link.';
        return;
    }
    current.chain().focus().extendMarkRange('link').setLink({ href }).run();
    linkDialogOpen.value = false;
}

function removeLink() {
    editor.value?.chain().focus().extendMarkRange('link').unsetLink().run();
    linkDialogOpen.value = false;
}

function normalizeTableDimension(value: number) {
    const numericValue = Number(value);
    const finiteValue = Number.isFinite(numericValue) ? Math.round(numericValue) : 3;
    return Math.min(20, Math.max(1, finiteValue));
}

function openTableDialog() {
    tableRows.value = 3;
    tableColumns.value = 3;
    tableHeaderRow.value = true;
    tableDialogOpen.value = true;
}

function insertTable() {
    const rows = normalizeTableDimension(tableRows.value);
    const cols = normalizeTableDimension(tableColumns.value);
    tableRows.value = rows;
    tableColumns.value = cols;
    editor.value?.chain().focus().insertTable({ rows, cols, withHeaderRow: tableHeaderRow.value }).run();
    tableDialogOpen.value = false;
    editorStateVersion.value += 1;
}

function addRowBefore() {
    editor.value?.chain().focus().addRowBefore().run();
}
function addRowAfter() {
    editor.value?.chain().focus().addRowAfter().run();
}
function deleteRow() {
    editor.value?.chain().focus().deleteRow().run();
}
function addColumnBefore() {
    editor.value?.chain().focus().addColumnBefore().run();
}
function addColumnAfter() {
    editor.value?.chain().focus().addColumnAfter().run();
}
function deleteColumn() {
    editor.value?.chain().focus().deleteColumn().run();
}
function deleteTable() {
    editor.value?.chain().focus().deleteTable().run();
    editorStateVersion.value += 1;
}

function onImageInput(event: Event) {
    const input = event.target as HTMLInputElement;
    void insertFiles([...(input.files ?? [])]);
    input.value = '';
}

const slashCommands = computed(() => [
    {
        id: 'text',
        label: 'Text',
        description: 'Plain paragraph',
        icon: icons.text,
        run: () => editor.value?.chain().focus().setParagraph().run(),
    },
    {
        id: 'h1',
        label: 'Heading 1',
        description: 'Large section heading',
        icon: icons.heading1,
        run: () => editor.value?.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
        id: 'h2',
        label: 'Heading 2',
        description: 'Medium section heading',
        icon: icons.heading2,
        run: () => editor.value?.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
        id: 'task',
        label: 'Task list',
        description: 'Track action items',
        icon: icons.taskList,
        run: () => editor.value?.chain().focus().toggleTaskList().run(),
    },
    {
        id: 'bullet',
        label: 'Bullet list',
        description: 'Create a simple list',
        icon: icons.bulletList,
        run: () => editor.value?.chain().focus().toggleBulletList().run(),
    },
    {
        id: 'quote',
        label: 'Quote',
        description: 'Emphasize a passage',
        icon: icons.quote,
        run: () => editor.value?.chain().focus().toggleBlockquote().run(),
    },
    {
        id: 'code',
        label: 'Code block',
        description: 'Write formatted code',
        icon: icons.codeBlock,
        run: () => editor.value?.chain().focus().toggleCodeBlock().run(),
    },
    {
        id: 'table',
        label: 'Table',
        description: 'Insert a custom-size table',
        icon: icons.table,
        run: openTableDialog,
    },
    {
        id: 'image',
        label: 'Image',
        description: 'Upload an offline-first image',
        icon: icons.image,
        run: () => imageInput.value?.click(),
    },
    {
        id: 'divider',
        label: 'Divider',
        description: 'Separate sections',
        icon: icons.divider,
        run: () => editor.value?.chain().focus().setHorizontalRule().run(),
    },
]);
const filteredSlashCommands = computed(() => slashCommands.value.filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(slashQuery.value)).slice(0, 8));

function runSlashCommand(command: (typeof slashCommands.value)[number]) {
    const current = editor.value;
    if (!current) return;
    const from = current.state.selection.from - slashQuery.value.length - 1;
    current.chain().focus().deleteRange({ from, to: current.state.selection.from }).run();
    command.run();
    slashOpen.value = false;
    slashDismissed.value = false;
}

function closeSlashMenu(restoreFocus = true) {
    slashDismissed.value = true;
    slashOpen.value = false;
    if (restoreFocus) editor.value?.commands.focus();
}

function matches() {
    const current = editor.value;
    const needle = findQuery.value.toLocaleLowerCase();
    if (!current || !needle) return [] as Array<{ from: number; to: number }>;
    const results: Array<{ from: number; to: number }> = [];
    current.state.doc.descendants((node, position) => {
        if (!node.isText || !node.text) return;
        const haystack = node.text.toLocaleLowerCase();
        let index = haystack.indexOf(needle);
        while (index >= 0) {
            results.push({
                from: position + index,
                to: position + index + needle.length,
            });
            index = haystack.indexOf(needle, index + Math.max(1, needle.length));
        }
    });
    return results;
}
const findStatus = computed(() => {
    const count = matches().length;
    return count ? `${Math.max(1, findIndex.value + 1)} / ${count}` : 'No results';
});
function selectMatch(index: number) {
    const results = matches();
    if (!results.length) return;
    findIndex.value = (index + results.length) % results.length;
    editor.value?.chain().focus().setTextSelection(results[findIndex.value]!).scrollIntoView().run();
}
function findNext() {
    selectMatch(findIndex.value + 1);
}
function findPrevious() {
    selectMatch(findIndex.value - 1);
}
function replaceCurrent() {
    const current = editor.value;
    const match = matches()[findIndex.value];
    if (!current || !match) return;
    current.chain().focus().insertContentAt(match, replaceQuery.value).run();
    findIndex.value -= 1;
    findNext();
}
function replaceAll() {
    const current = editor.value;
    if (!current) return;
    const tr = current.state.tr;
    for (const match of matches().reverse()) tr.insertText(replaceQuery.value, match.from, match.to);
    current.view.dispatch(tr);
    findIndex.value = -1;
}

function focusCanvas(event: MouseEvent) {
    if (event.target === event.currentTarget) editor.value?.commands.focus('end');
}

function toggleInspector(tab = inspectorTab.value) {
    inspectorTab.value = tab;
    inspectorOpen.value = !inspectorOpen.value;
}

function openAiForSelection() {
    aiFocusNonce.value += 1;
}

function toggleAutocomplete() {
    AutocompleteState.value.isEnabled = !AutocompleteState.value.isEnabled;
    if (AutocompleteState.value.isEnabled) AutocompleteState.value.lastError = null;
    editor.value?.commands.focus();
}

async function runAi(payload: DocumentAiSubmission) {
    try {
        await ai.submit(payload);
    } catch (caught) {
        console.error('[DocumentAI] submit failed', caught);
    }
}
async function estimateAi(payload: DocumentAiEstimateRequest) {
    await ai.estimate(payload).catch(() => 0);
}
async function acceptAi() {
    try {
        await ai.accept();
    } catch (caught) {
        console.error('[DocumentAI] accept failed', caught);
    }
}

async function restoreRevision(revision: CompleteDocumentRevision) {
    const current = editor.value;
    if (!current) return;
    await createDocumentRevision({
        documentId: props.documentId,
        title: titleDraft.value,
        content: current.getJSON(),
        source: 'restore',
    });
    current.schema.nodeFromJSON(revision.snapshot.content);
    titleDraft.value = revision.snapshot.title;
    setDocumentTitle(props.documentId, titleDraft.value);
    current.commands.setContent(revision.snapshot.content, {
        emitUpdate: true,
        errorOnInvalidContent: true,
    });
    await captureCurrent(true);
}

async function createManualCheckpoint() {
    const current = editor.value;
    if (!current) return;
    await createDocumentRevision({
        documentId: props.documentId,
        title: titleDraft.value,
        content: current.getJSON(),
        source: 'manual',
    });
}
</script>


<style scoped>
.document-editor-root { --editor-canvas: 780px; position: relative; container-type: inline-size; height: 100%; width: 100%; display: flex; flex-direction: column; overflow: hidden; color: var(--md-on-surface); background: var(--md-surface); font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); }

.editor-topbar { height: 46px; min-height: 46px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; padding-block: 0.25rem; padding-inline-start: calc(var(--or3-pane-chrome-left-clearance, 0px) + 0.7rem); padding-inline-end: calc(var(--or3-pane-chrome-right-clearance, 0px) + 0.55rem); border-bottom: var(--md-border-width) solid var(--md-border-color); background: color-mix(in oklab, var(--md-surface), transparent 3%); }
.document-identity, .save-state, .topbar-actions { display: flex; align-items: center; gap: 0.45rem; }
.document-identity { min-width: 0; color: var(--md-on-surface-variant); }
.document-identity > svg { width: 1.15rem; height: 1.15rem; flex: 0 0 auto; }
.topbar-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem; font-weight: 600; }
.save-state { flex: 0 0 auto; margin-inline-start: 0.35rem; padding: 0.2rem 0.45rem; border-radius: var(--md-border-radius); color: var(--md-on-surface-variant); background: var(--md-surface-container-low); font-size: 0.65rem; }
.save-dot { width: 0.42rem; height: 0.42rem; border-radius: 50%; background: var(--md-primary); }
.save-state.is-saving .save-dot { animation: save-pulse 1s infinite; }
.save-state.is-error { color: var(--md-error); }
.save-state.is-error .save-dot { background: var(--md-error); }
.topbar-actions { justify-content: flex-end; }
.topbar-actions button, .more-button { width: 2.35rem; height: 2.35rem; display: grid; place-items: center; border-radius: var(--md-border-radius); color: var(--md-on-surface-variant); }
.topbar-actions button svg, .more-button svg { width: 1.2rem; height: 1.2rem; }
.topbar-actions button:hover, .more-button:hover { background: var(--md-surface-container); color: var(--md-on-surface); }

.editor-toolbar { position: relative; z-index: 10; min-height: 3.35rem; display: flex; align-items: center; gap: 0.15rem; padding: 0.4rem max(0.65rem, calc((100% - var(--editor-canvas)) / 2)); border-bottom: var(--md-border-width) solid var(--md-border-color); background: color-mix(in oklab, var(--md-surface), transparent 2%); box-shadow: 0 5px 18px rgb(0 0 0 / 3%); }
.block-type-select { width: 7rem; flex: 0 0 auto; }
.toolbar-separator { width: 1px; height: 1.35rem; margin: 0 0.35rem; background: var(--md-outline-variant); }
.toolbar-spacer { flex: 1; }
.toolbar-overflow { position: absolute; z-index: 30; top: calc(100% + 0.35rem); right: 0.75rem; width: 13rem; display: grid; padding: 0.4rem; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); background: var(--md-surface); box-shadow: 0 12px 38px rgb(0 0 0 / 16%); }
.toolbar-overflow button { min-height: 2.5rem; display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.6rem; border-radius: var(--md-border-radius); text-align: left; font-size: 0.78rem; }
.toolbar-overflow button:hover { background: var(--md-surface-container); }

.find-bar { z-index: 9; display: flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.75rem; border-bottom: var(--md-border-width) solid var(--md-border-color); background: var(--md-surface-container-low); }
.find-input { width: min(12rem, 24vw); flex: 0 0 auto; }
.find-bar span { min-width: 4.2rem; color: var(--md-on-surface-variant); font-size: 0.7rem; text-align: center; }
.find-bar button { min-width: 2.25rem; min-height: 2.25rem; padding: 0.35rem; border-radius: var(--md-border-radius); font-size: 0.72rem; }
.find-bar button:hover { background: var(--md-surface-container); }
.table-toolbar { z-index: 9; min-height: 2.85rem; display: flex; align-items: center; gap: 0.2rem; overflow-x: auto; padding: 0.35rem max(0.65rem, calc((100% - var(--editor-canvas)) / 2)); border-bottom: var(--md-border-width) solid var(--md-border-color); background: color-mix(in oklab, var(--md-primary-container), var(--md-surface) 86%); scrollbar-width: thin; }
.table-toolbar-label { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 0.4rem; padding-inline: 0.35rem; color: var(--md-on-surface-variant); font-size: 0.69rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.table-toolbar-label svg { width: 1rem; height: 1rem; color: var(--md-primary); }
.table-toolbar button { flex: 0 0 auto; min-height: 2.05rem; border-radius: var(--md-border-radius); }
.table-toolbar-enter-active, .table-toolbar-leave-active { overflow: hidden; transition: max-height 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 160ms ease, transform 220ms cubic-bezier(0.4, 0, 0.2, 1), padding-block 220ms ease; }
.table-toolbar-enter-from, .table-toolbar-leave-to { max-height: 0; padding-block: 0; opacity: 0; transform: translateY(-0.35rem); }
.table-toolbar-enter-to, .table-toolbar-leave-from { max-height: 3.2rem; opacity: 1; transform: translateY(0); }

.editor-layout { position: relative; flex: 1; min-height: 0; display: flex; }
.editor-scroll { position: relative; flex: 1; min-width: 0; overflow-y: auto; scroll-behavior: smooth; }
.document-canvas { position: relative; width: min(var(--editor-canvas), calc(100% - 3rem)); min-height: 100%; margin: 0 auto; padding: clamp(2.5rem, 7cqw, 5.5rem) 0 12rem; }
.document-title-field { width: 100%; }
.document-title-field :deep(textarea) { display: block; width: 100%; min-height: 1.2em; resize: none; overflow: hidden; border: 0; padding: 0; background: transparent; color: var(--md-on-surface); font-family: var(--font-heading, var(--font-sans, ui-sans-serif, system-ui, sans-serif)); font-size: clamp(2rem, 5cqw, 3rem); font-weight: 720; letter-spacing: -0.035em; line-height: 1.08; outline: none; box-shadow: none; }
.document-title-field :deep(textarea::placeholder) { color: color-mix(in oklab, var(--md-on-surface-variant), transparent 55%); }
.document-byline { display: flex; gap: 0.8rem; margin: 0.85rem 0 3rem; color: var(--md-on-surface-variant); font-size: 0.72rem; }

.document-content { font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); font-size: 1rem; line-height: 1.72; }
.document-content :deep(.ProseMirror) { min-height: 55vh; outline: none; caret-color: var(--md-primary); }
.document-content :deep(.ProseMirror > *) { margin-block: 0 1rem; }
.document-content :deep(.document-ai-hunk) { box-sizing: border-box; width: 100%; max-width: 100%; }
.document-content :deep(h1) { margin-top: 2.4rem; font-family: var(--font-heading, inherit); font-size: 1.9rem; letter-spacing: -0.025em; line-height: 1.2; }
.document-content :deep(h2) { margin-top: 2.15rem; font-family: var(--font-heading, inherit); font-size: 1.5rem; letter-spacing: -0.018em; line-height: 1.25; }
.document-content :deep(h3) { margin-top: 1.8rem; font-family: var(--font-heading, inherit); font-size: 1.2rem; line-height: 1.3; }
.document-content :deep(a) { color: var(--md-primary); text-decoration: underline; text-underline-offset: 0.15em; }
.document-content :deep(blockquote) { margin-inline: 0; padding: 0.25rem 0 0.25rem 1rem; border-inline-start: 3px solid var(--md-primary); color: var(--md-on-surface-variant); }
.document-content :deep(pre) { overflow-x: auto; padding: 1rem 1.1rem; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); background: var(--md-surface-container-low); }
.document-content :deep(code:not(pre code)) { padding: 0.12rem 0.3rem; border-radius: var(--md-border-radius); background: var(--md-surface-container); font-size: 0.88em; }
.document-content :deep(hr) { margin: 2.5rem 0; border: 0; border-top: var(--md-border-width) solid var(--md-border-color); }
.document-content :deep(ul), .document-content :deep(ol) { padding-inline-start: 1.5rem; }
.document-content :deep(ul[data-type='taskList']) { padding: 0; list-style: none; }
.document-content :deep(ul[data-type='taskList'] li) { display: flex; gap: 0.6rem; align-items: flex-start; }
.document-content :deep(ul[data-type='taskList'] label) { margin-top: 0.28rem; }
.document-content :deep(.tableWrapper) { width: min(1040px, calc(100cqw - 3rem)); margin: 1.75rem 50%; transform: translateX(-50%); overflow-x: auto; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); }
.document-content :deep(table) { width: 100%; min-width: 38rem; border-collapse: collapse; table-layout: fixed; }
.document-content :deep(th), .document-content :deep(td) { min-width: 7rem; padding: 0.55rem 0.65rem; border-inline-end: var(--md-border-width) solid var(--md-border-color); border-bottom: var(--md-border-width) solid var(--md-border-color); vertical-align: top; }
.document-content :deep(th) { background: var(--md-surface-container-low); text-align: left; font-size: 0.75rem; }
.document-content :deep(.selectedCell::after) { background: color-mix(in oklab, var(--md-primary), transparent 86%); }
.document-content :deep(p.is-editor-empty:first-child::before), .document-content :deep(.is-empty::before) { float: left; height: 0; color: color-mix(in oklab, var(--md-on-surface-variant), transparent 45%); content: attr(data-placeholder); pointer-events: none; }

.selection-menu { display: flex; gap: 0.12rem; padding: 0.3rem; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); background: var(--md-surface); box-shadow: 0 10px 30px rgb(0 0 0 / 16%); }
.selection-menu button { width: 2.25rem; height: 2.25rem; display: grid; place-items: center; border-radius: var(--md-border-radius); }
.selection-menu button:hover, .selection-menu button.active { color: var(--md-primary); background: var(--md-primary-container); }
.slash-menu { position: sticky; z-index: 20; bottom: 1.5rem; width: min(21rem, calc(100vw - 2rem)); max-height: 25rem; overflow-y: auto; margin: 1rem 0; padding: 0.4rem; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); background: var(--md-surface); box-shadow: 0 18px 50px rgb(0 0 0 / 18%); }
.slash-menu-header { position: sticky; z-index: 1; top: -0.4rem; display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0.2rem 0.2rem; background: var(--md-surface); }
.slash-menu-label { padding: 0.3rem 0.45rem; color: var(--md-on-surface-variant); font-size: 0.65rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.slash-menu .slash-menu-header button { width: 2rem; min-height: 2rem; display: grid; grid-template-columns: 1fr; place-items: center; gap: 0; padding: 0; border-radius: var(--md-border-radius); }
.slash-command { width: 100%; min-height: 3.25rem; justify-content: flex-start; border-radius: var(--md-border-radius); }
.slash-command-icon { width: 2rem; height: 2rem; flex: 0 0 auto; display: grid; place-items: center; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); }
.slash-command-copy { min-width: 0; display: grid; text-align: left; }
.slash-menu small { color: var(--md-on-surface-variant); font-size: 0.67rem; }
.link-dialog-actions { width: 100%; display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 0.5rem; }
.table-dialog-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.table-header-switch, .table-dialog-fields > p { grid-column: 1 / -1; }
.table-dialog-fields > p { margin: 0; color: var(--md-on-surface-variant); font-size: 0.72rem; }
.table-dialog-actions { width: 100%; display: flex; justify-content: flex-end; gap: 0.5rem; }

.ai-composer-dock { position: sticky; z-index: 18; bottom: 1rem; width: min(var(--editor-canvas), calc(100% - 2rem)); margin: -10rem auto 1rem; pointer-events: none; }
.ai-composer-dock > * { pointer-events: auto; }
.ai-composer-loading { padding: 0.8rem 1rem; border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius); background: var(--md-surface); color: var(--md-on-surface-variant); font-size: 0.72rem; box-shadow: 0 12px 35px rgb(0 0 0 / 10%); }

.inspector-backdrop { display: none; }
.document-inspector { flex: 0 0 320px; }
.document-inspector-enter-active, .document-inspector-leave-active { overflow: hidden; transition: flex-basis 240ms cubic-bezier(0.4, 0, 0.2, 1), min-width 240ms cubic-bezier(0.4, 0, 0.2, 1), width 240ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease, transform 240ms cubic-bezier(0.4, 0, 0.2, 1); }
.document-inspector-enter-from, .document-inspector-leave-to { width: 0 !important; min-width: 0 !important; flex-basis: 0 !important; opacity: 0; transform: translateX(1rem); }
.document-inspector-enter-to, .document-inspector-leave-from { opacity: 1; transform: translateX(0); }
.inspector-backdrop-enter-active, .inspector-backdrop-leave-active { transition: opacity 180ms ease; }
.inspector-backdrop-enter-from, .inspector-backdrop-leave-to { opacity: 0; }

@container (min-width: 720px) and (max-width: 1119px) {
.document-inspector { flex-basis: 300px; min-width: 300px; }
.document-canvas { width: min(var(--editor-canvas), calc(100% - 2.25rem)); }
.ai-composer-dock { width: calc(100% - 1.5rem); }
}

@container (max-width: 719px) {
.editor-topbar { grid-template-columns: minmax(0, 1fr) auto; padding-inline: 0.65rem; }
.save-state { display: none; }
.toolbar-secondary, .toolbar-separator.toolbar-secondary { display: none; }
.editor-toolbar { min-height: 3.5rem; overflow-x: auto; padding-inline: 0.45rem; }
.editor-toolbar :deep(.document-toolbar-button) { min-width: 44px; height: 44px; }
.block-type-select { width: 6.5rem; min-width: 6.5rem; }
.more-button { min-width: 44px; height: 44px; }
.document-canvas { width: calc(100% - 2rem); padding-top: 2.25rem; }
.document-title-field :deep(textarea) { font-size: 2rem; }
.document-byline { margin-bottom: 2.3rem; }
.find-bar { overflow-x: auto; }
.find-input { min-width: 9rem; }
.table-toolbar { padding-inline: 0.45rem; }
.ai-composer-dock { bottom: 0.6rem; width: calc(100% - 1rem); margin-bottom: 0.6rem; }
.document-inspector { position: absolute; z-index: 40; inset: auto 0 0; width: 100%; min-width: 0; height: min(82%, 42rem); border: var(--md-border-width) solid var(--md-border-color); border-radius: var(--md-border-radius) var(--md-border-radius) 0 0; box-shadow: 0 -18px 50px rgb(0 0 0 / 18%); }
.document-inspector-enter-active, .document-inspector-leave-active { transition: opacity 180ms ease, transform 240ms cubic-bezier(0.4, 0, 0.2, 1); }
.document-inspector-enter-from, .document-inspector-leave-to { width: 100% !important; min-width: 0 !important; opacity: 0; transform: translateY(1.5rem); }
.inspector-backdrop { display: block; position: absolute; z-index: 39; inset: 0; background: rgb(0 0 0 / 14%); backdrop-filter: blur(1px); }
.document-inspector::before { content: ''; position: absolute; z-index: 1; top: 0.35rem; left: 50%; width: 2.6rem; height: 0.25rem; transform: translateX(-50%); border-radius: var(--md-border-radius); background: var(--md-outline-variant); }
.document-content :deep(.tableWrapper) { width: calc(100cqw - 2rem); }
.selection-menu button { width: 44px; height: 44px; }
}

@keyframes save-pulse {
50% { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
.editor-scroll { scroll-behavior: auto; }
.save-state.is-saving .save-dot { animation: none; }
.table-toolbar-enter-active, .table-toolbar-leave-active, .document-inspector-enter-active, .document-inspector-leave-active, .inspector-backdrop-enter-active, .inspector-backdrop-leave-active { transition-duration: 1ms !important; }
}
</style>
