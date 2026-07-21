<template>
    <div class="document-editor-root">
        <header class="editor-topbar">
            <div class="document-identity">
                <UIcon name="lucide:file-text" />
                <span class="topbar-title">{{ titleDraft || 'Untitled' }}</span>
            </div>
            <div class="save-state" :class="`is-${state.status}`" role="status" aria-live="polite">
                <span class="save-dot" />{{ statusText }}
            </div>
            <div class="topbar-actions">
                <button type="button" aria-label="Find in document" :aria-pressed="findOpen" @click="findOpen = !findOpen">
                    <UIcon name="lucide:search" />
                </button>
                <button type="button" aria-label="Open document inspector" :aria-pressed="inspectorOpen" @click="toggleInspector()">
                    <UIcon name="lucide:panel-right" />
                </button>
            </div>
        </header>

        <div class="editor-toolbar" role="toolbar" aria-label="Document formatting">
            <select :value="activeBlock" aria-label="Text style" @change="setBlockType">
                <option value="paragraph">Text</option>
                <option value="heading-1">Heading 1</option>
                <option value="heading-2">Heading 2</option>
                <option value="heading-3">Heading 3</option>
            </select>
            <span class="toolbar-separator" />
            <ToolbarButton v-for="button in formatButtons" :key="button.id" v-bind="button" :active="button.active?.()" @activate="button.run" />
            <span class="toolbar-separator toolbar-secondary" />
            <ToolbarButton v-for="button in insertButtons" :key="button.id" v-bind="button" class="toolbar-secondary" :active="button.active?.()" @activate="button.run" />
            <span class="toolbar-spacer" />
            <ToolbarButton icon="lucide:undo-2" label="Undo (⌘Z)" @activate="editor?.chain().focus().undo().run()" />
            <ToolbarButton icon="lucide:redo-2" label="Redo (⇧⌘Z)" @activate="editor?.chain().focus().redo().run()" />
            <button type="button" class="more-button" aria-label="More editor tools" :aria-expanded="overflowOpen" @click="overflowOpen = !overflowOpen">
                <UIcon name="lucide:ellipsis" />
            </button>
            <div v-if="overflowOpen" class="toolbar-overflow">
                <button v-for="button in overflowButtons" :key="button.id" type="button" @click="button.run(); overflowOpen = false">
                    <UIcon :name="button.icon || 'lucide:circle'" />{{ button.label }}
                </button>
                <button v-for="button in pluginButtons" :key="button.id" type="button" @click="handlePluginButton(button); overflowOpen = false">
                    <UIcon :name="button.icon" />{{ button.tooltip || button.id }}
                </button>
            </div>
        </div>

        <div v-if="findOpen" class="find-bar" role="search">
            <input ref="findInput" v-model="findQuery" placeholder="Find" aria-label="Find text" @keydown.enter.prevent="findNext" />
            <span>{{ findStatus }}</span>
            <button type="button" aria-label="Previous match" @click="findPrevious"><UIcon name="lucide:chevron-up" /></button>
            <button type="button" aria-label="Next match" @click="findNext"><UIcon name="lucide:chevron-down" /></button>
            <input v-model="replaceQuery" placeholder="Replace" aria-label="Replacement text" />
            <button type="button" @click="replaceCurrent">Replace</button>
            <button type="button" @click="replaceAll">All</button>
            <button type="button" aria-label="Close find" @click="findOpen = false"><UIcon name="lucide:x" /></button>
        </div>

        <div class="editor-layout">
            <main class="editor-scroll" @mousedown="focusCanvas">
                <article class="document-canvas">
                    <textarea
                        v-model="titleDraft"
                        class="document-title-input"
                        rows="1"
                        maxlength="300"
                        placeholder="Untitled"
                        aria-label="Document title"
                        @input="onTitleChange"
                    />
                    <p class="document-byline">
                        <span>{{ stats.words.toLocaleString() }} words</span>
                        <span>{{ stats.readingMinutes }} min read</span>
                    </p>

                    <EditorContent v-if="editor" :editor="editor" class="document-content" />

                    <BubbleMenu v-if="editor" :editor="editor" :options="{ placement: 'top' }" class="selection-menu">
                        <button type="button" :class="{ active: editor.isActive('bold') }" aria-label="Bold" @click="editor.chain().focus().toggleBold().run()"><UIcon name="lucide:bold" /></button>
                        <button type="button" :class="{ active: editor.isActive('italic') }" aria-label="Italic" @click="editor.chain().focus().toggleItalic().run()"><UIcon name="lucide:italic" /></button>
                        <button type="button" :class="{ active: editor.isActive('underline') }" aria-label="Underline" @click="editor.chain().focus().toggleUnderline().run()"><UIcon name="lucide:underline" /></button>
                        <button type="button" aria-label="Edit selection with AI" @click="openAiForSelection"><UIcon name="lucide:sparkles" /></button>
                    </BubbleMenu>

                    <div v-if="slashOpen" class="slash-menu" role="listbox" aria-label="Insert block">
                        <div class="slash-menu-label">Insert</div>
                        <button v-for="command in filteredSlashCommands" :key="command.id" type="button" role="option" @click="runSlashCommand(command)">
                            <span><UIcon :name="command.icon" /></span>
                            <span><strong>{{ command.label }}</strong><small>{{ command.description }}</small></span>
                        </button>
                    </div>

                    <div v-if="editor?.isActive('table')" class="table-menu" aria-label="Table controls">
                        <button type="button" @click="editor.chain().focus().addColumnAfter().run()">+ Column</button>
                        <button type="button" @click="editor.chain().focus().addRowAfter().run()">+ Row</button>
                        <button type="button" @click="editor.chain().focus().deleteColumn().run()">− Column</button>
                        <button type="button" @click="editor.chain().focus().deleteRow().run()">− Row</button>
                        <button type="button" class="danger" @click="editor.chain().focus().deleteTable().run()">Delete table</button>
                    </div>
                </article>
            </main>

            <div v-if="inspectorOpen" class="inspector-backdrop" @click="inspectorOpen = false" />
            <DocumentInspector
                v-if="inspectorOpen"
                :editor="editor"
                :document-id="documentId"
                :create-checkpoint="createManualCheckpoint"
                :outline="outline"
                :active-outline-id="activeOutlineId"
                :stats="stats"
                :saved-at="state.record?.updated_at"
                :selection-available="selectionAvailable"
                :ai-actions="documentAiActions"
                :plugin-panels="inspectorPanels"
                :initial-tab="inspectorTab"
                :ai="aiPanelState"
                @close="inspectorOpen = false"
                @outline-select="scrollTo"
                @ai-submit="runAi"
                @ai-estimate="estimateAi"
                @ai-accept="acceptAi"
                @ai-reject="ai.reject"
                @ai-abort="ai.abort"
                @restore="restoreRevision"
            />
        </div>

        <input ref="imageInput" class="sr-only" type="file" accept="image/*" multiple @change="onImageInput" />
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
    toRef,
    watch,
} from 'vue';
import { Editor, EditorContent, type JSONContent } from '@tiptap/vue-3';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import ToolbarButton from './ToolbarButton.vue';
import DocumentInspector from './DocumentInspector.vue';
import { Or3DocumentImage } from '~/extensions/or3-document-image';
import {
    flush,
    loadDocument,
    setDocumentContent,
    setDocumentTitle,
    useDocumentState,
} from '~/composables/documents/useDocumentsStore';
import { registerDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { useDocumentInsights } from '~/composables/documents/useDocumentInsights';
import { useDocumentAiAgent } from '~/composables/documents/useDocumentAiAgent';
import { useDocumentAiActions, useEditorInspectorPanels, useEditorToolbarButtons } from '~/composables';
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';
import { listEditorExtensions, listEditorMarks, listEditorNodes } from '~/composables/editor/useEditorNodes';
import { useHooks } from '~/core/hooks/useHooks';
import { createOrRefFile } from '~/db/files';
import {
    createDocumentRevision,
    type CompleteDocumentRevision,
} from '~/db/document-revisions';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import type { EditorToolbarButton } from '~/composables/editor/useEditorToolbar';
import type { TipTapDocument } from '~/types/database';

const props = defineProps<{ documentId: string }>();
const documentId = toRef(props, 'documentId');
const hooks = useHooks();
const editor = shallowRef<Editor | null>(null);
const state = computed(() => useDocumentState(props.documentId));
const titleDraft = ref('');
const capturedContent = ref<TipTapDocument>({ type: 'doc', content: [{ type: 'paragraph' }] });
const contentVersion = ref(0);
const selectionAvailable = ref(false);
const inspectorOpen = ref(true);
const inspectorTab = ref('ai');
const overflowOpen = ref(false);
const imageInput = ref<HTMLInputElement>();
const findInput = ref<HTMLInputElement>();
const findOpen = ref(false);
const findQuery = ref('');
const replaceQuery = ref('');
const findIndex = ref(-1);
const slashOpen = ref(false);
const slashQuery = ref('');
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
}));

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
    captureTimer = setTimeout(() => { void captureCurrent(true); }, 750);
}

function scheduleAutomaticRevision() {
    if (revisionTimer) clearTimeout(revisionTimer);
    const fiveMinutes = 5 * 60 * 1000;
    const earliest = lastAutomaticRevisionAt
        ? Math.max(30_000, (lastAutomaticRevisionAt + fiveMinutes) - Date.now())
        : 30_000;
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
    slashOpen.value = Boolean(match);
    slashQuery.value = match?.[1]?.toLowerCase() ?? '';
}

function onEditorUpdate() {
    contentVersion.value += 1;
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
        current.chain().focus().insertContent({
            type: 'or3Image',
            attrs: { hash: stored.hash, alt: file.name.replace(/\.[^.]+$/u, ''), width: 100 },
        }).run();
    }
}

async function makeEditor() {
    const loaded = await loadEditorExtensions(
        listEditorNodes(),
        listEditorMarks(),
        listEditorExtensions()
    );
    if (didUnmount) return;
    editor.value?.destroy();
    editor.value = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
            TaskList,
            TaskItem.configure({ nested: true }),
            TableKit.configure({ table: { resizable: true } }),
            Or3DocumentImage,
            Placeholder.configure({
                placeholder: ({ node }) => node.type.name === 'heading'
                    ? 'Heading'
                    : "Write, or press '/' for commands…",
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
        },
        onUpdate: onEditorUpdate,
        onSelectionUpdate: ({ editor: current }) => {
            selectionAvailable.value = !current.state.selection.empty;
            refresh();
            updateSlashMenu();
        },
    });
    hooks.doActionSync('editor.created:action:after', { editor: editor.value });
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
    unregisterSession = registerDocumentEditorSession(id, { capture: () => captureCurrent(false) });
}

watch(documentId, async (id, previous) => {
    if (previous && editor.value) await captureCurrent(true);
    ai.abort();
    await loadActiveDocument(id);
});

watch(() => state.value.record?.title, (title) => {
    if (typeof title === 'string' && state.value.pendingTitle === undefined && title !== titleDraft.value) {
        titleDraft.value = title;
    }
});

watch(findOpen, async (open) => {
    if (open) { await nextTick(); findInput.value?.focus(); }
});

watch(findQuery, () => { findIndex.value = -1; });

onMounted(() => { void loadActiveDocument(props.documentId); });
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

function onTitleChange() {
    setDocumentTitle(props.documentId, titleDraft.value);
}

const statusText = computed(() => state.value.status === 'loading' ? 'Loading'
    : state.value.status === 'saving' ? 'Saving'
    : state.value.status === 'error' ? 'Save failed'
    : state.value.status === 'saved' ? 'Saved'
    : 'Ready'
);

const activeBlock = computed(() => {
    if (editor.value?.isActive('heading', { level: 1 })) return 'heading-1';
    if (editor.value?.isActive('heading', { level: 2 })) return 'heading-2';
    if (editor.value?.isActive('heading', { level: 3 })) return 'heading-3';
    return 'paragraph';
});

function setBlockType(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    const chain = editor.value?.chain().focus();
    if (!chain) return;
    if (value === 'paragraph') chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(value.slice(-1)) as 1 | 2 | 3 }).run();
}

type ToolbarItem = { id: string; icon?: string; text?: string; label: string; active?: () => boolean; run: () => void };
const formatButtons = computed<ToolbarItem[]>(() => [
    { id: 'bold', icon: 'lucide:bold', label: 'Bold (⌘B)', active: () => editor.value?.isActive('bold') ?? false, run: () => { editor.value?.chain().focus().toggleBold().run(); } },
    { id: 'italic', icon: 'lucide:italic', label: 'Italic (⌘I)', active: () => editor.value?.isActive('italic') ?? false, run: () => { editor.value?.chain().focus().toggleItalic().run(); } },
    { id: 'underline', icon: 'lucide:underline', label: 'Underline (⌘U)', active: () => editor.value?.isActive('underline') ?? false, run: () => { editor.value?.chain().focus().toggleUnderline().run(); } },
    { id: 'strike', icon: 'lucide:strikethrough', label: 'Strikethrough', active: () => editor.value?.isActive('strike') ?? false, run: () => { editor.value?.chain().focus().toggleStrike().run(); } },
    { id: 'code', icon: 'lucide:code', label: 'Inline code', active: () => editor.value?.isActive('code') ?? false, run: () => { editor.value?.chain().focus().toggleCode().run(); } },
    { id: 'link', icon: 'lucide:link', label: 'Link', active: () => editor.value?.isActive('link') ?? false, run: editLink },
]);
const insertButtons = computed<ToolbarItem[]>(() => [
    { id: 'bullet', icon: 'lucide:list', label: 'Bullet list', active: () => editor.value?.isActive('bulletList') ?? false, run: () => { editor.value?.chain().focus().toggleBulletList().run(); } },
    { id: 'ordered', icon: 'lucide:list-ordered', label: 'Numbered list', active: () => editor.value?.isActive('orderedList') ?? false, run: () => { editor.value?.chain().focus().toggleOrderedList().run(); } },
    { id: 'tasks', icon: 'lucide:list-checks', label: 'Task list', active: () => editor.value?.isActive('taskList') ?? false, run: () => { editor.value?.chain().focus().toggleTaskList().run(); } },
    { id: 'quote', icon: 'lucide:quote', label: 'Quote', active: () => editor.value?.isActive('blockquote') ?? false, run: () => { editor.value?.chain().focus().toggleBlockquote().run(); } },
]);
const overflowButtons = computed<ToolbarItem[]>(() => [
    { id: 'codeblock', icon: 'lucide:square-code', label: 'Code block', run: () => { editor.value?.chain().focus().toggleCodeBlock().run(); } },
    { id: 'divider', icon: 'lucide:minus', label: 'Divider', run: () => { editor.value?.chain().focus().setHorizontalRule().run(); } },
    { id: 'table', icon: 'lucide:table-2', label: 'Table', run: insertTable },
    { id: 'image', icon: 'lucide:image-plus', label: 'Image', run: () => imageInput.value?.click() },
]);

function handlePluginButton(button: EditorToolbarButton) {
    if (editor.value) void button.onClick(editor.value);
}

function editLink() {
    const current = editor.value;
    if (!current) return;
    const previous = current.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link URL', previous || 'https://');
    if (href === null) return;
    if (!href.trim()) current.chain().focus().extendMarkRange('link').unsetLink().run();
    else if (!/^(?:javascript|data|vbscript):/iu.test(href.trim())) {
        current.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
    }
}

function insertTable() {
    editor.value?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

function onImageInput(event: Event) {
    const input = event.target as HTMLInputElement;
    void insertFiles([...(input.files ?? [])]);
    input.value = '';
}

const slashCommands = computed(() => [
    { id: 'text', label: 'Text', description: 'Plain paragraph', icon: 'lucide:type', run: () => editor.value?.chain().focus().setParagraph().run() },
    { id: 'h1', label: 'Heading 1', description: 'Large section heading', icon: 'lucide:heading-1', run: () => editor.value?.chain().focus().setHeading({ level: 1 }).run() },
    { id: 'h2', label: 'Heading 2', description: 'Medium section heading', icon: 'lucide:heading-2', run: () => editor.value?.chain().focus().setHeading({ level: 2 }).run() },
    { id: 'task', label: 'Task list', description: 'Track action items', icon: 'lucide:list-checks', run: () => editor.value?.chain().focus().toggleTaskList().run() },
    { id: 'bullet', label: 'Bullet list', description: 'Create a simple list', icon: 'lucide:list', run: () => editor.value?.chain().focus().toggleBulletList().run() },
    { id: 'quote', label: 'Quote', description: 'Emphasize a passage', icon: 'lucide:quote', run: () => editor.value?.chain().focus().toggleBlockquote().run() },
    { id: 'code', label: 'Code block', description: 'Write formatted code', icon: 'lucide:square-code', run: () => editor.value?.chain().focus().toggleCodeBlock().run() },
    { id: 'table', label: 'Table', description: 'Insert a 3 × 3 table', icon: 'lucide:table-2', run: insertTable },
    { id: 'image', label: 'Image', description: 'Upload an offline-first image', icon: 'lucide:image-plus', run: () => imageInput.value?.click() },
    { id: 'divider', label: 'Divider', description: 'Separate sections', icon: 'lucide:minus', run: () => editor.value?.chain().focus().setHorizontalRule().run() },
]);
const filteredSlashCommands = computed(() => slashCommands.value.filter((command) =>
    `${command.label} ${command.description}`.toLowerCase().includes(slashQuery.value)
).slice(0, 8));

function runSlashCommand(command: typeof slashCommands.value[number]) {
    const current = editor.value;
    if (!current) return;
    const from = current.state.selection.from - slashQuery.value.length - 1;
    current.chain().focus().deleteRange({ from, to: current.state.selection.from }).run();
    command.run();
    slashOpen.value = false;
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
            results.push({ from: position + index, to: position + index + needle.length });
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
function findNext() { selectMatch(findIndex.value + 1); }
function findPrevious() { selectMatch(findIndex.value - 1); }
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
    inspectorTab.value = 'ai';
    inspectorOpen.value = true;
}

async function runAi(prompt: string, scope: DocumentAiScope) {
    try { await ai.submit(prompt, scope); }
    catch (caught) { console.error('[DocumentAI] submit failed', caught); }
}
async function estimateAi(prompt: string, scope: DocumentAiScope) {
    await ai.estimate(prompt, scope).catch(() => 0);
}
async function acceptAi() {
    try { await ai.accept(); }
    catch (caught) { console.error('[DocumentAI] accept failed', caught); }
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
.document-editor-root {
    --editor-canvas: 780px;
    position: relative;
    container-type: inline-size;
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--md-on-surface);
    background: var(--md-surface);
}

.editor-topbar {
    min-height: 3.4rem;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    /* PageShell owns floating controls at both ends of the first 46px row. */
    padding: .4rem 7rem .4rem 4.75rem;
    border-bottom: 1px solid var(--md-outline-variant);
    background: color-mix(in oklab, var(--md-surface), transparent 3%);
}
.document-identity, .save-state, .topbar-actions { display: flex; align-items: center; gap: .45rem; }
.document-identity { min-width: 0; color: var(--md-on-surface-variant); }
.topbar-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; font-weight: 600; }
.save-state { color: var(--md-on-surface-variant); font-size: .72rem; }
.save-dot { width: .42rem; height: .42rem; border-radius: 50%; background: var(--md-primary); }
.save-state.is-saving .save-dot { animation: save-pulse 1s infinite; }
.save-state.is-error { color: var(--md-error); }.save-state.is-error .save-dot { background: var(--md-error); }
.topbar-actions { justify-content: flex-end; }
.topbar-actions button, .more-button { width: 2.5rem; height: 2.5rem; display: grid; place-items: center; border-radius: .65rem; color: var(--md-on-surface-variant); }
.topbar-actions button:hover, .more-button:hover { background: var(--md-surface-container); color: var(--md-on-surface); }

.editor-toolbar {
    position: relative;
    z-index: 10;
    min-height: 3.35rem;
    display: flex;
    align-items: center;
    gap: .15rem;
    padding: .4rem max(.65rem, calc((100% - var(--editor-canvas)) / 2));
    border-bottom: 1px solid var(--md-outline-variant);
    background: color-mix(in oklab, var(--md-surface), transparent 2%);
    box-shadow: 0 5px 18px rgb(0 0 0 / 3%);
}
.editor-toolbar select { height: 2.35rem; min-width: 6.4rem; padding: 0 .55rem; border-radius: .55rem; background: transparent; font-size: .78rem; font-weight: 600; outline: none; }
.toolbar-separator { width: 1px; height: 1.35rem; margin: 0 .35rem; background: var(--md-outline-variant); }
.toolbar-spacer { flex: 1; }
.toolbar-overflow { position: absolute; z-index: 30; top: calc(100% + .35rem); right: .75rem; width: 13rem; display: grid; padding: .4rem; border: 1px solid var(--md-outline-variant); border-radius: .75rem; background: var(--md-surface); box-shadow: 0 12px 38px rgb(0 0 0 / 16%); }
.toolbar-overflow button { min-height: 2.5rem; display: flex; align-items: center; gap: .6rem; padding: .45rem .6rem; border-radius: .5rem; text-align: left; font-size: .78rem; }
.toolbar-overflow button:hover { background: var(--md-surface-container); }

.find-bar { z-index: 9; display: flex; align-items: center; gap: .35rem; padding: .45rem .75rem; border-bottom: 1px solid var(--md-outline-variant); background: var(--md-surface-container-low); }
.find-bar input { width: min(12rem, 24vw); height: 2.25rem; padding: 0 .6rem; border: 1px solid var(--md-outline-variant); border-radius: .5rem; background: var(--md-surface); outline: none; }
.find-bar span { min-width: 4.2rem; color: var(--md-on-surface-variant); font-size: .7rem; text-align: center; }
.find-bar button { min-width: 2.25rem; min-height: 2.25rem; padding: .35rem; border-radius: .5rem; font-size: .72rem; }
.find-bar button:hover { background: var(--md-surface-container); }

.editor-layout { position: relative; flex: 1; min-height: 0; display: flex; }
.editor-scroll { flex: 1; min-width: 0; overflow-y: auto; scroll-behavior: smooth; }
.document-canvas { position: relative; width: min(var(--editor-canvas), calc(100% - 3rem)); min-height: 100%; margin: 0 auto; padding: clamp(2.5rem, 7cqw, 5.5rem) 0 12rem; }
.document-title-input { display: block; width: 100%; min-height: 1.2em; field-sizing: content; resize: none; overflow: hidden; border: 0; background: transparent; color: var(--md-on-surface); font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: clamp(2rem, 5cqw, 3rem); font-weight: 720; letter-spacing: -.035em; line-height: 1.08; outline: none; }
.document-title-input::placeholder { color: color-mix(in oklab, var(--md-on-surface-variant), transparent 55%); }
.document-byline { display: flex; gap: .8rem; margin: .85rem 0 3rem; color: var(--md-on-surface-variant); font-size: .72rem; }

.document-content { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 1rem; line-height: 1.72; }
.document-content :deep(.ProseMirror) { min-height: 55vh; outline: none; caret-color: var(--md-primary); }
.document-content :deep(.ProseMirror > *) { margin-block: 0 1rem; }
.document-content :deep(h1) { margin-top: 2.4rem; font-size: 1.9rem; letter-spacing: -.025em; line-height: 1.2; }
.document-content :deep(h2) { margin-top: 2.15rem; font-size: 1.5rem; letter-spacing: -.018em; line-height: 1.25; }
.document-content :deep(h3) { margin-top: 1.8rem; font-size: 1.2rem; line-height: 1.3; }
.document-content :deep(a) { color: var(--md-primary); text-decoration: underline; text-underline-offset: .15em; }
.document-content :deep(blockquote) { margin-inline: 0; padding: .25rem 0 .25rem 1rem; border-inline-start: 3px solid var(--md-primary); color: var(--md-on-surface-variant); }
.document-content :deep(pre) { overflow-x: auto; padding: 1rem 1.1rem; border: 1px solid var(--md-outline-variant); border-radius: .75rem; background: var(--md-surface-container-low); }
.document-content :deep(code:not(pre code)) { padding: .12rem .3rem; border-radius: .3rem; background: var(--md-surface-container); font-size: .88em; }
.document-content :deep(hr) { margin: 2.5rem 0; border: 0; border-top: 1px solid var(--md-outline-variant); }
.document-content :deep(ul), .document-content :deep(ol) { padding-inline-start: 1.5rem; }
.document-content :deep(ul[data-type='taskList']) { padding: 0; list-style: none; }
.document-content :deep(ul[data-type='taskList'] li) { display: flex; gap: .6rem; align-items: flex-start; }
.document-content :deep(ul[data-type='taskList'] label) { margin-top: .28rem; }
.document-content :deep(.tableWrapper) { width: min(1040px, calc(100cqw - 3rem)); margin: 1.75rem 50%; transform: translateX(-50%); overflow-x: auto; border: 1px solid var(--md-outline-variant); border-radius: .75rem; }
.document-content :deep(table) { width: 100%; min-width: 38rem; border-collapse: collapse; table-layout: fixed; }
.document-content :deep(th), .document-content :deep(td) { min-width: 7rem; padding: .55rem .65rem; border-inline-end: 1px solid var(--md-outline-variant); border-bottom: 1px solid var(--md-outline-variant); vertical-align: top; }
.document-content :deep(th) { background: var(--md-surface-container-low); text-align: left; font-size: .75rem; }
.document-content :deep(.selectedCell::after) { background: color-mix(in oklab, var(--md-primary), transparent 86%); }
.document-content :deep(p.is-editor-empty:first-child::before), .document-content :deep(.is-empty::before) { float: left; height: 0; color: color-mix(in oklab, var(--md-on-surface-variant), transparent 45%); content: attr(data-placeholder); pointer-events: none; }

.selection-menu { display: flex; gap: .12rem; padding: .3rem; border: 1px solid var(--md-outline-variant); border-radius: .7rem; background: var(--md-surface); box-shadow: 0 10px 30px rgb(0 0 0 / 16%); }
.selection-menu button { width: 2.25rem; height: 2.25rem; display: grid; place-items: center; border-radius: .5rem; }
.selection-menu button:hover, .selection-menu button.active { color: var(--md-primary); background: var(--md-primary-container); }
.slash-menu { position: sticky; z-index: 20; bottom: 1.5rem; width: min(21rem, calc(100vw - 2rem)); max-height: 25rem; overflow-y: auto; margin: 1rem 0; padding: .4rem; border: 1px solid var(--md-outline-variant); border-radius: .85rem; background: var(--md-surface); box-shadow: 0 18px 50px rgb(0 0 0 / 18%); }
.slash-menu-label { padding: .45rem .65rem; color: var(--md-on-surface-variant); font-size: .65rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.slash-menu button { width: 100%; min-height: 3.25rem; display: grid; grid-template-columns: 2.25rem 1fr; align-items: center; gap: .55rem; padding: .4rem .55rem; border-radius: .6rem; text-align: left; }
.slash-menu button:hover { background: var(--md-surface-container); }
.slash-menu button > span:first-child { width: 2rem; height: 2rem; display: grid; place-items: center; border: 1px solid var(--md-outline-variant); border-radius: .5rem; }
.slash-menu button > span:last-child { display: grid; }.slash-menu small { color: var(--md-on-surface-variant); font-size: .67rem; }
.table-menu { position: sticky; z-index: 8; bottom: 1rem; display: flex; flex-wrap: wrap; gap: .35rem; width: max-content; max-width: 100%; margin: 2rem auto 0; padding: .4rem; border: 1px solid var(--md-outline-variant); border-radius: .7rem; background: var(--md-surface); box-shadow: 0 8px 24px rgb(0 0 0 / 10%); }
.table-menu button { min-height: 2.1rem; padding: .3rem .55rem; border-radius: .45rem; font-size: .68rem; }.table-menu .danger { color: var(--md-error); }

.inspector-backdrop { display: none; }
.document-inspector { flex: 0 0 320px; }

@container (max-width: 1119px) {
    .document-inspector { position: absolute; z-index: 40; inset-block: 0; inset-inline-end: 0; }
    .inspector-backdrop { display: block; position: absolute; z-index: 39; inset: 0; background: rgb(0 0 0 / 14%); backdrop-filter: blur(1px); }
}

@container (max-width: 719px) {
    .editor-topbar { grid-template-columns: minmax(0, 1fr) auto; padding-inline: .65rem; }
    .save-state { display: none; }
    .toolbar-secondary, .toolbar-separator.toolbar-secondary { display: none; }
    .editor-toolbar { min-height: 3.5rem; overflow-x: auto; padding-inline: .45rem; }
    .editor-toolbar :deep(.document-toolbar-button) { min-width: 44px; height: 44px; }
    .editor-toolbar select { min-width: 5.4rem; height: 44px; }
    .more-button { min-width: 44px; height: 44px; }
    .document-canvas { width: calc(100% - 2rem); padding-top: 2.25rem; }
    .document-title-input { font-size: 2rem; }
    .document-byline { margin-bottom: 2.3rem; }
    .find-bar { overflow-x: auto; }.find-bar input { min-width: 9rem; }
    .document-inspector { position: absolute; z-index: 40; inset: auto 0 0; width: 100%; min-width: 0; height: min(82%, 42rem); border: 1px solid var(--md-outline-variant); border-radius: 1rem 1rem 0 0; box-shadow: 0 -18px 50px rgb(0 0 0 / 18%); }
    .document-inspector::before { content: ''; position: absolute; z-index: 1; top: .35rem; left: 50%; width: 2.6rem; height: .25rem; transform: translateX(-50%); border-radius: 1rem; background: var(--md-outline-variant); }
    .document-content :deep(.tableWrapper) { width: calc(100cqw - 2rem); }
    .selection-menu button { width: 44px; height: 44px; }
}

@keyframes save-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) {
    .editor-scroll { scroll-behavior: auto; }
    .save-state.is-saving .save-dot { animation: none; }
}
</style>
