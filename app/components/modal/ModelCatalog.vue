<template>
    <UModal
        v-bind="modelCatalogModalProps"
        v-model:open="open"
        title="Model catalog"
        description="Discover and select the best model for your use case"
    >
        <template #body>
            <div class="model-catalog-shell relative flex h-full min-h-0">
                <!-- Sidebar (desktop) -->
                <aside
                    class="model-catalog-sidebar hidden lg:flex w-[228px] xl:w-[240px] shrink-0 flex-col border-r border-[var(--md-border-color)] overflow-y-auto p-4"
                >
                    <ModelCatalogSidebar
                        v-model:scope="scope"
                        :total-count="baseModels.length"
                        :favorites-count="favoriteModels.length"
                        :providers="providerCounts"
                        :selected-provider="selectedProvider"
                        :categories="categoryEntries"
                        :selected-capability="capability"
                        @select-provider="onSelectProvider"
                        @select-capability="capability = $event"
                    />
                </aside>

                <!-- Main column -->
                <section
                    class="model-catalog-main flex-1 min-w-0 flex flex-col min-h-0"
                >
                    <!-- Toolbar -->
                    <div
                        class="model-catalog-toolbar shrink-0 border-b border-[var(--md-border-color)] px-3 sm:px-4 py-3 flex flex-col gap-2.5"
                    >
                        <div class="flex items-center gap-2">
                            <div class="relative flex-1 min-w-0">
                                <UInput
                                    ref="searchInputRef"
                                    v-model="searchQuery"
                                    v-bind="searchInputProps"
                                    class="model-catalog-search-input w-full"
                                    autofocus
                                >
                                    <template #trailing>
                                        <button
                                            v-if="searchQuery"
                                            type="button"
                                            aria-label="Clear search"
                                            class="flex items-center justify-center h-4 w-4 rounded text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] transition"
                                            @click="searchQuery = ''"
                                        >
                                            <UIcon
                                                :name="closeIcon"
                                                class="h-3.5 w-3.5"
                                            />
                                        </button>
                                        <UKbd
                                            v-else
                                            value="/"
                                            size="sm"
                                            class="hidden sm:inline-flex"
                                        />
                                    </template>
                                </UInput>
                            </div>
                            <UButton
                                v-bind="filterButtonProps"
                                class="lg:hidden"
                                aria-label="Open filters"
                                @click="filtersOpen = true"
                            />
                            <UButton
                                v-bind="refreshButtonProps"
                                :disabled="refreshing"
                                aria-label="Refresh model catalog"
                                :title="
                                    refreshing
                                        ? 'Refreshing…'
                                        : 'Force refresh models (bypass cache)'
                                "
                                @click="doRefresh"
                            >
                                <UIcon
                                    :name="refreshIcon"
                                    class="h-4 w-4"
                                    :class="{ 'animate-spin': refreshing }"
                                />
                            </UButton>
                        </div>

                        <!-- Capability chips -->
                        <div
                            class="model-catalog-chips flex items-center gap-1.5 overflow-x-auto pb-0.5 -mb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        >
                            <button
                                v-for="chip in mainChips"
                                :key="chip.key"
                                type="button"
                                class="shrink-0 inline-flex items-center gap-1.5 px-3 h-7 rounded-full text-[13px] border transition-colors duration-100"
                                :class="
                                    capability === chip.key
                                        ? 'border-[var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_10%,transparent)] text-[var(--md-primary)] font-medium'
                                        : 'border-[var(--md-border-color)] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)] hover:text-[var(--md-on-surface)]'
                                "
                                @click="capability = chip.key"
                            >
                                <UIcon
                                    v-if="chip.icon"
                                    :name="chip.icon"
                                    class="h-3.5 w-3.5"
                                />
                                {{ chip.label }}
                            </button>

                            <UPopover v-model:open="moreOpen">
                                <button
                                    type="button"
                                    class="shrink-0 inline-flex items-center gap-1.5 px-3 h-7 rounded-full text-[13px] border transition-colors duration-100"
                                    :class="
                                        isMoreChipActive
                                            ? 'border-[var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_10%,transparent)] text-[var(--md-primary)] font-medium'
                                            : 'border-[var(--md-border-color)] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)] hover:text-[var(--md-on-surface)]'
                                    "
                                >
                                    {{ moreChipLabel }}
                                    <UIcon
                                        :name="chevronDownIcon"
                                        class="h-3.5 w-3.5 transition-transform"
                                        :class="{ 'rotate-180': moreOpen }"
                                    />
                                </button>
                                <template #content>
                                    <div
                                        class="p-1.5 min-w-[180px] flex flex-col gap-0.5"
                                    >
                                        <button
                                            v-for="chip in moreChips"
                                            :key="chip.key"
                                            type="button"
                                            class="flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] transition-colors"
                                            @click="selectMoreChip(chip.key)"
                                        >
                                            <UIcon
                                                :name="chip.icon"
                                                class="h-4 w-4 text-[var(--md-on-surface-variant)]"
                                            />
                                            <span class="flex-1 text-left">{{
                                                chip.label
                                            }}</span>
                                            <UIcon
                                                v-if="capability === chip.key"
                                                :name="checkIcon"
                                                class="h-4 w-4 text-[var(--md-primary)]"
                                            />
                                        </button>
                                    </div>
                                </template>
                            </UPopover>
                        </div>

                        <!-- Count + sort -->
                        <div class="flex items-center justify-between gap-2">
                            <span
                                class="text-xs text-[var(--md-on-surface-variant)] tabular-nums"
                            >
                                {{ visibleModels.length }}
                                {{ visibleModels.length === 1 ? 'model' : 'models' }}
                            </span>
                            <div class="flex items-center gap-1.5">
                                <span
                                    class="text-xs text-[var(--md-on-surface-variant)]"
                                    >Sort</span
                                >
                                <USelectMenu
                                    v-model="sort"
                                    v-bind="sortSelectProps"
                                    :items="sortItems"
                                    value-key="value"
                                    class="w-[158px] sm:w-[172px]"
                                />
                            </div>
                        </div>
                    </div>

                    <!-- List -->
                    <div class="model-catalog-list flex-1 min-h-0 relative">
                        <div
                            v-if="!searchReady"
                            class="p-6 text-sm text-[var(--md-on-surface-variant)]"
                        >
                            Indexing models…
                        </div>
                        <template v-else>
                            <ClientOnly v-if="visibleModels.length">
                                <Or3Scroll
                                    :key="listKey"
                                    :items="visibleModels"
                                    :item-key="(model) => model.id"
                                    :estimate-height="72"
                                    :overscan="520"
                                    :maintain-bottom="false"
                                    class="model-catalog-list__rows px-2 sm:px-3 py-2.5 [scrollbar-color:rgb(156_163_175)_transparent] [scrollbar-width:thin]"
                                >
                                    <template #default="{ item: m }">
                                        <div class="pb-2">
                                            <ModelCatalogCard
                                                :model="m"
                                                :selected="selectedId === m.id"
                                                :favorite="isFavorite(m)"
                                                @select="onSelectModel(m)"
                                                @toggle-favorite="toggleFavorite(m)"
                                            />
                                        </div>
                                    </template>
                                </Or3Scroll>
                                <template #fallback>
                                    <div class="p-6 text-sm text-[var(--md-on-surface-variant)]">Loading models…</div>
                                </template>
                            </ClientOnly>
                            <div
                                v-else
                                class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-6 text-center"
                            >
                                <UIcon
                                    :name="searchIconUi"
                                    class="h-8 w-8 text-[var(--md-on-surface-variant)] opacity-40 mb-1"
                                />
                                <p
                                    class="text-sm font-medium text-[var(--md-on-surface)] m-0"
                                >
                                    No models found
                                </p>
                                <p
                                    class="text-xs text-[var(--md-on-surface-variant)] m-0 max-w-[280px]"
                                >
                                    <template v-if="searchQuery">
                                        Nothing matches "{{ searchQuery }}".
                                    </template>
                                    <template
                                        v-else-if="scope === 'favorites'"
                                    >
                                        You haven't favorited any models yet.
                                    </template>
                                    <template v-else>
                                        Try adjusting your filters.
                                    </template>
                                </p>
                                <UButton
                                    v-if="hasActiveFilters"
                                    size="xs"
                                    variant="ghost"
                                    color="primary"
                                    class="mt-2"
                                    @click="clearFilters"
                                >
                                    Clear filters
                                </UButton>
                            </div>
                        </template>
                    </div>
                </section>

                <!-- Detail panel (desktop) -->
                <aside
                    class="model-catalog-detail hidden lg:flex w-[308px] xl:w-[336px] shrink-0 flex-col border-l border-[var(--md-border-color)] overflow-y-auto"
                >
                    <div v-if="selectedModel" class="p-5">
                        <ModelCatalogDetail
                            :model="selectedModel"
                            :favorite="isFavorite(selectedModel)"
                            @toggle-favorite="toggleFavorite(selectedModel)"
                            @use="useSelectedModel(selectedModel)"
                        />
                    </div>
                    <div
                        v-else
                        class="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center"
                    >
                        <UIcon
                            :name="sparklesIcon"
                            class="h-8 w-8 text-[var(--md-on-surface-variant)] opacity-40"
                        />
                        <p
                            class="text-xs text-[var(--md-on-surface-variant)] m-0"
                        >
                            Select a model to preview its capabilities
                        </p>
                    </div>
                </aside>

                <!-- Mobile filters overlay -->
                <Transition name="mc-overlay-left">
                    <div
                        v-if="filtersOpen"
                        class="absolute inset-0 z-20 lg:hidden"
                        role="dialog"
                        aria-label="Filters"
                    >
                        <div
                            class="absolute inset-0 bg-black/45"
                            @click="filtersOpen = false"
                        />
                        <div
                            class="mc-panel absolute inset-y-0 left-0 w-[278px] max-w-[85vw] bg-[var(--md-surface)] border-r border-[var(--md-border-color)] flex flex-col"
                        >
                            <div
                                class="flex items-center justify-between px-4 py-3 border-b border-[var(--md-border-color)]"
                            >
                                <span
                                    class="text-sm font-semibold text-[var(--md-on-surface)]"
                                    >Filters</span
                                >
                                <UButton
                                    :icon="closeIcon"
                                    variant="ghost"
                                    color="neutral"
                                    size="xs"
                                    square
                                    aria-label="Close filters"
                                    @click="filtersOpen = false"
                                />
                            </div>
                            <div class="flex-1 overflow-y-auto p-4">
                                <ModelCatalogSidebar
                                    v-model:scope="scope"
                                    :total-count="baseModels.length"
                                    :favorites-count="favoriteModels.length"
                                    :providers="providerCounts"
                                    :selected-provider="selectedProvider"
                                    :categories="categoryEntries"
                                    :selected-capability="capability"
                                    @select-provider="onSelectProviderMobile"
                                    @select-capability="
                                        capability = $event;
                                        filtersOpen = false;
                                    "
                                />
                            </div>
                        </div>
                    </div>
                </Transition>

                <!-- Mobile detail overlay -->
                <Transition name="mc-overlay-right">
                    <div
                        v-if="detailSheetOpen && selectedModel"
                        class="absolute inset-0 z-30 lg:hidden bg-[var(--md-surface)] flex flex-col"
                        role="dialog"
                        aria-label="Model details"
                    >
                        <div
                            class="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--md-border-color)]"
                        >
                            <UButton
                                :icon="backIcon"
                                variant="ghost"
                                color="neutral"
                                size="xs"
                                square
                                aria-label="Back to list"
                                @click="detailSheetOpen = false"
                            />
                            <span
                                class="text-sm font-semibold text-[var(--md-on-surface)]"
                                >Model details</span
                            >
                        </div>
                        <div class="flex-1 overflow-y-auto p-4 sm:p-5">
                            <ModelCatalogDetail
                                :model="selectedModel"
                                :favorite="isFavorite(selectedModel)"
                                @toggle-favorite="
                                    toggleFavorite(selectedModel)
                                "
                                @use="useSelectedModel(selectedModel)"
                            />
                        </div>
                    </div>
                </Transition>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { useToast } from '#imports';
import { Or3Scroll } from 'or3-scroll';
import 'or3-scroll/style.css';
import { useModelSearch } from '~/core/search/useModelSearch';
import type { OpenRouterModel } from '~/core/auth/models-service';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';
import {
    countByProvider,
    getProviderSlug,
    matchesCapability,
    sortModels,
    type CapabilityFilter,
    type CatalogCategoryEntry,
    type CatalogScope,
    type CatalogSort,
} from '~/utils/modelCatalog';
import ModelCatalogSidebar from './model-catalog/ModelCatalogSidebar.vue';
import ModelCatalogCard from './model-catalog/ModelCatalogCard.vue';
import ModelCatalogDetail from './model-catalog/ModelCatalogDetail.vue';

const props = defineProps<{
    showModal: boolean;
}>();
const emit = defineEmits<{
    (e: 'update:showModal', value: boolean): void;
    (e: 'select', modelId: string): void;
}>();

// Bridge prop showModal to UModal's v-model:open (which emits update:open)
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

// ---------------------------------------------------------------------------
// Theme override props (hoisted: one resolver per identifier)
// ---------------------------------------------------------------------------

const modelCatalogModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'modal',
    identifier: 'modal.model-catalog',
    isNuxtUI: true,
});

const modelCatalogModalProps = computed(() => {
    return buildThemeOverrideProps(modelCatalogModalOverrides.value, {
        baseClass:
            'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] w-[100dvw] h-[100dvh] sm:w-[96dvw] sm:h-[92dvh] sm:min-w-[720px]! sm:max-w-[1400px] sm:max-h-[900px] overflow-hidden',
        baseUi: {
            header: 'sm:px-5 border-b border-[var(--md-border-color)]',
            title: 'text-base font-semibold',
            description: 'text-xs',
            body: 'p-0! flex-1 min-h-0',
            footer: 'hidden',
        },
    });
});

const searchInputOverrides = useThemeOverrides({
    component: 'input',
    context: 'modal',
    identifier: 'model-catalog.search-input',
    isNuxtUI: true,
});

const searchInputProps = computed(() => {
    const overridesValue =
        (searchInputOverrides.value as Record<string, any>) || {};
    const {
        class: overrideClass = '',
        ui: overrideUi = {},
        ...restOverrides
    } = overridesValue;
    const uiOverrides = (overrideUi as Record<string, any>) || {};
    const baseUi = ['w-full', uiOverrides.base]
        .filter(Boolean)
        .join(' ')
        .trim();
    return {
        icon: useIcon('ui.search').value,
        placeholder: 'Search models by name, provider, or capability…',
        size: 'sm' as const,
        ...restOverrides,
        ui: {
            ...uiOverrides,
            base: baseUi,
        },
        class: [overrideClass].filter(Boolean).join(' '),
    };
});

const refreshOverrides = useThemeOverrides({
    component: 'button',
    context: 'modal',
    identifier: 'model-catalog.refresh',
    isNuxtUI: true,
});

const refreshButtonProps = computed(() => {
    const overridesValue =
        (refreshOverrides.value as Record<string, any>) || {};
    const { class: overrideClass = '', ...restOverrides } = overridesValue;
    return {
        size: 'sm' as const,
        variant: 'ghost' as const,
        square: true as const,
        ...restOverrides,
        class: ['model-catalog-refresh-button', overrideClass]
            .filter(Boolean)
            .join(' '),
    };
});

const filterOverrides = useThemeOverrides({
    component: 'button',
    context: 'modal',
    identifier: 'model-catalog.filters',
    isNuxtUI: true,
});

const filterButtonProps = computed(() => {
    const overridesValue =
        (filterOverrides.value as Record<string, any>) || {};
    const { class: overrideClass = '', ...restOverrides } = overridesValue;
    return {
        size: 'sm' as const,
        variant: 'ghost' as const,
        square: true as const,
        icon: useIcon('catalog.filter').value,
        ...restOverrides,
        class: ['model-catalog-filters-button', overrideClass]
            .filter(Boolean)
            .join(' '),
    };
});

const sortSelectOverrides = useThemeOverrides({
    component: 'selectmenu',
    context: 'modal',
    identifier: 'model-catalog.sort-select',
    isNuxtUI: true,
});

const sortSelectProps = computed(() => {
    const overridesValue =
        (sortSelectOverrides.value as Record<string, any>) || {};
    const { class: overrideClass = '', ...restOverrides } = overridesValue;
    return {
        size: 'xs' as const,
        variant: 'ghost' as const,
        ...restOverrides,
        class: [overrideClass].filter(Boolean).join(' '),
    };
});

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const closeIcon = useIcon('ui.close').value;
const refreshIcon = useIcon('ui.refresh').value;
const checkIcon = useIcon('ui.check').value;
const chevronDownIcon = useIcon('ui.chevron.down').value;
const backIcon = useIcon('catalog.back').value;
const sparklesIcon = useIcon('catalog.sparkles').value;
const searchIconUi = useIcon('ui.search').value;

const capabilityIcons: Record<CapabilityFilter, string> = {
    all: '',
    text: useIcon('catalog.text').value,
    vision: useIcon('catalog.vision').value,
    tools: useIcon('catalog.tools').value,
    reasoning: useIcon('catalog.reasoning').value,
    free: useIcon('catalog.coin').value,
    embedding: useIcon('catalog.embedding').value,
    'long-context': useIcon('catalog.context').value,
    'image-output': useIcon('catalog.image').value,
    json: useIcon('catalog.json').value,
};

// ---------------------------------------------------------------------------
// Data & search
// ---------------------------------------------------------------------------

const modelCatalog = ref<OpenRouterModel[]>([]);
const {
    query: searchQuery,
    results: searchResults,
    ready: searchReady,
} = useModelSearch(modelCatalog);

const {
    favoriteModels,
    getFavoriteModels,
    catalog,
    fetchModels,
    refreshModels,
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();

// ---------------------------------------------------------------------------
// Filter / sort state
// ---------------------------------------------------------------------------

const scope = ref<CatalogScope>('all');
const selectedProvider = ref<string | null>(null);
const capability = ref<CapabilityFilter>('all');
const sort = ref<CatalogSort>('recommended');
const filtersOpen = ref(false);
const moreOpen = ref(false);
const detailSheetOpen = ref(false);
const selectedId = ref<string | null>(null);

const isDesktop = useMediaQuery('(min-width: 1024px)');

interface ChipDef {
    key: CapabilityFilter;
    label: string;
    icon: string;
}

const mainChips: ChipDef[] = [
    { key: 'all', label: 'All', icon: '' },
    { key: 'text', label: 'Text', icon: capabilityIcons.text },
    { key: 'vision', label: 'Vision', icon: capabilityIcons.vision },
    { key: 'tools', label: 'Tools', icon: capabilityIcons.tools },
    {
        key: 'reasoning',
        label: 'Reasoning',
        icon: capabilityIcons.reasoning,
    },
    { key: 'free', label: 'Free', icon: capabilityIcons.free },
];

const moreChips: ChipDef[] = [
    {
        key: 'embedding',
        label: 'Embedding',
        icon: capabilityIcons.embedding,
    },
    {
        key: 'long-context',
        label: 'Long context',
        icon: capabilityIcons['long-context'],
    },
    {
        key: 'image-output',
        label: 'Image output',
        icon: capabilityIcons['image-output'],
    },
    { key: 'json', label: 'JSON mode', icon: capabilityIcons.json },
];

const sortItems: { label: string; value: CatalogSort }[] = [
    { label: 'Recommended', value: 'recommended' },
    { label: 'Name A–Z', value: 'name' },
    { label: 'Price: low to high', value: 'price-asc' },
    { label: 'Price: high to low', value: 'price-desc' },
    { label: 'Context: high to low', value: 'context-desc' },
    { label: 'Newest', value: 'newest' },
];

// Pipeline: search → scope → provider → capability → sort
const baseModels = computed<OpenRouterModel[]>(() =>
    searchQuery.value.trim() ? searchResults.value : modelCatalog.value
);

const scopedModels = computed<OpenRouterModel[]>(() => {
    if (scope.value !== 'favorites') return baseModels.value;
    const favIds = new Set(favoriteModels.value.map((f) => f.id));
    return baseModels.value.filter((m) => favIds.has(m.id));
});

const providerCounts = computed(() => countByProvider(scopedModels.value));

const providerFiltered = computed<OpenRouterModel[]>(() => {
    if (!selectedProvider.value) return scopedModels.value;
    const slug = selectedProvider.value;
    return scopedModels.value.filter((m) => getProviderSlug(m) === slug);
});

const categoryEntries = computed<CatalogCategoryEntry[]>(() => {
    const defs: { key: CapabilityFilter; label: string }[] = [
        { key: 'text', label: 'Text' },
        { key: 'vision', label: 'Vision' },
        { key: 'tools', label: 'Tools' },
        { key: 'reasoning', label: 'Reasoning' },
        { key: 'embedding', label: 'Embedding' },
        { key: 'long-context', label: 'Long context' },
        { key: 'free', label: 'Free' },
        { key: 'image-output', label: 'Image output' },
        { key: 'json', label: 'JSON mode' },
    ];
    return defs.map((def) => ({
        ...def,
        icon: capabilityIcons[def.key],
        count: providerFiltered.value.filter((m) =>
            matchesCapability(m, def.key)
        ).length,
    }));
});

const visibleModels = computed<OpenRouterModel[]>(() => {
    const filtered =
        capability.value === 'all'
            ? providerFiltered.value
            : providerFiltered.value.filter((m) =>
                  matchesCapability(m, capability.value)
              );
    return sortModels(filtered, sort.value);
});

/** Remounts the scroller so a new result set starts measured from the top. */
const listKey = computed(
    () =>
        `${searchQuery.value.trim()}|${scope.value}|${selectedProvider.value ?? ''}|${capability.value}|${sort.value}`
);

const selectedModel = computed<OpenRouterModel | undefined>(() => {
    if (!selectedId.value) return undefined;
    const id = selectedId.value;
    return (
        visibleModels.value.find((m) => m.id === id) ??
        modelCatalog.value.find((m) => m.id === id)
    );
});

const isMoreChipActive = computed(() =>
    moreChips.some((c) => c.key === capability.value)
);

const moreChipLabel = computed(() => {
    const active = moreChips.find((c) => c.key === capability.value);
    return active ? active.label : 'More';
});

const hasActiveFilters = computed(
    () =>
        !!searchQuery.value.trim() ||
        scope.value !== 'all' ||
        !!selectedProvider.value ||
        capability.value !== 'all'
);

function selectMoreChip(key: CapabilityFilter) {
    capability.value = capability.value === key ? 'all' : key;
    moreOpen.value = false;
}

function onSelectProvider(slug: string | null) {
    selectedProvider.value = slug;
}

function onSelectProviderMobile(slug: string | null) {
    selectedProvider.value = slug;
    filtersOpen.value = false;
}

function clearFilters() {
    searchQuery.value = '';
    scope.value = 'all';
    selectedProvider.value = null;
    capability.value = 'all';
}

// ---------------------------------------------------------------------------
// Selection & actions
// ---------------------------------------------------------------------------

function isFavorite(m: OpenRouterModel) {
    return favoriteModels.value.some((f) => f.id === m.id);
}

function toggleFavorite(m: OpenRouterModel) {
    if (isFavorite(m)) {
        removeFavoriteModel(m);
    } else {
        addFavoriteModel(m);
    }
}

function onSelectModel(m: OpenRouterModel) {
    selectedId.value = m.id;
    if (!isDesktop.value) {
        detailSheetOpen.value = true;
    }
}

const toast = useToast();

const LAST_MODEL_KEY = 'last_selected_model';

function useSelectedModel(m: OpenRouterModel) {
    if (process.client) {
        try {
            localStorage.setItem(LAST_MODEL_KEY, m.id);
        } catch {
            // storage unavailable (private mode) — still notify listeners
        }
        window.dispatchEvent(
            new CustomEvent('or3:model-selected', {
                detail: { modelId: m.id },
            })
        );
    }
    emit('select', m.id);
    toast.add({
        title: 'Model selected',
        description: `${m.name} will be used for your next message.`,
        color: 'success',
        duration: 2500,
    });
    open.value = false;
}

// Keep a valid selection on desktop so the detail panel is populated.
watch(
    [visibleModels, isDesktop, open],
    () => {
        if (!open.value) return;
        if (!isDesktop.value) return;
        if (
            !selectedId.value ||
            !visibleModels.value.some((m) => m.id === selectedId.value)
        ) {
            selectedId.value = visibleModels.value[0]?.id ?? null;
        }
    },
    { flush: 'post' }
);

// Reset transient overlay state when the modal closes.
watch(open, (value) => {
    if (!value) {
        detailSheetOpen.value = false;
        filtersOpen.value = false;
        moreOpen.value = false;
    }
});

// ---------------------------------------------------------------------------
// "/" focuses search while the modal is open
// ---------------------------------------------------------------------------

const searchInputRef = ref<any>(null);

function onGlobalKeydown(e: KeyboardEvent) {
    if (e.key !== '/') return;
    const target = e.target as HTMLElement | null;
    if (
        target &&
        (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
    ) {
        return;
    }
    e.preventDefault();
    searchInputRef.value?.inputRef?.focus();
}

watch(open, (value) => {
    if (!process.client) return;
    if (value) {
        window.addEventListener('keydown', onGlobalKeydown);
    } else {
        window.removeEventListener('keydown', onGlobalKeydown);
    }
});

onBeforeUnmount(() => {
    if (process.client) {
        window.removeEventListener('keydown', onGlobalKeydown);
    }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const refreshing = ref(false);

async function doRefresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
        await refreshModels();
        modelCatalog.value = catalog.value.slice();
    } catch (e) {
        console.warn('[ModelCatalog] model refresh failed', e);
    } finally {
        refreshing.value = false;
    }
}

onMounted(() => {
    fetchModels().then(() => {
        modelCatalog.value = catalog.value;
    });

    getFavoriteModels().then((models) => {
        favoriteModels.value = models;
    });
});
</script>

<style scoped>
.mc-overlay-left-enter-active,
.mc-overlay-left-leave-active {
    transition: opacity 0.18s ease;
}
.mc-overlay-left-enter-from,
.mc-overlay-left-leave-to {
    opacity: 0;
}
.mc-overlay-left-enter-active .mc-panel,
.mc-overlay-left-leave-active .mc-panel {
    transition: transform 0.18s ease;
}
.mc-overlay-left-enter-from .mc-panel,
.mc-overlay-left-leave-to .mc-panel {
    transform: translateX(-100%);
}
.mc-overlay-right-enter-active,
.mc-overlay-right-leave-active {
    transition:
        opacity 0.18s ease,
        transform 0.18s ease;
}
.mc-overlay-right-enter-from,
.mc-overlay-right-leave-to {
    opacity: 0;
    transform: translateX(24px);
}
</style>
