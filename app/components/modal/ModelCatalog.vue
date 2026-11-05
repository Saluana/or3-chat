<template>
    <AppModal
        v-bind="modelCatalogModalOverrides"
        v-model:open="open"
        size="workspace"
        close-label="Close model catalog"
        title="Model catalog"
        description="Discover and select the best model for your use case"
    >
        <template #default>
            <div class="model-catalog-shell relative flex h-full min-h-0">
                <!-- Sidebar (desktop) -->
                <aside
                    class="model-catalog-sidebar hidden lg:flex w-[228px] xl:w-[240px] shrink-0 flex-col border-r border-[var(--md-border-color)] overflow-y-auto p-4"
                >
                    <ModelCatalogSidebar
                        v-model:scope="scope"
                        :total-count="baseModels.length"
                        :favorites-count="baseModels.filter(model => isFavorite(model)).length"
                        :recent-count="baseModels.filter(model => recentModelIds.includes(model.id)).length"
                        :pinned-count="baseModels.filter(model => workspaceModels.policy.value.pinned.includes(model.id)).length"
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
                                    aria-label="Search models"
                                    v-model="searchQuery"
                                    v-bind="searchInputProps"
                                    variant="modal"
                                    class="model-catalog-search-input w-full"
                                    autofocus
                                    @keydown.down.prevent="focusModel(0)"
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
                                        : 'Refresh models'
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
                            class="model-catalog-chips flex lg:hidden items-center gap-1.5 overflow-x-auto pb-0.5 -mb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        >
                            <button
                                v-for="chip in mainChips"
                                :key="chip.key"
                                type="button"
                                class="shrink-0 inline-flex items-center gap-1.5 px-3 h-7 rounded-full text-[13px] border transition-colors duration-[var(--app-motion-duration-fast,100ms)] ease-[var(--app-motion-easing-standard,ease)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
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
                                    class="shrink-0 inline-flex items-center gap-1.5 px-3 h-7 rounded-full text-[13px] border transition-colors duration-[var(--app-motion-duration-fast,100ms)] ease-[var(--app-motion-easing-standard,ease)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
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
                                        class="or3-action-menu p-1 min-w-[180px] flex flex-col"
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

                        <p v-if="policyError" role="status" class="text-xs text-[var(--md-on-surface-variant)]">{{ policyError }}</p>
                        <p v-for="(status, platform) in platformStatus" v-show="status === 'unavailable' || status === 'stale' || status === 'loading'" :key="platform" role="status" class="text-xs text-[var(--md-on-surface-variant)]">
                            {{ platform === 'openai' ? 'OpenAI' : 'OpenRouter' }}: {{ status === 'loading' ? 'Loading models…' : status === 'stale' ? 'Showing saved models. Refresh to try again.' : 'Models unavailable. Refresh to try again.' }}
                        </p>
                        <!-- Count + sort -->
                        <div class="flex items-center justify-between gap-2">
                            <span
                                class="text-xs text-[var(--md-on-surface-variant)] tabular-nums"
                            >
                                <span class="lg:hidden">{{ scope === 'recent' ? 'Recently used · ' : scope === 'favorites' ? 'Favorites · ' : scope === 'pinned' ? 'Workspace picks · ' : '' }}</span>
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
                                    aria-label="Sort models"
                                    v-bind="sortSelectProps"
                                    :items="sortItems"
                                    value-key="value"
                                    class="w-[158px] sm:w-[172px]"
                                />
                            </div>
                        </div>
                    </div>

                    <!-- List -->
                    <div ref="listElement" class="model-catalog-list flex-1 min-h-0 relative" role="list" aria-label="Models" @keydown="onListKeydown">
                        <div
                            v-if="!searchReady"
                            class="p-6 text-sm text-[var(--md-on-surface-variant)]"
                        >
                            Loading models…
                        </div>
                        <template v-else>
                            <ClientOnly v-if="visibleModels.length">
                                <Or3Scroll
                                    ref="modelScroller"
                                    :key="listKey"
                                    :items="visibleModels"
                                    :item-key="(model) => model.id"
                                    :estimate-height="rowEstimateHeight"
                                    :overscan="520"
                                    :maintain-bottom="false"
                                    class="model-catalog-list__rows px-2 sm:px-3 py-2.5 max-sm:pb-[max(0.625rem,env(safe-area-inset-bottom))] [scrollbar-color:rgb(156_163_175)_transparent] [scrollbar-width:thin]"
                                >
                                    <template #default="{ item: m }">
                                        <div class="pb-2">
                                            <ModelCatalogCard
                                                :model="m"
                                                :selected="selectedId === m.id"
                                                :favorite="isFavorite(m)"
                                                @select="onSelectModel(m)"
                                                @use="useSelectedModel(m)"
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

            </div>
        </template>
    </AppModal>
    <AppModal v-model:open="filtersOpen" title="Filters" close-label="Close filters">
        <ModelCatalogSidebar
            v-model:scope="scope"
            :total-count="baseModels.length"
            :favorites-count="baseModels.filter(model => isFavorite(model)).length"
            :recent-count="baseModels.filter(model => recentModelIds.includes(model.id)).length"
            :pinned-count="baseModels.filter(model => workspaceModels.policy.value.pinned.includes(model.id)).length"
            :providers="providerCounts"
            :selected-provider="selectedProvider"
            :categories="categoryEntries"
            :selected-capability="capability"
            @select-provider="onSelectProviderMobile"
            @select-capability="capability = $event; filtersOpen = false"
        />
    </AppModal>
    <AppModal v-model:open="detailSheetOpen" size="md" title="Model details" close-label="Back to list">
        <ModelCatalogDetail
            v-if="selectedModel"
            :model="selectedModel"
            :favorite="isFavorite(selectedModel)"
            @toggle-favorite="toggleFavorite(selectedModel)"
            @use="useSelectedModel(selectedModel)"
        />
    </AppModal>
</template>

<script setup lang="ts">
import { modelIdentity } from '~~/shared/ai/model-catalog';
import { isModelHidden } from '~~/shared/ai/workspace-models';
import { useWorkspaceModels } from '~/composables/chat/useWorkspaceModels';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, nextTick } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { Or3Scroll } from 'or3-scroll';
import 'or3-scroll/style.css';
import { useModelSearch } from '~/core/search/useModelSearch';
import type { OpenRouterModel } from '~/core/auth/models-service';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import AppModal from '~/components/ui/AppModal.vue';
import {
    countByPlatform,
    isChatModel,
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
        placeholder: 'Search models by name, platform, or capability…',
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

const closeIcon = useIcon('ui.close');
const refreshIcon = useIcon('ui.refresh');
const checkIcon = useIcon('ui.check');
const chevronDownIcon = useIcon('ui.chevron.down');
const sparklesIcon = useIcon('catalog.sparkles');
const searchIconUi = useIcon('ui.search');

// Reactive maps unwrap the icon refs while retaining theme dependencies.
const capabilityIcons: Record<CapabilityFilter, string> = reactive({
    all: '',
    text: useIcon('catalog.text'),
    vision: useIcon('catalog.vision'),
    tools: useIcon('catalog.tools'),
    reasoning: useIcon('catalog.reasoning'),
    free: useIcon('catalog.coin'),
    embedding: useIcon('catalog.embedding'),
    'long-context': useIcon('catalog.context'),
    'image-output': useIcon('catalog.image'),
    json: useIcon('catalog.json'),
});

// ---------------------------------------------------------------------------
// Data & search
// ---------------------------------------------------------------------------

const {
    favoriteModels,
    platformStatus, recentModelIds, loadRecentModels, recordRecentModel,
    getFavoriteModels,
    catalog: modelCatalog,
    fetchModels,
    refreshModels,
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();
const {
    query: searchQuery,
    results: searchResults,
    ready: searchReady,
} = useModelSearch(modelCatalog);

// ---------------------------------------------------------------------------
// Filter / sort state
// ---------------------------------------------------------------------------

const workspaceModels = useWorkspaceModels();
const policyError = ref('');
const scope = ref<CatalogScope>('all');
const selectedProvider = ref<string | null>(null);
const capability = ref<CapabilityFilter>('all');
const sort = ref<CatalogSort>('newest');
const filtersOpen = ref(false);
const moreOpen = ref(false);
const detailSheetOpen = ref(false);
const selectedId = ref<string | null>(null);

const isDesktop = useMediaQuery('(min-width: 1024px)');
watch(isDesktop, (desktop) => {
    if (desktop) { filtersOpen.value = false; detailSheetOpen.value = false; }
});
const isWideRow = useMediaQuery('(min-width: 640px)');
const rowEstimateHeight = computed(() => (isWideRow.value ? 72 : 88));

interface ChipDef {
    key: CapabilityFilter;
    label: string;
    icon: string;
}

const mainChips = computed<ChipDef[]>(() => [
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
]);

const moreChips = computed<ChipDef[]>(() => [
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
]);

const sortItems: { label: string; value: CatalogSort }[] = [
    { label: 'Newest first', value: 'newest' },
    { label: 'Name A–Z', value: 'name' },
    { label: 'Input price: lowest', value: 'input-price' },
    { label: 'Output price: lowest', value: 'output-price' },
    { label: 'Context: high to low', value: 'context-desc' },
];

// Pipeline: search → scope → provider → capability → sort
const baseModels = computed<OpenRouterModel[]>(() =>
    (searchQuery.value.trim() ? searchResults.value : modelCatalog.value).filter(model => isChatModel(model) && !isModelHidden(workspaceModels.policy.value, model.id))
);

const scopedModels = computed<OpenRouterModel[]>(() => {
    if (scope.value === 'recent') return baseModels.value.filter(model => recentModelIds.value.includes(model.id));
    if (scope.value === 'pinned') return baseModels.value.filter(model => workspaceModels.policy.value.pinned.includes(model.id));
    if (scope.value !== 'favorites') return baseModels.value;
    const favIds = new Set(favoriteModels.value.map((f) => f.id));
    return baseModels.value.filter((m) => favIds.has(m.id));
});

const providerCounts = computed(() => countByPlatform(scopedModels.value));

const providerFiltered = computed<OpenRouterModel[]>(() => {
    if (!selectedProvider.value) return scopedModels.value;
    const slug = selectedProvider.value;
    return scopedModels.value.filter((m) => modelIdentity(m).platform === slug);
});

const categoryEntries = computed<CatalogCategoryEntry[]>(() => {
    const defs: { key: CapabilityFilter; label: string }[] = [
        { key: 'text', label: 'Text' },
        { key: 'vision', label: 'Vision' },
        { key: 'tools', label: 'Tools' },
        { key: 'reasoning', label: 'Reasoning' },
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
    return scope.value === 'recent' ? filtered.slice().sort((a, b) => recentModelIds.value.indexOf(a.id) - recentModelIds.value.indexOf(b.id)) : sortModels(filtered, sort.value);
});

/** Remounts the scroller so a new result set starts measured from the top. */
const listKey = computed(
    () =>
        `${searchQuery.value.trim()}|${scope.value}|${selectedProvider.value ?? ''}|${capability.value}|${sort.value}|${rowEstimateHeight.value}`
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
    moreChips.value.some((c) => c.key === capability.value)
);

const moreChipLabel = computed(() => {
    const active = moreChips.value.find((c) => c.key === capability.value);
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

const listElement = ref<HTMLElement | null>(null);
const modelScroller = ref<{ scrollToIndex: (index: number, options: { align: 'center' }) => void } | null>(null);
async function focusModel(index: number) {
    const model = visibleModels.value[index];
    if (!model) return;
    modelScroller.value?.scrollToIndex(index, { align: 'center' });
    // The virtualizer publishes its new visible window on the next frame.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await nextTick();
    listElement.value?.querySelector<HTMLElement>(`[data-model-id="${CSS.escape(model.id)}"] button`)?.focus({ preventScroll: true });
}
function onListKeydown(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-model-id]');
    if (!row) return;
    const current = visibleModels.value.findIndex(model => model.id === row.dataset.modelId);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleModels.value.length - 1
        : current + (event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    void focusModel(Math.max(0, Math.min(visibleModels.value.length - 1, next)));
}

function onSelectModel(m: OpenRouterModel) {
    selectedId.value = m.id;
    if (!isDesktop.value) {
        detailSheetOpen.value = true;
    }
}

const LAST_MODEL_KEY = 'last_selected_model';

function useSelectedModel(m: OpenRouterModel) {
    void recordRecentModel(m.id).catch(() => {});
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
    { flush: 'post', immediate: true }
);

// Reset transient overlay state when the modal closes.
watch(open, (value) => {
    if (value) {
        void loadRecentModels().catch(() => {});
        void workspaceModels.load().catch(() => { policyError.value = 'Could not load workspace choices. Try again.'; });
    } else {
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
    if (e.key !== '/' || filtersOpen.value || detailSheetOpen.value) return;
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
        await Promise.all([refreshModels(), workspaceModels.load().then(() => { policyError.value = ''; })]);
    } catch (e) {
        console.warn('[ModelCatalog] model refresh failed', e);
    } finally {
        refreshing.value = false;
    }
}

onMounted(() => {
    void fetchModels().catch((error) => console.warn('[ModelCatalog] model fetch failed', error));

    void loadRecentModels().catch(() => {});
    void workspaceModels.load().catch(() => { policyError.value = 'Could not load workspace choices. Try again.'; });
    getFavoriteModels().then((models) => {
        favoriteModels.value = models;
    });
});
</script>

<style scoped>
.mc-overlay-left-enter-active,
.mc-overlay-left-leave-active {
    transition: opacity var(--app-motion-duration-medium, 0.18s)
        var(--app-motion-easing-standard, ease);
}
.mc-overlay-left-enter-from,
.mc-overlay-left-leave-to {
    opacity: 0;
}
.mc-overlay-left-enter-active .mc-panel,
.mc-overlay-left-leave-active .mc-panel {
    transition: transform var(--app-motion-duration-medium, 0.18s)
        var(--app-motion-easing-standard, ease);
}
.mc-overlay-left-enter-from .mc-panel,
.mc-overlay-left-leave-to .mc-panel {
    transform: translateX(-100%);
}
.mc-overlay-right-enter-active,
.mc-overlay-right-leave-active {
    transition:
        opacity var(--app-motion-duration-medium, 0.18s)
            var(--app-motion-easing-standard, ease),
        transform var(--app-motion-duration-medium, 0.18s)
            var(--app-motion-easing-standard, ease);
}
.mc-overlay-right-enter-from,
.mc-overlay-right-leave-to {
    opacity: 0;
    transform: translateX(24px);
}
</style>
