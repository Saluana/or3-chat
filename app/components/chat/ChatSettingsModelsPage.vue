<template>
    <div class="settings-page">
        <div v-show="!detailModel" class="settings-page-view">
            <div class="settings-page-toolbar">
                <UInput
                    v-model="query"
                    class="settings-page-search w-full"
                    :icon="searchIcon"
                    placeholder="Search models"
                    aria-label="Search models"
                    autocomplete="off"
                />
                <div class="settings-page-scopes">
                    <div class="settings-page-scope-group" role="group" aria-label="Show models">
                        <button
                            v-for="option in scopeOptions"
                            :key="option.value"
                            type="button"
                            class="settings-page-chip"
                            :aria-pressed="scope === option.value"
                            @click="scope = option.value"
                        >
                            {{ option.label }}
                        </button>
                        <button
                            v-if="activeCapability"
                            type="button"
                            class="settings-page-chip"
                            aria-pressed="true"
                            :aria-label="`Remove ${activeCapability.label} filter`"
                            @click="capability = 'all'"
                        >
                            {{ activeCapability.label }}
                            <UIcon :name="closeIcon" class="size-3.5" aria-hidden="true" />
                        </button>
                    </div>
                    <UDropdownMenu
                        :items="filterMenuItems"
                        :content="{ align: 'end', collisionPadding: 12 }"
                        :ui="{ content: 'min-w-52' }"
                    >
                        <UButton
                            variant="ghost"
                            color="neutral"
                            size="sm"
                            square
                            class="settings-page-filter"
                            :aria-label="filtersActive ? 'Filter and sort models (active)' : 'Filter and sort models'"
                        >
                            <UIcon :name="filterIcon" class="size-4" />
                            <span v-if="filtersActive" class="settings-page-filter-dot" aria-hidden="true" />
                        </UButton>
                    </UDropdownMenu>
                </div>
            </div>

            <!-- Rows stay quiet: tap highlights a model; the action bar acts on it. -->
            <div class="settings-page-body">
                <p v-if="!catalog.length" class="settings-page-empty">Loading models…</p>
                <section
                    v-for="section in sections"
                    :key="section.key"
                    class="settings-page-section"
                    :aria-label="section.title || 'Models'"
                >
                    <h3 v-if="section.title" class="settings-page-heading">{{ section.title }}</h3>
                    <ul class="settings-page-list">
                        <li
                            v-for="row in section.rows"
                            :key="row.id"
                            class="settings-page-row"
                            :data-model-id="row.id"
                        >
                            <button
                                type="button"
                                class="settings-page-row-main"
                                :aria-pressed="row.highlighted"
                                :aria-current="row.selected ? 'true' : undefined"
                                @click="onRowClick(row.id)"
                            >
                                <span class="settings-page-row-icon" aria-hidden="true">
                                    <ModelCatalogProviderLogo :slug="row.slug" :size="18" />
                                </span>
                                <span class="settings-page-row-copy">
                                    <span class="settings-page-row-title">{{ row.name }}</span>
                                    <span class="settings-page-row-description">{{ row.subtitle }}</span>
                                </span>
                                <UIcon
                                    v-if="row.selected"
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
                    class="settings-page-more"
                    @click="limit += PAGE_SIZE"
                >
                    Show more models
                </UButton>
                <p v-if="catalog.length && !sections.length" class="settings-page-empty">
                    {{ emptyMessage }}
                </p>
            </div>

            <div class="settings-page-footer settings-page-actions">
                <UButton
                    variant="outline"
                    color="neutral"
                    square
                    class="settings-page-action"
                    :icon="highlightedFavorite ? starFilledIcon : starIcon"
                    :aria-label="highlightedFavorite ? 'Remove from favorites' : 'Add to favorites'"
                    :aria-pressed="highlightedFavorite"
                    :disabled="!highlightedModel"
                    @click="highlightedModel && toggleFavorite(highlightedModel)"
                />
                <UButton
                    variant="outline"
                    color="neutral"
                    square
                    class="settings-page-action"
                    :icon="infoIcon"
                    aria-label="Model details"
                    :disabled="!highlightedModel"
                    @click="highlightedModel && openDetail(highlightedModel.id, $event?.currentTarget ?? null)"
                />
                <UButton
                    color="primary"
                    class="settings-page-use"
                    :disabled="!highlightedModel || highlightedIsCurrent || disabled"
                    @click="highlightedModel && emit('select', highlightedModel.id)"
                >
                    {{ highlightedIsCurrent ? 'In use' : 'Use model' }}
                </UButton>
            </div>
        </div>

        <div v-if="detailModel" class="settings-page-body settings-page-detail">
            <ModelCatalogDetail
                :model="detailModel"
                :favorite="isFavorite(detailModel.id)"
                @toggle-favorite="toggleFavorite(detailModel)"
                @use="emit('select', detailModel.id)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import type { OpenRouterModel } from '~/core/auth/models-service';
import { useModelSearch } from '~/core/search/useModelSearch';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useWorkspaceModels } from '~/composables/chat/useWorkspaceModels';
import { useIcon } from '~/composables/useIcon';
import { isModelHidden } from '~~/shared/ai/workspace-models';
import {
    formatModelName,
    getCapabilities,
    getProviderSlug,
    isChatModel,
    matchesCapability,
    sortModels,
    type CapabilityFilter,
    type CatalogSort,
} from '~/utils/modelCatalog';
import ModelCatalogProviderLogo from '~/components/modal/model-catalog/ModelCatalogProviderLogo.vue';
import ModelCatalogDetail from '~/components/modal/model-catalog/ModelCatalogDetail.vue';

/** Rows rendered per step; the catalog can hold hundreds of models. */
const PAGE_SIZE = 40;
const RECENT_LIMIT = 5;

const props = defineProps<{
    selectedModel?: string;
    detailId?: string | null;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select', modelId: string): void;
    (e: 'open-detail', modelId: string): void;
}>();

const searchIcon = useIcon('ui.search');
const filterIcon = useIcon('catalog.filter');
const infoIcon = useIcon('ui.info');
const checkIcon = useIcon('ui.check');
const closeIcon = useIcon('ui.close');
const starIcon = useIcon('catalog.star');
const starFilledIcon = useIcon('catalog.star.filled');

const {
    catalog,
    favoriteModels,
    recentModelIds,
    loadRecentModels,
    getFavoriteModels,
    fetchModels,
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();
const { policy } = useWorkspaceModels();
const { query, results } = useModelSearch(catalog);

type Scope = 'all' | 'favorites';
const scopeOptions: Array<{ value: Scope; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'favorites', label: 'Favorites' },
];
const capabilityOptions: Array<{ value: CapabilityFilter; label: string }> = [
    { value: 'vision', label: 'Vision' },
    { value: 'tools', label: 'Tools' },
    { value: 'reasoning', label: 'Reasoning' },
    { value: 'free', label: 'Free' },
    { value: 'long-context', label: 'Long context' },
];
const sortOptions: Array<{ value: CatalogSort; label: string }> = [
    { value: 'recommended', label: 'Recommended' },
    { value: 'newest', label: 'Newest' },
    { value: 'name', label: 'Name' },
    { value: 'price-asc', label: 'Lowest price' },
    { value: 'context-desc', label: 'Largest context' },
];

const scope = ref<Scope>('all');
const capability = ref<CapabilityFilter>('all');
const sort = ref<CatalogSort>('recommended');
const limit = ref(PAGE_SIZE);

const activeCapability = computed(() =>
    capabilityOptions.find((option) => option.value === capability.value)
);
const filtersActive = computed(
    () => capability.value !== 'all' || sort.value !== 'recommended'
);

function resetFilters() {
    capability.value = 'all';
    sort.value = 'recommended';
}

// Choices keep the menu open so a filter and a sort can be set together.
const keepOpen = (event: Event) => event.preventDefault();
const filterMenuItems = computed<DropdownMenuItem[][]>(() => [
    [
        { label: 'Filter', type: 'label' },
        ...capabilityOptions.map((option) => ({
            label: option.label,
            type: 'checkbox' as const,
            checked: capability.value === option.value,
            onSelect: keepOpen,
            onUpdateChecked: (checked: boolean) => {
                capability.value = checked ? option.value : 'all';
            },
        })),
    ],
    [
        { label: 'Sort', type: 'label' },
        ...sortOptions.map((option) => ({
            label: option.label,
            type: 'checkbox' as const,
            checked: sort.value === option.value,
            onSelect: keepOpen,
            onUpdateChecked: () => {
                sort.value = option.value;
            },
        })),
    ],
    [
        {
            label: 'Reset',
            disabled: !filtersActive.value,
            onSelect: resetFilters,
        },
    ],
]);

const favoriteIds = computed(
    () => new Set((favoriteModels.value ?? []).map((model) => model.id))
);

function isFavorite(id: string) {
    return favoriteIds.value.has(id);
}

function toggleFavorite(model: OpenRouterModel) {
    if (isFavorite(model.id)) void removeFavoriteModel(model);
    else void addFavoriteModel(model);
}

const available = computed(() =>
    (query.value.trim() ? results.value : catalog.value).filter(
        (model) => isChatModel(model) && !isModelHidden(policy.value, model.id)
    )
);

const filtered = computed(() => {
    let list = available.value;
    if (scope.value === 'favorites') list = list.filter((model) => isFavorite(model.id));
    if (capability.value !== 'all') {
        list = list.filter((model) => matchesCapability(model, capability.value));
    }
    return sortModels(list, sort.value);
});

function isSelected(model: OpenRouterModel) {
    const current = props.selectedModel;
    return !!current && (model.id === current || model.canonical_slug === current);
}

const CAPABILITY_LABELS: Array<[keyof ReturnType<typeof getCapabilities>, string]> = [
    ['vision', 'Vision'],
    ['reasoning', 'Reasoning'],
    ['tools', 'Tools'],
    ['free', 'Free'],
];

function toRow(model: OpenRouterModel) {
    const capabilities = getCapabilities(model);
    const labels = CAPABILITY_LABELS.filter(([key]) => capabilities[key]).map(
        ([, label]) => label
    );
    return {
        id: model.id,
        name: formatModelName(model.name || model.id),
        // Names already carry the maker ("Anthropic: …"), so rows list capabilities.
        subtitle: labels.length ? labels.join(' · ') : 'Text',
        slug: getProviderSlug(model),
        selected: isSelected(model),
        highlighted: model.id === highlightedId.value,
    };
}

const groupedView = computed(
    () =>
        !query.value.trim() &&
        scope.value === 'all' &&
        capability.value === 'all' &&
        sort.value === 'recommended'
);

const allSections = computed(() => {
    const models = filtered.value;
    if (!groupedView.value) return [{ key: 'results', title: '', models }];
    const byId = new Map(models.map((model) => [model.id, model]));
    const favorites = models.filter((model) => isFavorite(model.id));
    const recent = (recentModelIds.value ?? [])
        .map((id) => byId.get(id))
        .filter((model): model is OpenRouterModel => !!model && !isFavorite(model.id))
        .slice(0, RECENT_LIMIT);
    const shown = new Set([...favorites, ...recent].map((model) => model.id));
    return [
        { key: 'favorites', title: 'Favorites', models: favorites },
        { key: 'recent', title: 'Recent', models: recent },
        {
            key: 'all',
            title: 'All models',
            models: models.filter((model) => !shown.has(model.id)),
        },
    ].filter((section) => section.models.length);
});

// Rows are bounded across sections; "Show more" extends the window.
const sections = computed(() => {
    let remaining = limit.value;
    const visible: Array<{ key: string; title: string; rows: ReturnType<typeof toRow>[] }> = [];
    for (const section of allSections.value) {
        if (remaining <= 0) break;
        const rows = section.models.slice(0, remaining).map(toRow);
        remaining -= rows.length;
        visible.push({ key: section.key, title: section.title, rows });
    }
    return visible;
});

const hiddenCount = computed(() => {
    const total = allSections.value.reduce((sum, section) => sum + section.models.length, 0);
    return Math.max(0, total - limit.value);
});

const emptyMessage = computed(() => {
    if (query.value.trim() || capability.value !== 'all') return 'No models match.';
    if (scope.value === 'favorites') return 'No favorite models yet. Open a model’s details to add one.';
    return 'No models available.';
});

watch([query, scope, capability, sort], () => {
    limit.value = PAGE_SIZE;
});

const detailModel = computed(() =>
    props.detailId
        ? catalog.value.find((model) => model.id === props.detailId) ?? null
        : null
);

// Return focus to the row's details button after leaving the detail view.
let detailTrigger: HTMLElement | null = null;
function openDetail(id: string, trigger: EventTarget | null) {
    detailTrigger = trigger instanceof HTMLElement ? trigger : null;
    emit('open-detail', id);
}

// Tapping a row highlights it for the action bar; tapping it again uses it.
const highlightedId = ref<string | null>(null);
const highlightedModel = computed(() =>
    highlightedId.value
        ? catalog.value.find((model) => model.id === highlightedId.value) ?? null
        : null
);
const highlightedFavorite = computed(
    () => !!highlightedModel.value && isFavorite(highlightedModel.value.id)
);
const highlightedIsCurrent = computed(
    () => !!highlightedModel.value && isSelected(highlightedModel.value)
);

// Start on the model in use so the bar is useful before any tap.
watch(
    [catalog, () => props.selectedModel],
    () => {
        if (highlightedId.value) return;
        highlightedId.value = catalog.value.find((model) => isSelected(model))?.id ?? null;
    },
    { immediate: true }
);

function onRowClick(id: string) {
    if (highlightedId.value === id) {
        if (!props.disabled && !highlightedIsCurrent.value) emit('select', id);
        return;
    }
    highlightedId.value = id;
}

onMounted(() => {
    void fetchModels().catch(() => undefined);
    void loadRecentModels().catch(() => undefined);
    void getFavoriteModels().then((models) => {
        favoriteModels.value = models;
    }).catch(() => undefined);
});
</script>

<style scoped>
.settings-page,
.settings-page-view {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
}

.settings-page-toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    flex-shrink: 0;
    padding: 0.625rem 0.75rem 0.25rem;
}

.settings-page-scopes {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.settings-page-scope-group {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: 0.375rem;
    overflow-x: auto;
    scrollbar-width: none;
}

.settings-page-chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
    min-height: 2rem;
    padding: 0 0.875rem;
    color: var(--md-on-surface-variant);
    font-size: 0.8125rem;
    font-weight: 500;
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: 999px;
    transition: background-color var(--app-motion-duration-fast, 150ms)
        var(--app-motion-easing-standard, ease);
}


.settings-page-chip[aria-pressed='true'] {
    color: var(--md-primary);
    background: color-mix(in srgb, var(--md-primary) 10%, transparent);
    border-color: var(--md-primary);
}

.settings-page-chip:focus-visible,
.settings-page-row-main:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: -2px;
}

.settings-page-filter {
    position: relative;
    flex: none;
}

.settings-page-filter-dot {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    width: 0.4375rem;
    height: 0.4375rem;
    background: var(--md-primary);
    border-radius: 999px;
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

.settings-page-detail {
    padding: 0.875rem 1rem 1rem;
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

.settings-page-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.125rem;
}

.settings-page-row-main {
    display: grid;
    flex: 1;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.75rem;
    min-width: 0;
    min-height: 3rem;
    padding: 0.375rem 0.5rem;
    color: var(--md-on-surface);
    text-align: left;
    border-radius: var(--md-border-radius);
}

/* The highlighted row is the action bar's target. */
.settings-page-row-main[aria-pressed='true'] {
    background: var(--md-surface-container-low);
    box-shadow: inset 0 0 0 var(--md-border-width, 1px)
        color-mix(in srgb, var(--md-border-color) 80%, transparent);
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

/* Touch screens keep :hover on the last tapped row, so only hover-capable pointers get it. */
@media (hover: hover) {
    .settings-page-chip:hover {
        color: var(--md-on-surface);
        background: var(--md-surface-hover);
    }

    .settings-page-row-main:hover:not([aria-pressed='true']) {
        background: var(--md-surface-hover);
    }
}

.settings-page-empty {
    margin: 1.5rem 0.75rem;
    color: var(--md-on-surface-variant);
    font-size: 0.8125rem;
    text-align: center;
}

.settings-page-footer {
    flex-shrink: 0;
    padding: 0.625rem 0.75rem 0.75rem;
    border-top: var(--md-border-width-subtle, var(--md-border-width)) solid
        color-mix(in srgb, var(--md-border-color) 40%, transparent);
}

.settings-page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.settings-page-action {
    flex: none;
    justify-content: center;
}

.settings-page-use {
    flex: 1;
    justify-content: center;
}

/* Below 16px, iOS Safari zooms the page when the search field takes focus. */
@media (pointer: coarse) {
    .settings-page-search :deep(input) {
        font-size: max(16px, 1em);
    }
}
</style>
