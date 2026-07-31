<template>
    <div
        class="prompt-editor-shell flex h-full w-full flex-col bg-[var(--md-surface)]"
    >
        <div
            class="prompt-editor-header flex shrink-0 items-center gap-2 border-b border-[var(--md-border-color)] p-3 sm:p-4"
        >
            <UButton
                v-bind="backButtonProps"
                @click="handleBack"
                :icon="useIcon('shell.back').value"
                aria-label="Back to list"
            />
            <UInput
                v-model="titleDraft"
                v-bind="promptTitleInputProps"
                class="prompt-editor-title-input flex-1"
                @update:model-value="onTitleChange"
            />
            <UButton
                v-if="record"
                v-bind="favoriteButtonProps"
                :icon="
                    record.favorite
                        ? useIcon('catalog.star.filled').value
                        : useIcon('catalog.star').value
                "
                :aria-label="
                    record.favorite
                        ? 'Remove from favorites'
                        : 'Add to favorites'
                "
                :aria-pressed="record.favorite"
                @click="toggleFavorite"
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
                class="prompt-editor-body-shell mx-auto w-full max-w-[900px] p-4 pb-24 sm:p-8"
            >
                <div
                    class="mb-5 rounded-[var(--md-border-radius)] border border-[var(--md-border-color)] p-3"
                >
                    <div
                        class="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]"
                    >
                        Tags
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <button
                            v-for="tag in record.tags"
                            :key="tag"
                            type="button"
                            class="inline-flex items-center gap-1 rounded-full border border-[var(--md-border-color)] px-2.5 py-1 text-xs hover:bg-[var(--md-surface-hover)]"
                            :aria-label="`Remove ${tag} tag`"
                            @click="removeTag(tag)"
                        >
                            {{ tag }}
                            <UIcon
                                :name="useIcon('ui.close').value"
                                class="h-3 w-3"
                            />
                        </button>
                        <span
                            v-if="!record.tags.length"
                            class="text-xs text-[var(--md-on-surface-variant)]"
                        >
                            No tags
                        </span>
                    </div>
                    <div class="mt-2 flex items-center gap-2">
                        <UInput
                            v-model="tagDraft"
                            size="sm"
                            class="min-w-0 flex-1"
                            placeholder="Add a tag"
                            aria-label="Add prompt tag"
                            @keydown.enter.prevent="addTag"
                        />
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="outline"
                            :disabled="!tagDraft.trim()"
                            @click="addTag"
                        >
                            Add
                        </UButton>
                    </div>
                </div>
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
import { Placeholder } from '@tiptap/extensions/placeholder';
import { useDebounceFn } from '@vueuse/core';
import {
    getPrompt,
    updatePrompt,
    type PromptRecord,
    type UpdatePromptPatch,
} from '~/db/prompts';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';

const props = defineProps<{ promptId: string }>();
const emit = defineEmits<{
    (e: 'back'): void;
    (e: 'saved', prompt: PromptRecord): void;
}>();

const record = ref<PromptRecord | null>(null);
const loading = ref(true);
const titleDraft = ref('');
const editor = ref<Editor | null>(null);
const pendingTitle = ref<string | undefined>();
const pendingContent = ref<any | undefined>();
const tagDraft = ref('');
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

const scheduleSave = useDebounceFn(() => {
    void flush();
}, 600);

async function flush() {
    if (!record.value) return;
    if (pendingTitle.value === undefined && pendingContent.value === undefined)
        return;
    status.value = 'saving';
    try {
        const patch: UpdatePromptPatch = {};
        if (pendingTitle.value !== undefined) patch.title = pendingTitle.value;
        if (pendingContent.value !== undefined)
            patch.content = pendingContent.value;
        const updated = await updatePrompt(record.value.id, patch);
        if (updated) {
            record.value = updated;
            titleDraft.value = updated.title;
            status.value = 'idle';
            emit('saved', updated);
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

async function updateMetadata(patch: UpdatePromptPatch) {
    if (!record.value) return;
    status.value = 'saving';
    try {
        const updated = await updatePrompt(record.value.id, patch);
        if (!updated) {
            status.value = 'error';
            return;
        }
        record.value = updated;
        status.value = 'idle';
        emit('saved', updated);
    } catch (error) {
        status.value = 'error';
        console.warn('[PromptEditor] metadata save failed', error);
    }
}

function toggleFavorite() {
    if (!record.value) return;
    void updateMetadata({ favorite: !record.value.favorite });
}

function addTag() {
    if (!record.value) return;
    const tag = tagDraft.value.trim();
    if (!tag) return;
    tagDraft.value = '';
    void updateMetadata({ tags: [...record.value.tags, tag] });
}

function removeTag(tagToRemove: string) {
    if (!record.value) return;
    const key = tagToRemove.toLocaleLowerCase();
    void updateMetadata({
        tags: record.value.tags.filter(
            (tag) => tag.toLocaleLowerCase() !== key
        ),
    });
}

async function handleBack() {
    const cancel = (scheduleSave as unknown as { cancel?: () => void }).cancel;
    cancel?.();
    await flush();
    emit('back');
}

function onTitleChange() {
    pendingTitle.value = titleDraft.value;
    scheduleSave();
}

function emitContent() {
    if (!editor.value || editor.value.isDestroyed) return;
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
    // vueuse's useDebounceFn returns a callable with a cancel() method
    const cancel = (scheduleSave as unknown as { cancel?: () => void }).cancel;
    cancel?.();
    void flush();
    editor.value?.destroy();
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
    return {
        variant: 'outline' as const,
        size: 'sm' as const,
        ...buildThemeOverrideProps(overrides.value, {
            baseClass:
                'prompt-editor-back-btn flex items-center justify-center h-[36px] w-[36px]',
        }),
    };
});

const favoriteButtonProps = computed(() => ({
    variant: 'ghost' as const,
    color: 'neutral' as const,
    size: 'sm' as const,
    square: true,
}));

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
