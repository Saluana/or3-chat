<template>
    <div
        class="flex flex-col h-full w-full bg-white/10 dark:bg-black/10 backdrop-blur-sm"
    >
        <div class="flex items-center gap-3 px-3 pt-2 pb-2">
            <UButton
                @click="emit('back')"
                variant="outline"
                class="flex items-center justify-center h-[40px] w-[40px]"
                color="neutral"
                icon="pixelarticons:arrow-left"
                aria-label="Back to list"
            />
            <UInput
                v-model="titleDraft"
                placeholder="Untitled Prompt"
                label="Prompt Title"
                size="md"
                :ui="{
                    base: 'retro-shadow',
                }"
                class="flex-1"
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
        <div class="flex-1 min-h-0 overflow-y-auto">
            <div v-if="loading" class="p-6 text-sm text-neutral-500">
                Loading…
            </div>
            <div v-else-if="!record" class="p-6 text-sm text-error">
                Prompt not found.
            </div>
            <div
                v-else
                class="w-full max-h-[70vh] overflow-auto max-w-[820px] mx-auto p-8 pb-24"
            >
                <EditorContent
                    :editor="editor as Editor"
                    class="prose prosemirror-host max-w-none dark:text-white/95 dark:prose-headings:text-white/95 dark:prose-strong:text-white/95 w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px]"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { getPrompt, updatePrompt, type PromptRecord } from '~/db/prompts';

const props = defineProps<{ promptId: string }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const record = ref<PromptRecord | null>(null);
const loading = ref(true);
const titleDraft = ref('');
const editor = ref<Editor | null>(null);
const pendingTitle = ref<string | undefined>();
const pendingContent = ref<any | undefined>();
const saveTimer = ref<any | null>(null);
const status = ref<'idle' | 'saving' | 'error' | 'loading'>('loading');

async function load(id: string) {
    loading.value = true;
    status.value = 'loading';
    try {
        const rec = await getPrompt(id);
        record.value = rec || null;
        if (rec) {
            titleDraft.value = rec.title;
            if (editor.value) {
                editor.value.commands.setContent(
                    rec.content || { type: 'doc', content: [] },
                    { emitUpdate: false }
                );
            }
            status.value = 'idle';
        } else {
            status.value = 'error';
        }
    } catch (e) {
        status.value = 'error';
        console.warn('[PromptEditor] load failed', e);
    } finally {
        loading.value = false;
    }
}

function scheduleSave() {
    if (saveTimer.value) clearTimeout(saveTimer.value);
    saveTimer.value = setTimeout(flush, 600);
}

async function flush() {
    if (!record.value) return;
    if (pendingTitle.value === undefined && pendingContent.value === undefined)
        return;
    status.value = 'saving';
    try {
        const patch: any = {};
        if (pendingTitle.value !== undefined) patch.title = pendingTitle.value;
        if (pendingContent.value !== undefined)
            patch.content = pendingContent.value;
        const updated = await updatePrompt(record.value.id, patch);
        if (updated) {
            record.value = updated;
            titleDraft.value = updated.title;
            status.value = 'idle';
        } else {
            status.value = 'error';
        }
    } catch (e) {
        status.value = 'error';
        console.warn('[PromptEditor] save failed', e);
    } finally {
        pendingTitle.value = undefined;
        pendingContent.value = undefined;
    }
}

function onTitleChange() {
    pendingTitle.value = titleDraft.value;
    scheduleSave();
}

function emitContent() {
    if (!editor.value) return;
    pendingContent.value = editor.value.getJSON();
    scheduleSave();
}

function makeEditor() {
    editor.value = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2] } }),
            Placeholder.configure({
                placeholder: 'Type your system instructions…',
            }),
        ],
        content: record.value?.content || { type: 'doc', content: [] },
        autofocus: false,
        onUpdate: () => emitContent(),
    });
}

onMounted(async () => {
    await load(props.promptId);
    makeEditor();
});

watch(
    () => props.promptId,
    async (id) => {
        await load(id);
    }
);

onBeforeUnmount(() => {
    editor.value?.destroy();
    if (saveTimer.value) clearTimeout(saveTimer.value);
});

const statusText = computed(() => {
    switch (status.value) {
        case 'saving':
            return 'Saving…';
        case 'idle':
            return 'Ready';
        case 'error':
            return 'Error';
        case 'loading':
            return 'Loading…';
    }
});
</script>

<style scoped>
.prose :where(h1, h2) {
    font-family: 'Press Start 2P', monospace;
}
.prosemirror-host :deep(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.85;
}
</style>
