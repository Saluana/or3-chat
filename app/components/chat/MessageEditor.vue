<template>
    <div
        v-bind="containerProps"
        :class="[
            'message-editor-container relative min-h-[40px]',
            containerProps?.class ?? '',
        ]"
    >
        <EditorContent
            v-if="editor"
            v-bind="editorProps"
            :class="['tiptap-editor fade-in', editorProps?.class ?? '']"
            :editor="(editor as any)"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { StarterKit } from '@tiptap/starter-kit';
import { Editor, EditorContent } from '@tiptap/vue-3';
// If you still want markdown extension keep it; otherwise remove these two lines:
import { Markdown } from 'tiptap-markdown';
import { useDebounceFn } from '@vueuse/core';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{
    modelValue: string;
    autofocus?: boolean;
    focusDelay?: number;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: string): void;
    (e: 'ready'): void;
}>();

const containerProps = useThemeOverrides({
    component: 'div',
    context: 'message',
    identifier: 'message.editor-container',
    isNuxtUI: false,
});

const editorProps = useThemeOverrides({
    component: 'div',
    context: 'message',
    identifier: 'message.editor',
    isNuxtUI: false,
});

const editor = ref<Editor | null>(null);
// Prevent feedback loop when emitting updates -> watcher -> setContent -> update
let internalUpdate = false;
let lastEmitted = '';

const emitModelValue = useDebounceFn((val: string): void => {
    emit('update:modelValue', val);
}, 200);

async function init() {
    const extensions = [StarterKit.configure({ codeBlock: {} }), Markdown];

    function hasGetMarkdown(v: unknown): v is { getMarkdown: () => string } {
        if (v === null || typeof v !== 'object') return false;
        if (!('getMarkdown' in v)) return false;
        const fn = (v as Record<string, unknown>).getMarkdown;
        return typeof fn === 'function';
    }

    const instance = new Editor({
        extensions,
        content: props.modelValue,
        onUpdate: ({ editor: e }) => {
            const storage: unknown = e.storage;
            if (
                storage &&
                typeof storage === 'object' &&
                'markdown' in storage
            ) {
                const markdown = (storage as Record<string, unknown>).markdown;
                if (hasGetMarkdown(markdown)) {
                    emitModelValue(markdown.getMarkdown());
                }
            }
        },
    });

    editor.value = instance;

    await nextTick();
    if (props.autofocus) {
        const delay =
            typeof props.focusDelay === 'number' ? props.focusDelay : 90;
        setTimeout(() => {
            try {
                instance.commands.focus('end');
            } catch {}
        }, delay);
    }
    lastEmitted = props.modelValue;
    emit('ready');
}

onMounted(() => {
    init();
});

onBeforeUnmount(() => {
    try {
        editor.value?.destroy();
    } catch {}
});

watch(
    () => props.modelValue,
    (val) => {
        if (!editor.value) return;
        if (internalUpdate) return;
    }
);
</script>

<style scoped>
.tiptap-editor {
    min-height: 40px;
    outline: none;
    font: inherit;
}
.tiptap-editor :deep(p) {
    margin: 0 0 0.5rem;
}
.tiptap-editor :deep(pre) {
    background: var(--md-surface-container-lowest);
    padding: 0.5rem;
    border: 1px solid var(--md-outline);
}
.tiptap-editor :deep(.ProseMirror) {
    outline: none;
}
.fade-in {
    opacity: 0;
    animation: fadeInEditor 0.14s ease-out forwards;
}
@keyframes fadeInEditor {
    to {
        opacity: 1;
    }
}
</style>
