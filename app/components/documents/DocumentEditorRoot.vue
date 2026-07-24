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
import { useResponsiveState } from '~/composables/core/useResponsiveState';
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
import {
    DOCUMENT_BLOCK_TYPE_ITEMS,
    type DocumentToolbarItem,
} from '~/core/documents/editor-toolbar';

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
const { isMobile, hydrated: responsiveHydrated } = useResponsiveState();
const inspectorOpen = ref(false);
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
let inspectorDefaultApplied = false;

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
    if (isMobile.value) inspectorOpen.value = false;
    ai.reset();
    await loadActiveDocument(id);
});

watch(
    responsiveHydrated,
    (ready) => {
        if (!ready || inspectorDefaultApplied) return;
        inspectorDefaultApplied = true;
        inspectorOpen.value = !isMobile.value;
    },
    { immediate: true },
);

watch(isMobile, (mobile) => {
    if (mobile) inspectorOpen.value = false;
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
const blockTypeItems = DOCUMENT_BLOCK_TYPE_ITEMS;

function setBlockType(value: string | number | undefined) {
    if (typeof value !== 'string') return;
    const chain = editor.value?.chain().focus();
    if (!chain) return;
    if (value === 'paragraph') chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(value.slice(-1)) as 1 | 2 | 3 }).run();
}

const formatButtons = computed<DocumentToolbarItem[]>(() => [
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
const insertButtons = computed<DocumentToolbarItem[]>(() => [
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
const overflowButtons = computed<DocumentToolbarItem[]>(() => [
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

<style scoped src="./DocumentEditorRoot.css"></style>
