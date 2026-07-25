<template>
    <UModal
        v-bind="systemPromptsModalProps"
        v-model:open="open"
        title="System Prompts"
        description="Browse, organize, edit, and apply system prompts."
    >
        <template #header>
            <div
                class="flex w-full items-center justify-between gap-3 px-1"
                data-test="system-prompts-header"
            >
                <div class="min-w-0">
                    <h2 class="m-0 truncate text-lg font-semibold">
                        System Prompts
                    </h2>
                    <p
                        class="m-0 hidden text-xs text-[var(--md-on-surface-variant)] sm:block"
                    >
                        Browse, organize, edit, and apply system prompts.
                    </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                    <UButton
                        v-bind="iconButtonProps"
                        class="sm:hidden"
                        data-test="system-prompts-new"
                        :icon="plusIcon"
                        aria-label="New Prompt"
                        @click="createNewPrompt"
                    />
                    <UButton
                        v-bind="newPromptButtonProps"
                        class="hidden sm:inline-flex"
                        data-test="system-prompts-new-desktop"
                        :icon="plusIcon"
                        @click="createNewPrompt"
                    >
                        New Prompt
                    </UButton>
                    <UButton
                        v-bind="iconButtonProps"
                        :icon="closeIcon"
                        aria-label="Close system prompts"
                        @click="open = false"
                    />
                </div>
            </div>
        </template>

        <template #body>
            <div
                class="system-prompts-shell relative flex h-full min-h-0 flex-col bg-[var(--md-surface)] text-[var(--md-on-surface)]"
                data-test="system-prompts-modal"
                @keydown="handleKeydown"
            >
                <div
                    v-if="deleteConfirmPrompt"
                    class="absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="delete-prompt-title"
                >
                    <div
                        class="w-full max-w-md rounded-[var(--md-border-radius)] border border-[var(--md-border-color)] bg-[var(--md-surface)] p-5 shadow-xl"
                    >
                        <h3
                            id="delete-prompt-title"
                            class="m-0 text-base font-semibold"
                        >
                            Delete system prompt?
                        </h3>
                        <p
                            class="mb-5 mt-2 text-sm text-[var(--md-on-surface-variant)]"
                        >
                            “{{ deleteConfirmPrompt.title || 'Untitled Prompt' }}”
                            will be removed from your prompt library.
                        </p>
                        <div class="flex justify-end gap-2">
                            <UButton
                                color="neutral"
                                variant="outline"
                                @click="deleteConfirmId = null"
                            >
                                Cancel
                            </UButton>
                            <UButton
                                color="error"
                                data-test="system-prompts-confirm-delete"
                                @click="confirmDeletePrompt"
                            >
                                Delete prompt
                            </UButton>
                        </div>
                    </div>
                </div>

                <div
                    v-if="errorMessage"
                    class="shrink-0 border-b border-[var(--md-border-color)] bg-error/10 px-4 py-2 text-sm text-error"
                    role="alert"
                >
                    {{ errorMessage }}
                </div>

                <div
                    v-if="view === 'edit' && editingPromptId"
                    class="flex min-h-0 flex-1 flex-col"
                    data-test="system-prompts-editor"
                >
                    <LazyPromptsPromptEditor
                        :prompt-id="editingPromptId"
                        @back="stopEditing"
                        @saved="handleEditorSaved"
                    />
                </div>

                <div
                    v-else
                    class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_340px] xl:grid-cols-[240px_minmax(0,1fr)_370px]"
                >
                    <aside
                        class="hidden min-h-0 flex-col overflow-y-auto border-r border-[var(--md-border-color)] p-4 lg:flex"
                        aria-label="Prompt library filters"
                    >
                        <div
                            class="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]"
                        >
                            Library
                        </div>
                        <button
                            type="button"
                            :class="filterButtonClass(scope === 'all' && !selectedTag)"
                            @click="setScope('all')"
                        >
                            <UIcon :name="allIcon" class="h-4 w-4" />
                            <span>All prompts</span>
                            <span class="ml-auto tabular-nums">{{
                                prompts.length
                            }}</span>
                        </button>
                        <button
                            type="button"
                            :class="filterButtonClass(scope === 'favorites')"
                            @click="setScope('favorites')"
                        >
                            <UIcon :name="starIcon" class="h-4 w-4" />
                            <span>Favorites</span>
                            <span class="ml-auto tabular-nums">{{
                                favoriteCount
                            }}</span>
                        </button>

                        <div
                            class="my-4 border-t border-[var(--md-border-color)]"
                        />
                        <div
                            class="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]"
                        >
                            Tags
                        </div>
                        <button
                            v-for="entry in tagCounts"
                            :key="entry.key"
                            type="button"
                            :class="filterButtonClass(selectedTagKey === entry.key)"
                            @click="selectTag(entry.label)"
                        >
                            <span class="truncate">{{ entry.label }}</span>
                            <span class="ml-auto tabular-nums">{{
                                entry.count
                            }}</span>
                        </button>
                        <p
                            v-if="!tagCounts.length"
                            class="px-2 text-xs text-[var(--md-on-surface-variant)]"
                        >
                            Add tags from a prompt’s detail or editor view.
                        </p>
                    </aside>

                    <section
                        class="min-h-0 min-w-0 flex-col"
                        :class="view === 'detail' ? 'hidden lg:flex' : 'flex'"
                        data-test="system-prompts-library"
                    >
                        <div
                            class="shrink-0 border-b border-[var(--md-border-color)] px-3 py-3 sm:px-4"
                        >
                            <div class="flex items-center gap-2">
                                <UInput
                                    ref="searchInputRef"
                                    v-model="searchQuery"
                                    v-bind="searchInputProps"
                                    class="min-w-0 flex-1"
                                    data-test="system-prompts-search"
                                    autofocus
                                />
                                <UPopover>
                                    <UButton
                                        v-bind="iconButtonProps"
                                        class="lg:hidden"
                                        :icon="filterIcon"
                                        aria-label="Filter prompts"
                                    />
                                    <template #content>
                                        <div
                                            class="flex w-64 flex-col gap-1 p-2"
                                            aria-label="Prompt filters"
                                        >
                                            <button
                                                type="button"
                                                :class="
                                                    filterButtonClass(
                                                        scope === 'all' &&
                                                            !selectedTag
                                                    )
                                                "
                                                @click="setScope('all')"
                                            >
                                                All prompts
                                                <span class="ml-auto">{{
                                                    prompts.length
                                                }}</span>
                                            </button>
                                            <button
                                                type="button"
                                                :class="
                                                    filterButtonClass(
                                                        scope === 'favorites'
                                                    )
                                                "
                                                @click="setScope('favorites')"
                                            >
                                                Favorites
                                                <span class="ml-auto">{{
                                                    favoriteCount
                                                }}</span>
                                            </button>
                                            <div
                                                v-if="tagCounts.length"
                                                class="my-1 border-t border-[var(--md-border-color)]"
                                            />
                                            <button
                                                v-for="entry in tagCounts"
                                                :key="`mobile-${entry.key}`"
                                                type="button"
                                                :class="
                                                    filterButtonClass(
                                                        selectedTagKey ===
                                                            entry.key
                                                    )
                                                "
                                                @click="selectTag(entry.label)"
                                            >
                                                {{ entry.label }}
                                                <span class="ml-auto">{{
                                                    entry.count
                                                }}</span>
                                            </button>
                                        </div>
                                    </template>
                                </UPopover>
                            </div>

                            <div
                                class="mt-3 flex items-center justify-between gap-2"
                            >
                                <span
                                    class="text-xs text-[var(--md-on-surface-variant)]"
                                    aria-live="polite"
                                >
                                    {{ visiblePrompts.length }}
                                    {{
                                        visiblePrompts.length === 1
                                            ? 'prompt'
                                            : 'prompts'
                                    }}
                                </span>
                                <USelectMenu
                                    v-model="sort"
                                    :items="sortItems"
                                    value-key="value"
                                    size="sm"
                                    class="w-[168px]"
                                    aria-label="Sort prompts"
                                />
                            </div>
                        </div>

                        <div class="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
                            <div
                                v-if="loading"
                                class="flex h-full items-center justify-center text-sm text-[var(--md-on-surface-variant)]"
                            >
                                Loading prompts…
                            </div>
                            <div
                                v-else-if="!visiblePrompts.length"
                                class="flex h-full min-h-64 flex-col items-center justify-center p-8 text-center"
                            >
                                <UIcon
                                    :name="promptIcon"
                                    class="mb-3 h-10 w-10 opacity-40"
                                />
                                <h3 class="m-0 text-base font-semibold">
                                    {{
                                        prompts.length
                                            ? 'No matching prompts'
                                            : 'No system prompts yet'
                                    }}
                                </h3>
                                <p
                                    class="mb-4 mt-1 max-w-sm text-sm text-[var(--md-on-surface-variant)]"
                                >
                                    {{
                                        prompts.length
                                            ? 'Try a different search or filter.'
                                            : 'Create your first prompt to customize AI behavior.'
                                    }}
                                </p>
                                <UButton
                                    v-if="!prompts.length"
                                    v-bind="newPromptButtonProps"
                                    @click="createNewPrompt"
                                >
                                    Create prompt
                                </UButton>
                            </div>

                            <div v-else class="flex flex-col gap-2">
                                <article
                                    v-for="prompt in visiblePrompts"
                                    :key="prompt.id"
                                    class="group cursor-pointer rounded-[var(--md-border-radius)] border bg-[var(--md-surface)] p-3 transition-colors hover:bg-[var(--md-surface-hover)] sm:p-3.5"
                                    :class="
                                        prompt.id === selectedPromptId
                                            ? 'border-[var(--md-primary)] ring-1 ring-[var(--md-primary)]/20'
                                            : 'border-[var(--md-border-color)]'
                                    "
                                    :data-test="`system-prompt-row-${prompt.id}`"
                                    tabindex="0"
                                    @click="selectPromptForDetail(prompt.id)"
                                    @keydown.enter="
                                        selectPromptForDetail(prompt.id)
                                    "
                                >
                                    <div class="flex items-start gap-3">
                                        <div class="min-w-0 flex-1">
                                            <div
                                                class="flex flex-wrap items-center gap-2"
                                            >
                                                <h3
                                                    class="m-0 truncate text-sm font-semibold"
                                                >
                                                    {{
                                                        prompt.title ||
                                                        'Untitled Prompt'
                                                    }}
                                                </h3>
                                                <span
                                                    v-if="
                                                        prompt.id ===
                                                        defaultPromptId
                                                    "
                                                    class="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                                                >
                                                    Default
                                                </span>
                                                <span
                                                    v-if="
                                                        prompt.id ===
                                                            currentActivePromptId &&
                                                        prompt.id !==
                                                            defaultPromptId
                                                    "
                                                    class="rounded bg-[var(--md-surface-variant)] px-2 py-0.5 text-[10px]"
                                                >
                                                    Active
                                                </span>
                                            </div>
                                            <p
                                                class="mb-0 mt-1 line-clamp-2 text-xs text-[var(--md-on-surface-variant)]"
                                            >
                                                {{
                                                    promptExcerpt(prompt) ||
                                                    'No prompt content yet.'
                                                }}
                                            </p>
                                            <div
                                                class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--md-on-surface-variant)]"
                                            >
                                                <span
                                                    >Updated
                                                    {{
                                                        formatDate(
                                                            prompt.updated_at
                                                        )
                                                    }}</span
                                                >
                                                <span aria-hidden="true">•</span>
                                                <span
                                                    >{{
                                                        tokenCounts[prompt.id] ||
                                                        0
                                                    }}
                                                    tokens</span
                                                >
                                                <template
                                                    v-if="prompt.tags.length"
                                                >
                                                    <span aria-hidden="true"
                                                        >•</span
                                                    >
                                                    <span class="truncate">{{
                                                        prompt.tags.join(', ')
                                                    }}</span>
                                                </template>
                                            </div>
                                        </div>
                                        <div
                                            class="flex shrink-0 items-center gap-1"
                                        >
                                            <UButton
                                                v-bind="iconButtonProps"
                                                :icon="
                                                    prompt.favorite
                                                        ? starFilledIcon
                                                        : starIcon
                                                "
                                                :aria-label="
                                                    prompt.favorite
                                                        ? 'Remove from favorites'
                                                        : 'Add to favorites'
                                                "
                                                :aria-pressed="prompt.favorite"
                                                @click.stop="
                                                    toggleFavorite(prompt)
                                                "
                                            />
                                            <UPopover>
                                                <UButton
                                                    v-bind="iconButtonProps"
                                                    :icon="moreIcon"
                                                    aria-label="Prompt actions"
                                                    @click.stop
                                                />
                                                <template #content>
                                                    <div
                                                        class="flex w-40 flex-col p-1"
                                                    >
                                                        <UButton
                                                            variant="ghost"
                                                            color="neutral"
                                                            class="justify-start"
                                                            :icon="editIcon"
                                                            @click="
                                                                startEditing(
                                                                    prompt.id
                                                                )
                                                            "
                                                        >
                                                            Edit
                                                        </UButton>
                                                        <UButton
                                                            variant="ghost"
                                                            color="neutral"
                                                            class="justify-start"
                                                            :icon="
                                                                prompt.id ===
                                                                defaultPromptId
                                                                    ? clearIcon
                                                                    : defaultIcon
                                                            "
                                                            @click="
                                                                toggleDefault(
                                                                    prompt.id
                                                                )
                                                            "
                                                        >
                                                            {{
                                                                prompt.id ===
                                                                defaultPromptId
                                                                    ? 'Clear default'
                                                                    : 'Set default'
                                                            }}
                                                        </UButton>
                                                        <UButton
                                                            variant="ghost"
                                                            color="error"
                                                            class="justify-start"
                                                            :icon="trashIcon"
                                                            @click="
                                                                requestDeletePrompt(
                                                                    prompt.id
                                                                )
                                                            "
                                                        >
                                                            Delete
                                                        </UButton>
                                                    </div>
                                                </template>
                                            </UPopover>
                                        </div>
                                    </div>
                                </article>
                            </div>
                        </div>
                    </section>

                    <aside
                        class="min-h-0 flex-col border-l border-[var(--md-border-color)]"
                        :class="view === 'detail' ? 'flex' : 'hidden lg:flex'"
                        data-test="system-prompts-detail"
                    >
                        <template v-if="selectedPrompt">
                            <div
                                class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-5"
                            >
                                <button
                                    type="button"
                                    class="mb-3 inline-flex w-fit items-center gap-1 text-sm text-[var(--md-on-surface-variant)] lg:hidden"
                                    @click="view = 'library'"
                                >
                                    <UIcon
                                        :name="backIcon"
                                        class="h-4 w-4"
                                    />
                                    Back to prompts
                                </button>

                                <div class="flex items-start gap-2">
                                    <div class="min-w-0 flex-1">
                                        <h3
                                            class="m-0 text-lg font-semibold leading-tight"
                                        >
                                            {{
                                                selectedPrompt.title ||
                                                'Untitled Prompt'
                                            }}
                                        </h3>
                                        <p
                                            class="mb-0 mt-2 text-sm text-[var(--md-on-surface-variant)]"
                                        >
                                            {{
                                                promptExcerpt(selectedPrompt) ||
                                                'No prompt content yet.'
                                            }}
                                        </p>
                                    </div>
                                    <UButton
                                        v-bind="iconButtonProps"
                                        :icon="
                                            selectedPrompt.favorite
                                                ? starFilledIcon
                                                : starIcon
                                        "
                                        :aria-label="
                                            selectedPrompt.favorite
                                                ? 'Remove from favorites'
                                                : 'Add to favorites'
                                        "
                                        :aria-pressed="selectedPrompt.favorite"
                                        @click="toggleFavorite(selectedPrompt)"
                                    />
                                </div>

                                <div
                                    class="mt-5 text-[11px] font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]"
                                >
                                    Prompt preview
                                </div>
                                <div
                                    class="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[var(--md-border-radius)] border border-[var(--md-border-color)] p-3 text-sm leading-relaxed"
                                >
                                    {{
                                        promptText(selectedPrompt) ||
                                        'This prompt is empty.'
                                    }}
                                </div>

                                <dl
                                    class="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm"
                                >
                                    <dt
                                        class="text-[var(--md-on-surface-variant)]"
                                    >
                                        Updated
                                    </dt>
                                    <dd class="m-0 text-right">
                                        {{
                                            formatDate(
                                                selectedPrompt.updated_at
                                            )
                                        }}
                                    </dd>
                                    <dt
                                        class="text-[var(--md-on-surface-variant)]"
                                    >
                                        Tokens
                                    </dt>
                                    <dd class="m-0 text-right">
                                        {{
                                            tokenCounts[selectedPrompt.id] || 0
                                        }}
                                    </dd>
                                    <dt
                                        class="text-[var(--md-on-surface-variant)]"
                                    >
                                        Default
                                    </dt>
                                    <dd class="m-0 text-right">
                                        {{
                                            selectedPrompt.id ===
                                            defaultPromptId
                                                ? 'Yes'
                                                : 'No'
                                        }}
                                    </dd>
                                </dl>

                                <div
                                    class="mt-5 text-[11px] font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]"
                                >
                                    Tags
                                </div>
                                <div class="mt-2 flex flex-wrap gap-2">
                                    <button
                                        v-for="tag in selectedPrompt.tags"
                                        :key="tag"
                                        type="button"
                                        class="inline-flex items-center gap-1 rounded-full border border-[var(--md-border-color)] px-2.5 py-1 text-xs hover:bg-[var(--md-surface-hover)]"
                                        :aria-label="`Remove ${tag} tag`"
                                        @click="removeTag(selectedPrompt, tag)"
                                    >
                                        {{ tag }}
                                        <UIcon
                                            :name="closeIcon"
                                            class="h-3 w-3"
                                        />
                                    </button>
                                    <span
                                        v-if="!selectedPrompt.tags.length"
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
                                        @keydown.enter.prevent="
                                            addTag(selectedPrompt)
                                        "
                                    />
                                    <UButton
                                        size="sm"
                                        color="neutral"
                                        variant="outline"
                                        :disabled="!tagDraft.trim()"
                                        @click="addTag(selectedPrompt)"
                                    >
                                        Add
                                    </UButton>
                                </div>

                                <div class="mt-5 flex flex-wrap gap-2">
                                    <UButton
                                        color="neutral"
                                        variant="outline"
                                        :icon="editIcon"
                                        @click="
                                            startEditing(selectedPrompt.id)
                                        "
                                    >
                                        Edit
                                    </UButton>
                                    <UButton
                                        color="neutral"
                                        variant="outline"
                                        :icon="defaultIcon"
                                        @click="
                                            toggleDefault(selectedPrompt.id)
                                        "
                                    >
                                        {{
                                            selectedPrompt.id ===
                                            defaultPromptId
                                                ? 'Clear default'
                                                : 'Set default'
                                        }}
                                    </UButton>
                                </div>
                            </div>

                            <div
                                class="shrink-0 border-t border-[var(--md-border-color)] p-4"
                            >
                                <UButton
                                    block
                                    size="lg"
                                    color="primary"
                                    :disabled="!canUseInChat"
                                    :title="
                                        canUseInChat
                                            ? 'Apply this prompt to the active chat'
                                            : 'Open prompts from a chat to apply one'
                                    "
                                    data-test="system-prompts-use"
                                    @click="useSelectedPrompt"
                                >
                                    {{
                                        selectedPrompt.id ===
                                        currentActivePromptId
                                            ? 'Selected for chat'
                                            : 'Use in chat'
                                    }}
                                </UButton>
                            </div>
                        </template>

                        <div
                            v-else
                            class="flex h-full items-center justify-center p-8 text-center text-sm text-[var(--md-on-surface-variant)]"
                        >
                            Select a prompt to see its details.
                        </div>
                    </aside>
                </div>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
    createPrompt,
    listPrompts,
    softDeletePrompt,
    updatePrompt,
    type PromptRecord,
} from '~/db/prompts';
import {
    getThreadSystemPrompt,
    updateThreadSystemPrompt,
} from '~/db/threads';
import {
    clearPanePendingPrompt,
    getPanePendingPrompt,
    setPanePendingPrompt,
} from '~/composables/core/usePanePrompt';
import { useActivePrompt } from '~/composables/chat/useActivePrompt';
import { useDefaultPrompt } from '~/composables/chat/useDefaultPrompt';
import { useTokenizer } from '~/composables/core/useTokenizer';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import type { SystemPromptsModalMode } from '~/composables/chat/useSystemPromptsModal';

const props = withDefaults(
    defineProps<{
        showModal: boolean;
        mode?: SystemPromptsModalMode;
        promptId?: string;
        threadId?: string;
        paneId?: string;
    }>(),
    { mode: 'home' }
);

const emit = defineEmits<{
    (event: 'update:showModal', value: boolean): void;
    (event: 'selected', id: string): void;
    (event: 'closed'): void;
}>();

const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

type LibraryScope = 'all' | 'favorites';
type ModalView = 'library' | 'detail' | 'edit';
type PromptSort = 'updated' | 'title';

const prompts = ref<PromptRecord[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const searchQuery = ref('');
const scope = ref<LibraryScope>('all');
const selectedTag = ref<string | null>(null);
const sort = ref<PromptSort>('updated');
const selectedPromptId = ref<string | null>(null);
const editingPromptId = ref<string | null>(null);
const view = ref<ModalView>('library');
const tagDraft = ref('');
const deleteConfirmId = ref<string | null>(null);
const threadPromptId = ref<string | null>(null);
const pendingPromptId = ref<string | null>(null);
const searchInputRef = ref<{ inputRef?: HTMLInputElement } | null>(null);
let openGeneration = 0;
let promptEditorLoadPromise: Promise<unknown> | null = null;

const { activePromptId, clearActivePrompt } = useActivePrompt();
const { defaultPromptId, setDefaultPrompt, clearDefaultPrompt } =
    useDefaultPrompt();
const { countTokensBatch } = useTokenizer();
const tokenCounts = ref<Record<string, number>>({});
let tokenCountGeneration = 0;

const closeIcon = useIcon('ui.close');
const allIcon = useIcon('catalog.all');
const starIcon = useIcon('catalog.star');
const starFilledIcon = useIcon('catalog.star.filled');
const filterIcon = useIcon('ui.filter');
const promptIcon = useIcon('chat.system_prompt');
const moreIcon = useIcon('ui.more');
const editIcon = useIcon('ui.edit');
const trashIcon = useIcon('ui.trash');
const backIcon = useIcon('shell.back');
const defaultIcon = useIcon('catalog.star');
const clearIcon = useIcon('ui.close');
const plusIcon = useIcon('ui.plus');

const currentActivePromptId = computed(() => {
    if (props.threadId) return threadPromptId.value;
    if (props.paneId) return pendingPromptId.value ?? activePromptId.value;
    return activePromptId.value;
});

const canUseInChat = computed(
    () => Boolean(props.threadId || props.paneId)
);
const selectedPrompt = computed(
    () =>
        prompts.value.find(
            (prompt) => prompt.id === selectedPromptId.value
        ) ?? null
);
const deleteConfirmPrompt = computed(
    () =>
        prompts.value.find(
            (prompt) => prompt.id === deleteConfirmId.value
        ) ?? null
);
const favoriteCount = computed(
    () => prompts.value.filter((prompt) => prompt.favorite).length
);
const selectedTagKey = computed(
    () => selectedTag.value?.toLocaleLowerCase() ?? null
);
const tagCounts = computed(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const prompt of prompts.value) {
        for (const tag of prompt.tags) {
            const key = tag.toLocaleLowerCase();
            const entry = counts.get(key);
            if (entry) entry.count += 1;
            else counts.set(key, { label: tag, count: 1 });
        }
    }
    return [...counts.entries()]
        .map(([key, entry]) => ({ key, ...entry }))
        .sort((a, b) => a.label.localeCompare(b.label));
});

const visiblePrompts = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase();
    const tagKey = selectedTagKey.value;
    const filtered = prompts.value.filter((prompt) => {
        if (scope.value === 'favorites' && !prompt.favorite) return false;
        if (
            tagKey &&
            !prompt.tags.some(
                (tag) => tag.toLocaleLowerCase() === tagKey
            )
        ) {
            return false;
        }
        if (!query) return true;
        return [
            prompt.title,
            promptText(prompt),
            prompt.tags.join(' '),
            prompt.favorite ? 'favorite' : '',
        ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query);
    });
    return filtered.sort((a, b) =>
        sort.value === 'title'
            ? a.title.localeCompare(b.title)
            : b.updated_at - a.updated_at
    );
});

const sortItems = [
    { label: 'Recently updated', value: 'updated' },
    { label: 'Title A–Z', value: 'title' },
];

const systemPromptsModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'modal',
    identifier: 'modal.system-prompts',
    isNuxtUI: true,
});

const systemPromptsModalProps = computed(() => {
    const overrideValue =
        (systemPromptsModalOverrides.value as Record<string, unknown>) || {};
    const overrideUi =
        (overrideValue.ui as Record<string, unknown> | undefined) || {};
    const overrideClass =
        typeof overrideValue.class === 'string' ? overrideValue.class : '';
    const rest = Object.fromEntries(
        Object.entries(overrideValue).filter(
            ([key]) => key !== 'class' && key !== 'ui'
        )
    );
    return {
        ...rest,
        class: [
            'sp-modal w-[96dvw] max-w-[1450px] h-[92dvh] max-h-[900px] overflow-hidden',
            overrideClass,
        ]
            .filter(Boolean)
            .join(' '),
        ui: {
            body: 'p-0! min-h-0 flex-1 overflow-hidden',
            header: 'border-b border-[var(--md-border-color)]',
            content: 'flex flex-col min-h-0',
            ...overrideUi,
        },
    };
});

const newPromptButtonProps = computed(() => ({
    size: 'sm' as const,
    color: 'primary' as const,
}));

const iconButtonProps = computed(() => ({
    size: 'sm' as const,
    color: 'neutral' as const,
    variant: 'ghost' as const,
    square: true,
}));

const searchInputProps = computed(() => ({
    size: 'sm' as const,
    placeholder: 'Search prompts…',
    icon: useIcon('ui.search').value,
}));

function filterButtonClass(active: boolean) {
    return [
        'flex w-full items-center gap-2 rounded-[var(--md-border-radius)] px-2.5 py-2 text-left text-sm transition-colors',
        active
            ? 'bg-primary/10 font-medium text-primary'
            : 'hover:bg-[var(--md-surface-hover)]',
    ];
}

function extractText(node: unknown): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (typeof node !== 'object') return '';
    const record = node as {
        type?: unknown;
        text?: unknown;
        content?: unknown;
    };
    let text =
        record.type === 'text' && typeof record.text === 'string'
            ? record.text
            : '';
    if (Array.isArray(record.content)) {
        text += record.content.map(extractText).join('');
    }
    if (
        typeof record.type === 'string' &&
        ['paragraph', 'heading', 'listItem'].includes(record.type)
    ) {
        text += '\n';
    }
    return text;
}

function promptText(prompt: PromptRecord): string {
    return extractText(prompt.content).replace(/\n{2,}/g, '\n').trim();
}

function promptExcerpt(prompt: PromptRecord): string {
    const text = promptText(prompt);
    return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString();
}

async function loadPrompts(): Promise<void> {
    loading.value = true;
    errorMessage.value = '';
    try {
        prompts.value = await listPrompts();
        if (
            defaultPromptId.value &&
            !prompts.value.some(
                (prompt) => prompt.id === defaultPromptId.value
            )
        ) {
            await clearDefaultPrompt();
        }
        if (
            selectedPromptId.value &&
            !prompts.value.some(
                (prompt) => prompt.id === selectedPromptId.value
            )
        ) {
            selectedPromptId.value = null;
        }
        selectedPromptId.value ??= prompts.value[0]?.id ?? null;
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : 'Failed to load prompts.';
    } finally {
        loading.value = false;
    }
}

async function loadSelectionContext(): Promise<void> {
    if (props.threadId) {
        threadPromptId.value =
            (await getThreadSystemPrompt(props.threadId)) ?? null;
    } else {
        threadPromptId.value = null;
    }
    pendingPromptId.value = props.paneId
        ? getPanePendingPrompt(props.paneId) ?? null
        : null;
}

async function initializeForOpen(): Promise<void> {
    const generation = ++openGeneration;
    view.value = 'library';
    editingPromptId.value = null;
    tagDraft.value = '';
    await Promise.all([loadPrompts(), loadSelectionContext()]);
    if (generation !== openGeneration || !props.showModal) return;

    if (props.mode === 'new') {
        await createNewPrompt();
        return;
    }
    if (props.mode === 'edit' && props.promptId) {
        if (prompts.value.some((prompt) => prompt.id === props.promptId)) {
            await startEditing(props.promptId);
        } else {
            errorMessage.value = 'That prompt no longer exists.';
        }
        return;
    }
    selectedPromptId.value =
        currentActivePromptId.value ??
        selectedPromptId.value ??
        prompts.value[0]?.id ??
        null;
    await nextTick();
    searchInputRef.value?.inputRef?.focus();
}

async function ensurePromptEditorLoaded(): Promise<void> {
    if (!import.meta.client) return;
    if (!promptEditorLoadPromise) {
        promptEditorLoadPromise = import(
            '~/components/prompts/PromptEditor.vue'
        ).catch((error) => {
            promptEditorLoadPromise = null;
            throw error;
        });
    }
    await promptEditorLoadPromise;
}

async function createNewPrompt(): Promise<void> {
    try {
        const prompt = await createPrompt();
        prompts.value.unshift(prompt);
        selectedPromptId.value = prompt.id;
        await startEditing(prompt.id);
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : 'Failed to create prompt.';
    }
}

async function startEditing(id: string): Promise<void> {
    try {
        await ensurePromptEditorLoaded();
        editingPromptId.value = id;
        selectedPromptId.value = id;
        view.value = 'edit';
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : 'Failed to open editor.';
    }
}

async function stopEditing(): Promise<void> {
    await loadPrompts();
    editingPromptId.value = null;
    view.value = 'detail';
}

function handleEditorSaved(prompt: PromptRecord): void {
    replacePrompt(prompt);
}

function selectPromptForDetail(id: string): void {
    selectedPromptId.value = id;
    tagDraft.value = '';
    view.value = 'detail';
}

function setScope(nextScope: LibraryScope): void {
    scope.value = nextScope;
    selectedTag.value = null;
}

function selectTag(tag: string): void {
    selectedTag.value =
        selectedTagKey.value === tag.toLocaleLowerCase() ? null : tag;
    scope.value = 'all';
}

function replacePrompt(prompt: PromptRecord): void {
    const index = prompts.value.findIndex((entry) => entry.id === prompt.id);
    if (index === -1) prompts.value.unshift(prompt);
    else prompts.value.splice(index, 1, prompt);
}

async function toggleFavorite(prompt: PromptRecord): Promise<void> {
    const updated = await updatePrompt(prompt.id, {
        favorite: !prompt.favorite,
    });
    if (updated) replacePrompt(updated);
}

async function addTag(prompt: PromptRecord): Promise<void> {
    const tag = tagDraft.value.trim();
    if (!tag) return;
    const updated = await updatePrompt(prompt.id, {
        tags: [...prompt.tags, tag],
    });
    if (updated) replacePrompt(updated);
    tagDraft.value = '';
}

async function removeTag(
    prompt: PromptRecord,
    tagToRemove: string
): Promise<void> {
    const key = tagToRemove.toLocaleLowerCase();
    const updated = await updatePrompt(prompt.id, {
        tags: prompt.tags.filter(
            (tag) => tag.toLocaleLowerCase() !== key
        ),
    });
    if (updated) replacePrompt(updated);
}

async function toggleDefault(id: string): Promise<void> {
    if (defaultPromptId.value === id) await clearDefaultPrompt();
    else await setDefaultPrompt(id);
}

async function useSelectedPrompt(): Promise<void> {
    const prompt = selectedPrompt.value;
    if (!prompt || !canUseInChat.value) return;
    try {
        if (props.threadId) {
            await updateThreadSystemPrompt(props.threadId, prompt.id);
            threadPromptId.value = prompt.id;
        } else if (props.paneId) {
            setPanePendingPrompt(props.paneId, prompt.id);
            pendingPromptId.value = prompt.id;
        }
        emit('selected', prompt.id);
    } catch (error) {
        errorMessage.value =
            error instanceof Error
                ? error.message
                : 'Failed to apply prompt to chat.';
    }
}

function requestDeletePrompt(id: string): void {
    deleteConfirmId.value = id;
}

async function confirmDeletePrompt(): Promise<void> {
    const id = deleteConfirmId.value;
    if (!id) return;
    try {
        await softDeletePrompt(id);
        if (defaultPromptId.value === id) await clearDefaultPrompt();
        if (activePromptId.value === id) clearActivePrompt();
        if (threadPromptId.value === id && props.threadId) {
            await updateThreadSystemPrompt(props.threadId, null);
            threadPromptId.value = null;
        }
        if (pendingPromptId.value === id && props.paneId) {
            clearPanePendingPrompt(props.paneId);
            pendingPromptId.value = null;
        }
        prompts.value = prompts.value.filter((prompt) => prompt.id !== id);
        selectedPromptId.value = prompts.value[0]?.id ?? null;
        deleteConfirmId.value = null;
        view.value = 'library';
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : 'Failed to delete prompt.';
    }
}

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === '/' && view.value === 'library') {
        const target = event.target as HTMLElement | null;
        if (
            target?.tagName !== 'INPUT' &&
            target?.tagName !== 'TEXTAREA' &&
            !target?.isContentEditable
        ) {
            event.preventDefault();
            searchInputRef.value?.inputRef?.focus();
        }
        return;
    }
    if (event.key === 'Escape' && view.value !== 'library') {
        event.stopPropagation();
        if (view.value === 'edit') void stopEditing();
        else view.value = 'library';
    }
}

watch(
    () => props.showModal,
    (value, previous) => {
        if (value) void initializeForOpen();
        else if (previous) {
            openGeneration += 1;
            emit('closed');
        }
    },
    { immediate: true }
);

watch(
    prompts,
    async (nextPrompts) => {
        const generation = ++tokenCountGeneration;
        if (!nextPrompts.length) {
            tokenCounts.value = {};
            return;
        }
        try {
            const counts = await countTokensBatch(
                nextPrompts.map((prompt) => ({
                    key: prompt.id,
                    text: promptText(prompt),
                }))
            );
            if (generation === tokenCountGeneration) {
                tokenCounts.value = counts;
            }
        } catch {
            if (generation === tokenCountGeneration) tokenCounts.value = {};
        }
    },
    { deep: false }
);

onBeforeUnmount(() => {
    openGeneration += 1;
    tokenCountGeneration += 1;
});
</script>

<style scoped>
@media (max-width: 640px) {
    .sp-modal {
        width: 100dvw !important;
        max-width: 100dvw !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        margin: 0 !important;
        border-radius: 0 !important;
        border-width: 0 !important;
    }
}
</style>
