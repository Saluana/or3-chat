<template>
    <div class="prompt-editor-shell" :class="{ disabled }">
        <EditorContent v-if="editor" :editor="(editor as any)" class="prompt-editor" />
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { Extension, type Editor as CoreEditor, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { useAppConfig } from '#imports';
import type { DocumentAiAction } from '~/composables/editor/useDocumentAiActions';
import { isMentionSourceEnabled } from '~/composables/useOr3Config';
import {
    searchDocumentAiMentions,
    uniqueDocumentAiReferences,
    type DocumentAiContextReference,
} from '~/utils/documents/document-ai-context';
import { createMentionSuggestion } from '~/plugins/ChatMentions/suggestions';
import {
    DocumentAiSlashCommand,
    searchDocumentAiPromptActions,
    type DocumentAiPromptAction,
} from '~/plugins/DocumentAiCommands/slashCommandExtension';
import { createDocumentAiActionSuggestion } from '~/plugins/DocumentAiCommands/suggestions';

const props = defineProps<{
    modelValue: string;
    documentId: string;
    placeholder: string;
    savedActions: readonly DocumentAiAction[];
    pluginActions: readonly DocumentAiAction[];
    disabled?: boolean;
}>();
const emit = defineEmits<{
    'update:modelValue': [value: string];
    'update:references': [references: DocumentAiContextReference[]];
    'select-action': [action: DocumentAiPromptAction];
    submit: [];
}>();

const editor = shallowRef<Editor | null>(null);
const references = ref<DocumentAiContextReference[]>([]);
const appConfig = useAppConfig();
const mentionConfig = ((appConfig as Record<string, unknown>).mentions ?? {}) as {
    debounceMs?: number;
    maxPerGroup?: number;
    maxContextBytes?: number;
};

function plainTextDocument(value: string) {
    const lines = value.split('\n');
    return {
        type: 'doc',
        content: lines.map((line) => ({
            type: 'paragraph',
            ...(line ? { content: [{ type: 'text', text: line }] } : {}),
        })),
    };
}

function editorText(instance: CoreEditor) {
    return instance.getText({ blockSeparator: '\n' });
}

function collectReferences(instance: CoreEditor) {
    const found: DocumentAiContextReference[] = [];
    instance.state.doc.descendants((node) => {
        if (node.type.name !== 'mention') return true;
        const { id, source, label } = node.attrs;
        if (
            typeof id === 'string'
            && (source === 'document' || source === 'chat')
            && typeof label === 'string'
        ) {
            found.push({ id, source, label });
        }
        return true;
    });
    references.value = uniqueDocumentAiReferences(found);
    emit('update:references', references.value);
}

function searchActions(query: string) {
    return Promise.resolve(searchDocumentAiPromptActions(query, props.savedActions, props.pluginActions));
}

onMounted(() => {
    const documentsEnabled = isMentionSourceEnabled('documents');
    const conversationsEnabled = isMentionSourceEnabled('conversations');
    const extensions: Extensions = [
        StarterKit.configure({
            bold: false,
            italic: false,
            strike: false,
            code: false,
            blockquote: false,
            heading: false,
            bulletList: false,
            orderedList: false,
            codeBlock: false,
            horizontalRule: false,
            dropcursor: false,
            gapcursor: false,
        }),
        Placeholder.configure({ placeholder: () => props.placeholder }),
        Extension.create({
            name: 'documentAiSubmit',
            addKeyboardShortcuts() {
                return {
                    'Mod-Enter': () => {
                        emit('submit');
                        return true;
                    },
                };
            },
        }),
        DocumentAiSlashCommand.configure({
            suggestion: createDocumentAiActionSuggestion(searchActions, (action) => emit('select-action', action)),
        }),
    ];

    if (documentsEnabled || conversationsEnabled) {
        const MentionWithAttrs = Mention.extend({
            addAttributes() {
                return {
                    id: { default: null },
                    label: { default: null },
                    source: { default: null },
                };
            },
        });
        extensions.push(
            MentionWithAttrs.configure({
                HTMLAttributes: { class: 'document-ai-mention' },
                renderText({ node }) {
                    return `@${node.attrs.label || node.attrs.id || ''}`;
                },
                suggestion: createMentionSuggestion(
                    (query) => searchDocumentAiMentions(query, {
                        currentDocumentId: props.documentId,
                        documentsEnabled,
                        conversationsEnabled,
                        maxPerGroup: mentionConfig.maxPerGroup,
                        maxContextBytes: mentionConfig.maxContextBytes,
                    }),
                    mentionConfig.debounceMs ?? 100,
                ),
            }),
        );
    }

    editor.value = new Editor({
        extensions,
        editable: !props.disabled,
        content: plainTextDocument(props.modelValue),
        editorProps: {
            attributes: {
                'aria-label': 'Document AI prompt',
                role: 'textbox',
            },
        },
        onUpdate: ({ editor: instance }) => {
            emit('update:modelValue', editorText(instance));
            collectReferences(instance);
        },
    });
});

watch(() => props.modelValue, (value) => {
    const instance = editor.value;
    if (!instance || editorText(instance) === value) return;
    instance.commands.setContent(plainTextDocument(value), { emitUpdate: false });
    collectReferences(instance);
});
watch(() => props.placeholder, () => {
    const instance = editor.value;
    if (instance) instance.view.dispatch(instance.state.tr);
});
watch(() => props.disabled, (disabled) => editor.value?.setEditable(!disabled));

function removeReference(reference: DocumentAiContextReference) {
    const instance = editor.value;
    if (!instance) return;
    const positions: Array<{ from: number; to: number }> = [];
    instance.state.doc.descendants((node, position) => {
        if (
            node.type.name === 'mention'
            && node.attrs.id === reference.id
            && node.attrs.source === reference.source
        ) {
            positions.push({ from: position, to: position + node.nodeSize });
        }
        return true;
    });
    if (!positions.length) return;
    const transaction = instance.state.tr;
    for (const position of positions.reverse()) transaction.delete(position.from, position.to);
    instance.view.dispatch(transaction);
    instance.commands.focus();
}

function focus() {
    editor.value?.commands.focus('end');
}

onBeforeUnmount(() => editor.value?.destroy());
defineExpose({ focus, removeReference });
</script>

<style scoped>
.prompt-editor-shell { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.prompt-editor-shell.disabled { opacity: 0.7; pointer-events: none; }
/* One line fills the chat composer's 2.5rem editor row. */
.prompt-editor {
    min-height: 2.5rem;
    max-height: 11rem;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 0.5rem 0;
    color: var(--md-on-surface);
    font-size: 1rem;
    line-height: 1.5;
}
/* Empty state: no scrollport under the placeholder. */
.prompt-editor:has(.ProseMirror p.is-editor-empty:first-child) {
    overflow-y: hidden;
}
.prompt-editor :deep(.ProseMirror) {
    min-height: 1lh;
    outline: none;
    white-space: pre-wrap;
}
.prompt-editor :deep(.ProseMirror p) {
    margin: 0;
    line-height: inherit;
}
.prompt-editor :deep(.ProseMirror p + p) { margin-top: 0.25rem; }
.prompt-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
    /* One line tall with a cancelling margin: it still doesn't push the caret
       line, but a placeholder too long for narrow panes ends in "…" instead
       of being cut mid-word. */
    width: 100%;
    height: 1lh;
    margin-bottom: -1lh;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    float: left;
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 16%);
    content: attr(data-placeholder);
    pointer-events: none;
}
.prompt-editor :deep(.document-ai-mention) { display: inline-flex; align-items: center; padding: 0.05rem 0.25rem; border-radius: var(--md-border-radius-small, 0.3rem); color: var(--md-primary); background: var(--md-primary-container); font-weight: 650; }
@media (max-width: 600px) {
    .prompt-editor { max-height: 7rem; }
}
</style>
