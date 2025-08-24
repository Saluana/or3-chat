<template>
    <div class="relative min-h-[40px]">
        <component
            v-if="client && ready"
            :is="EditorContentCmp"
            :editor="editor"
            class="tiptap-editor fade-in"
        />
        <!-- No loading text; blank space avoids visual glitch -->
    </div>
</template>
<script setup lang="ts">
import {
    ref,
    watch,
    onMounted,
    onBeforeUnmount,
    nextTick,
    defineAsyncComponent,
} from 'vue';

const props = defineProps<{
    modelValue: string;
    autofocus?: boolean;
    focusDelay?: number; // ms delay before focusing when autofocus true
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: string): void;
    (e: 'ready'): void;
}>();

const client = ref(false);
const editor = ref<any>(null);
const ready = ref(false);
let destroy: (() => void) | null = null;
// Dynamically load EditorContent only on client
const EditorContentCmp = defineAsyncComponent(async () => {
    const mod: any = await import('@tiptap/vue-3');
    return mod.EditorContent;
});

async function init() {
    const [{ Editor }, { default: StarterKit }] = await Promise.all([
        import('@tiptap/vue-3'),
        import('@tiptap/starter-kit'),
    ]);
    const extensions = [StarterKit.configure({ codeBlock: {} })];
    const instance = new Editor({
        extensions,
        content: props.modelValue,
        onUpdate: ({ editor }: any) => {
            emit('update:modelValue', editor.getText());
        },
    });
    editor.value = instance;
    destroy = () => instance.destroy();
    ready.value = true;
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
    emit('ready');
}

onMounted(() => {
    client.value = true;
    init();
});
onBeforeUnmount(() => {
    if (destroy) destroy();
});

watch(
    () => props.modelValue,
    (val) => {
        if (!editor.value) return;
        // Prevent circular update; only set if changed
        const currentText = editor.value.getText() as string;
        if (val !== currentText) {
            editor.value.commands.setContent(val, false);
        }
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
