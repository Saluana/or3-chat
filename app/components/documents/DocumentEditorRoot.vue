<template>
    <div
        class="flex flex-col h-full w-full bg-white/10 dark:bg-black/10 backdrop-blur-sm"
    >
        <div
            class="flex items-center justify-between sm:justify-center px-3 pt-2 pb-2"
        >
            <UInput
                v-model="titleDraft"
                placeholder="Untitled"
                size="md"
                class="flex-1 max-w-[60%]"
                @update:model-value="onTitleChange"
            />
            <div class="flex items-center gap-1">
                <UTooltip :text="statusText">
                    <span
                        class="text-xs opacity-70 w-16 text-right select-none"
                        >{{ statusText }}</span
                    >
                </UTooltip>
            </div>
        </div>
        <div
            class="flex flex-row items-stretch border-b-2 border-[var(--md-inverse-surface)] px-3 md:px-2 py-1 gap-2 md:gap-1 flex-wrap pb-2"
        >
            <ToolbarButton
                icon="carbon:text-bold"
                :active="isActive('bold')"
                label="Bold (⌘B)"
                @activate="cmd('toggleBold')"
            />
            <ToolbarButton
                icon="carbon:text-italic"
                :active="isActive('italic')"
                label="Italic (⌘I)"
                @activate="cmd('toggleItalic')"
            />
            <ToolbarButton
                icon="pixelarticons:code"
                :active="isActive('code')"
                label="Code"
                @activate="cmd('toggleCode')"
            />
            <ToolbarButton
                text="H1"
                :active="isActiveHeading(1)"
                label="H1"
                @activate="toggleHeading(1)"
            />
            <ToolbarButton
                text="H2"
                :active="isActiveHeading(2)"
                label="H2"
                @activate="toggleHeading(2)"
            />
            <ToolbarButton
                text="H3"
                :active="isActiveHeading(3)"
                label="H3"
                @activate="toggleHeading(3)"
            />
            <ToolbarButton
                icon="pixelarticons:list"
                :active="isActive('bulletList')"
                label="Bullet list"
                @activate="cmd('toggleBulletList')"
            />
            <ToolbarButton
                icon="carbon:list-numbered"
                :active="isActive('orderedList')"
                label="Ordered list"
                @activate="cmd('toggleOrderedList')"
            />
            <ToolbarButton
                icon="pixelarticons:minus"
                label="Horizontal Rule"
                @activate="cmd('setHorizontalRule')"
            />
            <ToolbarButton
                icon="pixelarticons:undo"
                label="Undo"
                @activate="cmd('undo')"
            />
            <ToolbarButton
                icon="pixelarticons:redo"
                label="Redo"
                @activate="cmd('redo')"
            />
            <!-- Plugin-registered toolbar buttons -->
            <ToolbarButton
                v-for="btn in pluginButtons"
                :key="btn.id"
                :icon="btn.icon"
                :active="getButtonActive(btn)"
                :label="btn.tooltip || btn.id"
                @activate="handleButtonClick(btn)"
            />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
            <div
                class="w-full max-w-[820px] mx-auto p-8 pb-24"
                @mousedown="handleContainerClick"
            >
                <div
                    ref="editorMountEl"
                    class="prose prosemirror-host max-w-none dark:text-white/95 dark:prose-headings:text-white/95 dark:prose-strong:text-white/95 w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px]"
                ></div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    onMounted,
    onBeforeUnmount,
    ref,
    watch,
    computed,
    nextTick,
    type Ref,
} from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import {
    useDocumentState,
    setDocumentContent,
    setDocumentTitle,
    loadDocument,
} from '~/composables/documents/useDocumentsStore';
import { Editor } from '@tiptap/vue-3';
import type { JSONContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import {
    useEditorToolbarButtons,
    listEditorNodes,
    listEditorMarks,
    listEditorExtensions,
    useHooks,
    type EditorToolbarButton,
} from '~/composables';
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';

const props = defineProps<{ documentId: string }>();

const hooks = useHooks();

// Reactive state wrapper (computed to always fetch current map entry)
const state = computed(() => useDocumentState(props.documentId));
const titleDraft = ref(state.value.record?.title || '');

watch(
    () => props.documentId,
    async (id, _old, onCleanup) => {
        // Switch to new state object from map
        const currentLoadId = id;
        await loadDocument(id);
        if (didUnmount) return;
        if (props.documentId !== currentLoadId) return; // prop changed again
        titleDraft.value = state.value.record?.title || '';
        if (editor.value && state.value.record) {
            const json = state.value.record.content as JSONContent;
            editor.value.commands.setContent(json, { emitUpdate: false });
        }
    }
);

const editor = ref<Editor | null>(null);
const editorMountEl = ref<HTMLElement | null>(null);
let didUnmount = false;

// Get plugin-registered toolbar buttons
const pluginButtons = useEditorToolbarButtons(editor as Ref<Editor | null>);

function onTitleChange() {
    setDocumentTitle(props.documentId, titleDraft.value);
}

// Reflect external title updates (e.g., sidebar rename) into the input when
// we're not currently staging a local pendingTitle.
watch(
    () => state.value.record?.title,
    (newTitle) => {
        if (
            typeof newTitle === 'string' &&
            newTitle.length > 0 &&
            newTitle !== titleDraft.value &&
            state.value.pendingTitle === undefined // don't clobber local edits
        ) {
            titleDraft.value = newTitle;
        }
    }
);

function emitContent() {
    if (!editor.value) return;
    const json = editor.value.getJSON();
    setDocumentContent(props.documentId, json);

    // Emit hook for plugins to observe updates
    hooks.doActionSync('editor.updated:action:after', { editor: editor.value });
}

async function makeEditor() {
    // Load all editor extensions (both eager and lazy)
    const {
        nodes: pluginNodes,
        marks: pluginMarks,
        extensions: pluginExtensions,
    } = await loadEditorExtensions(
        listEditorNodes(),
        listEditorMarks(),
        listEditorExtensions()
    );

    try {
        if (didUnmount) return;
        let mountTarget = editorMountEl.value;
        if (!mountTarget) {
            await nextTick();
            if (didUnmount) return;
            mountTarget = editorMountEl.value;
        }
        if (!mountTarget) {
            throw new Error('Editor mount element missing');
        }
        mountTarget.innerHTML = '';
        editor.value = new Editor({
            element: mountTarget,
            extensions: [
                StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
                Placeholder.configure({
                    placeholder: 'Type your text here...',
                }),
                ...pluginExtensions,
                ...pluginNodes,
                ...pluginMarks,
            ],
            content: state.value.record?.content || {
                type: 'doc',
                content: [],
            },
            autofocus: false,
            onUpdate: () => emitContent(),
        });

        // Emit hook for plugins to access editor instance
        hooks.doActionSync('editor.created:action:after', {
            editor: editor.value,
        });
    } catch (e) {
        console.error('[DocumentEditor] Failed to create editor:', e);
        // Rethrow to prevent unusable state
        throw e;
    }
}

onMounted(async () => {
    await loadDocument(props.documentId);
    if (didUnmount) return;
    // Ensure title reflects loaded record (refresh / deep link case)
    titleDraft.value = state.value.record?.title || titleDraft.value || '';
    // Ensure initial state ref matches (in case of rapid prop change before mount)
    await makeEditor();
});

onBeforeUnmount(() => {
    didUnmount = true;
    editor.value?.destroy();
});

function isActive(name: string) {
    return editor.value?.isActive(name) || false;
}
function isActiveHeading(level: number) {
    return editor.value?.isActive('heading', { level }) || false;
}

function getButtonActive(btn: EditorToolbarButton): boolean {
    const ed = editor.value;
    if (!ed || !btn.isActive) return false;
    try {
        return btn.isActive(ed as Editor);
    } catch (e) {
        if (import.meta.dev) {
            console.error(
                `[DocumentEditor] isActive() threw for button ${btn.id}:`,
                e
            );
        }
        return false;
    }
}

function handleButtonClick(btn: EditorToolbarButton): void {
    const ed = editor.value;
    if (!ed) return;
    try {
        btn.onClick(ed as Editor);
    } catch (e) {
        if (import.meta.dev) {
            console.error(
                `[DocumentEditor] onClick() threw for button ${btn.id}:`,
                e
            );
        }
    }
}

function toggleHeading(level: number) {
    // TipTap Heading levels type expects specific union; cast to any to keep minimal.
    editor.value
        ?.chain()
        .focus()
        .toggleHeading({ level: level as any })
        .run();
    emitContent();
}

const commands: Record<string, () => void> = {
    toggleBold: () => editor.value?.chain().focus().toggleBold().run(),
    toggleItalic: () => editor.value?.chain().focus().toggleItalic().run(),
    toggleCode: () => editor.value?.chain().focus().toggleCode().run(),
    toggleBulletList: () =>
        editor.value?.chain().focus().toggleBulletList().run(),
    toggleOrderedList: () =>
        editor.value?.chain().focus().toggleOrderedList().run(),
    setHorizontalRule: () =>
        editor.value?.chain().focus().setHorizontalRule().run(),
    undo: () => editor.value?.commands.undo(),
    redo: () => editor.value?.commands.redo(),
};
function cmd(name: string) {
    commands[name]?.();
    emitContent();
}

function handleContainerClick(event: MouseEvent) {
    // Only focus editor if clicking on the container itself, not on the editor content
    if (editor.value && event.target === event.currentTarget) {
        editor.value.commands.focus('end');
    }
}

const statusText = computed(() => {
    switch (state.value.status) {
        case 'loading':
            return 'Loading…';
        case 'saving':
            return 'Saving…';
        case 'saved':
            return 'Saved';
        case 'error':
            return 'Error';
        default:
            return 'Ready';
    }
});
</script>

<style scoped>
.prose {
    font-family: 'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont,
        'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    color: var(--md-on-surface);
}

.prose :where(h1, h2, h3, h4, h5, h6) {
    font-family: 'IBM Plex Sans', system-ui !important;
}

/* ProseMirror (TipTap) base styles */
/* TipTap base */
.prosemirror-host {
    display: block;
    min-height: 320px;
    width: 100%;
}
.prosemirror-host :deep(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
    min-height: 100%;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}

/* Placeholder (needs :deep due to scoped styles) */
.prosemirror-host :deep(p.is-editor-empty:first-child) {
    position: relative;
}
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    /* Use design tokens; ensure sufficient contrast in dark mode */
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    pointer-events: none;
    position: absolute;
    inset-inline-start: 0;
    inset-block-start: 0;
}
</style>
