<template>
    <div class="settings-page">
        <div class="settings-page-toolbar">
            <UInput
                v-model="query"
                v-bind="theme.searchProps.value"
                class="settings-page-search w-full"
                :icon="searchIcon"
                placeholder="Search prompts"
                aria-label="Search system prompts"
                autocomplete="off"
            />
        </div>

        <div class="settings-page-body">
            <p v-if="loading && !prompts.length" class="settings-page-empty">Loading prompts…</p>
            <section
                v-for="section in sections"
                :key="section.key"
                class="settings-page-section"
                :aria-label="section.title || 'Prompt options'"
            >
                <h3 v-if="section.title" class="settings-page-heading">{{ section.title }}</h3>
                <ul class="settings-page-list">
                    <li v-for="row in section.rows" :key="row.value">
                        <button
                            v-theme="{ identifier: theme.ids.row, context: 'settings' }"
                            type="button"
                            class="settings-page-row-main"
                            :aria-pressed="row.value === highlighted"
                            :aria-current="row.value === selection ? 'true' : undefined"
                            @click="onRowClick(row.value)"
                        >
                            <span class="settings-page-row-icon" aria-hidden="true">
                                <UIcon :name="promptIcon" class="size-4" />
                            </span>
                            <span class="settings-page-row-copy">
                                <span class="settings-page-row-title">{{ row.label }}</span>
                                <span v-if="row.description" class="settings-page-row-description">
                                    {{ row.description }}
                                </span>
                            </span>
                            <UIcon
                                v-if="row.value === selection"
                                :name="checkIcon"
                                class="settings-page-row-check"
                                aria-label="In use"
                            />
                        </button>
                    </li>
                </ul>
            </section>
            <UButton
                v-if="hiddenCount > 0"
                variant="ghost"
                color="neutral"
                size="sm"
                block
                @click="limit += PAGE_SIZE"
            >
                Show more prompts
            </UButton>
            <p v-if="query.trim() && !sections.length" class="settings-page-empty">No prompts match.</p>
            <p v-else-if="!loading && !prompts.length" class="settings-page-empty">
                No saved prompts yet.
            </p>
        </div>

        <!-- Secondary actions lead; the primary action sits at the trailing edge. -->
        <div class="settings-page-footer">
            <UButton
                v-bind="theme.actionProps.value"
                class="settings-page-action"
                :icon="editIcon"
                aria-label="Edit prompt"
                :disabled="!highlightedIsSaved"
                @click="emit('edit-prompt', highlighted)"
            />
            <UButton
                v-if="highlightedIsCurrent"
                v-bind="theme.inUseProps.value"
                class="settings-page-use is-current"
                :icon="checkIcon"
                disabled
            >
                In use
            </UButton>
            <UButton
                v-else
                v-bind="theme.useProps.value"
                class="settings-page-use"
                :disabled="disabled"
                @click="emit('select', highlighted)"
            >
                Use prompt
            </UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PromptRecord } from '~/db/prompts';
import { useIcon } from '~/composables/useIcon';
import { useSettingsLibraryTheme } from '~/composables/chat/useSettingsLibraryTheme';
import {
    DEFAULT_PROMPT_SELECTION,
    DISABLED_PROMPT_SELECTION,
    promptJsonToString,
} from '~/utils/chat/prompt-utils';

const PAGE_SIZE = 50;

const props = defineProps<{
    prompts: PromptRecord[];
    selection: string;
    defaultPromptId?: string | null;
    disabled?: boolean;
    loading?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select' | 'edit-prompt', value: string): void;
}>();

const theme = useSettingsLibraryTheme();
const searchIcon = useIcon('ui.search');
const promptIcon = useIcon('chat.system_prompt');
const checkIcon = useIcon('ui.check');
const editIcon = useIcon('ui.edit');

const query = ref('');

// Tapping a row highlights it for the action bar; tapping it again uses it.
const highlighted = ref(props.selection);
const highlightedIsCurrent = computed(() => highlighted.value === props.selection);
const highlightedIsSaved = computed(() =>
    props.prompts.some((prompt) => prompt.id === highlighted.value)
);

// Follow the chat's selection (it can load after mount) unless the user moved on.
watch(() => props.selection, (next, previous) => {
    if (highlighted.value === previous) highlighted.value = next;
});

function onRowClick(value: string) {
    if (highlighted.value === value) {
        if (!props.disabled && !highlightedIsCurrent.value) emit('select', value);
        return;
    }
    highlighted.value = value;
}
const limit = ref(PAGE_SIZE);
watch(query, () => {
    limit.value = PAGE_SIZE;
});

interface PromptRow {
    value: string;
    label: string;
    description: string;
    favorite: boolean;
    searchText: string;
}

function excerpt(prompt: PromptRecord): string {
    const text = promptJsonToString(prompt.content).replace(/\s+/g, ' ').trim();
    return text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text;
}

const builtInRows = computed<PromptRow[]>(() => {
    const defaultTitle = props.prompts.find(
        (prompt) => prompt.id === props.defaultPromptId
    )?.title;
    return [
        {
            value: DEFAULT_PROMPT_SELECTION,
            label: 'Default',
            description: defaultTitle
                ? `Uses ${defaultTitle}.`
                : 'Use your default system prompt.',
            favorite: false,
            searchText: 'default',
        },
        {
            value: DISABLED_PROMPT_SELECTION,
            label: 'Disabled',
            description: 'Send no system prompt for this chat.',
            favorite: false,
            searchText: 'disabled none off',
        },
    ];
});

const savedRows = computed<PromptRow[]>(() =>
    props.prompts.map((prompt) => {
        const description = excerpt(prompt);
        return {
            value: prompt.id,
            label: prompt.title || 'Untitled prompt',
            description,
            favorite: prompt.favorite,
            searchText: `${prompt.title} ${description}`.toLowerCase(),
        };
    })
);

const allSections = computed(() => {
    const needle = query.value.trim().toLowerCase();
    if (needle) {
        const rows = [...builtInRows.value, ...savedRows.value].filter((row) =>
            row.searchText.includes(needle)
        );
        return rows.length ? [{ key: 'results', title: '', rows }] : [];
    }
    return [
        { key: 'built-in', title: '', rows: builtInRows.value },
        { key: 'favorites', title: 'Favorites', rows: savedRows.value.filter((row) => row.favorite) },
        { key: 'all', title: 'All prompts', rows: savedRows.value.filter((row) => !row.favorite) },
    ].filter((section) => section.rows.length);
});

// Rows are bounded across sections; "Show more" extends the window.
const sections = computed(() => {
    let remaining = limit.value;
    const visible: Array<{ key: string; title: string; rows: PromptRow[] }> = [];
    for (const section of allSections.value) {
        if (remaining <= 0) break;
        const rows = section.rows.slice(0, remaining);
        remaining -= rows.length;
        visible.push({ ...section, rows });
    }
    return visible;
});

const hiddenCount = computed(() => {
    const total = allSections.value.reduce((sum, section) => sum + section.rows.length, 0);
    return Math.max(0, total - limit.value);
});
</script>

<style scoped>
.settings-page {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
}

.settings-page-toolbar {
    flex-shrink: 0;
    padding: 0.625rem 0.75rem 0.25rem;
}

.settings-page-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    padding: 0.25rem 0.5rem 0.75rem;
}

.settings-page-heading {
    margin: 0;
    padding: 0.625rem 0.5rem 0.25rem;
    color: var(--md-on-surface-variant);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
    line-height: 1rem;
    text-transform: uppercase;
}

.settings-page-list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.settings-page-row-main {
    display: grid;
    width: 100%;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.75rem;
    min-height: 3rem;
    padding: 0.375rem 0.75rem 0.375rem 0.5rem;
    color: var(--md-on-surface);
    text-align: left;
    border-radius: var(--md-border-radius);
}

/* Touch screens keep :hover on the last tapped row, so only hover-capable pointers get it. */
@media (hover: hover) {
    .settings-page-row-main:hover:not([aria-pressed='true']) {
        background: var(--md-surface-hover);
    }
}

/* The highlighted row is the action bar's target. */
.settings-page-row-main[aria-pressed='true'] {
    background: var(--md-surface-container-low);
    box-shadow: inset 0 0 0 var(--md-border-width, 1px)
        color-mix(in srgb, var(--md-border-color) 80%, transparent);
}

.settings-page-row-main:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: -2px;
}

.settings-page-row-icon {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    align-items: center;
    justify-content: center;
    color: var(--md-on-surface-variant);
    background: var(--md-surface-container-low);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}

.settings-page-row-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.125rem;
}

.settings-page-row-title,
.settings-page-row-description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.settings-page-row-title {
    font-size: 0.8125rem;
    font-weight: 500;
    line-height: 1.3;
}

.settings-page-row-description {
    color: var(--md-on-surface-variant);
    font-size: 0.6875rem;
    line-height: 1.35;
}

.settings-page-row-check {
    width: 1rem;
    height: 1rem;
    color: var(--md-primary);
}

.settings-page-empty {
    margin: 1.5rem 0.75rem;
    color: var(--md-on-surface-variant);
    font-size: 0.8125rem;
    text-align: center;
}

.settings-page-footer {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.25rem;
    --settings-action-size: 2.25rem;
    padding: 0.625rem 0.75rem 0.75rem;
    border-top: var(--md-border-width-subtle, var(--md-border-width)) solid
        color-mix(in srgb, var(--md-border-color) 40%, transparent);
}

/* One height for every control in the bar; touch screens get 44px targets. */
@media (pointer: coarse) {
    .settings-page-footer {
        --settings-action-size: 2.75rem;
    }
}

.settings-page-action {
    flex: none;
    width: var(--settings-action-size);
    height: var(--settings-action-size);
    justify-content: center;
}

.settings-page-use {
    flex: none;
    min-width: 7.5rem;
    height: var(--settings-action-size);
    margin-inline-start: auto;
    justify-content: center;
}

/* "In use" is a status, not a faded button. */
.settings-page-use.is-current:disabled {
    cursor: default;
    opacity: 1;
}

/* Below 16px, iOS Safari zooms the page when the search field takes focus. */
@media (pointer: coarse) {
    .settings-page-search :deep(input) {
        font-size: max(16px, 1em);
    }
}
</style>
