<template>
    <div
        class="prompt-editor-shell flex flex-col h-full w-full bg-white/10 dark:bg-black/10 backdrop-blur-sm"
    >
        <div class="prompt-editor-header flex items-center pb-5">
            <UButton
                v-bind="backButtonProps"
                @click="emit('back')"
                icon="pixelarticons:arrow-left"
                aria-label="Back to list"
            />
            <UInput
                v-model="titleDraft"
                v-bind="promptTitleInputProps"
                class="prompt-editor-title-input flex-1"
                @update:model-value="onTitleChange"
            />
            <div class="prompt-editor-status-wrapper flex items-center gap-1">
                <UTooltip :text="statusText">
                    <span
                        class="prompt-editor-status text-xs opacity-70 w-16 text-right select-none"
                        >{{ statusText }}</span
                    >
                </UTooltip>
            </div>
        </div>
        <div class="prompt-editor-body flex-1 min-h-0 overflow-y-auto">
            <div
                v-if="loading"
                class="prompt-editor-loading p-6 text-sm text-neutral-500"
            >
                Loading…
            </div>
            <div
                v-else-if="!record"
                class="prompt-editor-missing p-6 text-sm text-error"
            >
                Prompt not found.
            </div>
            <div
                v-else
                class="prompt-editor-body-shell w-full max-w-[820px] mx-auto p-8 pb-24"
            >
                <EditorContent
                    :editor="editor as Editor"
                    class="prompt-editor-content prose prosemirror-host max-w-none dark:text-white/95 dark:prose-headings:text-white/95 dark:prose-strong:text-white/95 w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px]"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    onMounted,
    onBeforeUnmount,
    watch,
    computed,
    nextTick,
} from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { getPrompt, updatePrompt, type PromptRecord } from '~/db/prompts';
import { useThemeOverrides } from '~/composables/useThemeResolver';

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

const defaultContent = { type: 'doc', content: [] };

async function ensureEditor(content?: any) {
    if (!import.meta.client) return;
    if (editor.value) {
        if (content) {
            editor.value.commands.setContent(content || defaultContent, {
                emitUpdate: false,
            });
        }
        return;
    }
    await nextTick();
    try {
        editor.value = new Editor({
            extensions: [
                StarterKit.configure({ heading: { levels: [1, 2] } }),
                Placeholder.configure({
                    placeholder: 'Type your system instructions…',
                }),
            ],
            content: content || defaultContent,
            autofocus: false,
            onUpdate: () => emitContent(),
        });
    } catch (error) {
        console.warn('[PromptEditor] failed to initialize editor', error);
    }
}

watch(
    record,
    async (rec) => {
        if (!rec) return;
        await ensureEditor(rec.content || defaultContent);
    },
    { immediate: true }
);

onMounted(async () => {
    await ensureEditor(defaultContent);
    await load(props.promptId);
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

const promptTitleInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'prompt',
        identifier: 'prompt.title',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
    const {
        class: overrideClass = '',
        ui: overrideUi = {},
        ...restOverrides
    } = overridesValue;
    const uiOverrides = (overrideUi as Record<string, any>) || {};
    const baseUi = ['theme-shadow', uiOverrides.base]
        .filter(Boolean)
        .join(' ')
        .trim();
    return {
        placeholder: 'Untitled Prompt',
        label: 'Prompt Title',
        size: 'md' as const,
        ...restOverrides,
        ui: {
            ...uiOverrides,
            base: baseUi,
        },
        class: ['prompt-editor-title-input-base', overrideClass]
            .filter(Boolean)
            .join(' '),
    };
});

const backButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'prompt',
        identifier: 'prompt.back',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
    const { class: overrideClass = '', ...restOverrides } = overridesValue;
    return {
        variant: 'outline' as const,
        size: 'sm' as const,
        class: [
            'prompt-editor-back-btn flex items-center justify-center h-[40px] w-[40px] mr-3',
            overrideClass,
        ]
            .filter(Boolean)
            .join(' '),
        ...restOverrides,
    };
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
    min-height: 100%;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}
.prosemirror-host {
    display: block;
    min-height: 320px;
    width: 100%;
}
.prosemirror-host :deep(p.is-editor-empty:first-child) {
    position: relative;
}
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    pointer-events: none;
    opacity: 0.85;
    position: absolute;
    inset-inline-start: 0;
    inset-block-start: 0;
}
</style>
