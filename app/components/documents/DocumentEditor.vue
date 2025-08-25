<template>
    <div
        class="flex flex-col h-full w-full bg-white/10 dark:bg-black/10 backdrop-blur-sm"
    >
        <div class="flex items-center justify-center gap-3 px-3 pt-2 pb-2">
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
            class="flex flex-row items-stretch border-b-2 px-2 py-1 gap-1 flex-wrap"
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
                label="Bullets"
                @activate="cmd('toggleBulletList')"
            />
            <ToolbarButton
                icon="carbon:list-numbered"
                :active="isActive('orderedList')"
                label="Ordered"
                @activate="cmd('toggleOrderedList')"
            />
            <ToolbarButton
                icon="pixelarticons:minus"
                label="HR"
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
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
            <div class="w-full max-w-[820px] mx-auto p-8 pb-24">
                <EditorContent
                    :editor="editor as Editor"
                    class="prose prosemirror-host max-w-none dark:text-white/95 dark:prose-headings:text-white/95 w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px]"
                ></EditorContent>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import {
    useDocumentState,
    setDocumentContent,
    setDocumentTitle,
    loadDocument,
} from '~/composables/useDocumentsStore';
import { Editor, EditorContent } from '@tiptap/vue-3';
import type { JSONContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';

const props = defineProps<{ documentId: string }>();

const state = useDocumentState(props.documentId);
const titleDraft = ref(state.record?.title || '');

watch(
    () => props.documentId,
    async (id) => {
        await loadDocument(id);
        titleDraft.value = state.record?.title || '';
        if (editor.value && state.record) {
            const json = state.record.content as JSONContent;
            editor.value.commands.setContent(json, { emitUpdate: false });
        }
    }
);

const editor = ref<Editor | null>(null);

function onTitleChange() {
    setDocumentTitle(props.documentId, titleDraft.value);
}

function emitContent() {
    if (!editor.value) return;
    const json = editor.value.getJSON();
    setDocumentContent(props.documentId, json);
}

function makeEditor() {
    editor.value = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2] } }),
            Placeholder.configure({
                placeholder: 'Type your text here...',
            }),
        ],
        content: state.record?.content || { type: 'doc', content: [] },
        autofocus: false,
        onUpdate: () => emitContent(),
    });
}

onMounted(async () => {
    await loadDocument(props.documentId);
    makeEditor();
});

onBeforeUnmount(() => {
    editor.value?.destroy();
});

function isActive(name: string) {
    return editor.value?.isActive(name) || false;
}
function isActiveHeading(level: number) {
    return editor.value?.isActive('heading', { level }) || false;
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

const statusText = computed(() => {
    switch (state.status) {
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
.prose :where(h1, h2) {
    font-family: 'Press Start 2P', monospace;
}

/* ProseMirror (TipTap) base styles */
/* TipTap base */
.prosemirror-host :deep(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}

/* Placeholder (needs :deep due to scoped styles) */
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    /* Use design tokens; ensure sufficient contrast in dark mode */
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.85; /* increase for dark background readability */
    font-weight: normal;
}
</style>
