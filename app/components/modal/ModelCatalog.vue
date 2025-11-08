<template>
    <UModal
        v-bind="modelCatalogModalProps"
        v-model:open="open"
        title="Model settings"
        description="Browse and favorite models from the OpenRouter catalog."
    >
        <template #body>
            <div class="model-catalog-shell flex flex-col h-full">
                <div
                    class="model-catalog-header px-6 border-b-2 border-black h-[50px] dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm flex items-center"
                >
                    <div
                        class="model-catalog-search flex items-center gap-3 w-full"
                    >
                        <div
                            class="model-catalog-search-input-wrapper relative w-full max-w-md"
                        >
                            <UInput
                                v-model="searchQuery"
                                v-bind="searchInputProps"
                                class="model-catalog-search-input w-full pr-8"
                                autofocus
                            />
                            <button
                                v-if="searchQuery"
                                type="button"
                                aria-label="Clear search"
                                class="absolute inset-y-0 right-2 my-auto h-5 w-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-white transition"
                                @click="searchQuery = ''"
                            >
                                <UIcon
                                    name="i-heroicons-x-mark"
                                    class="h-4 w-4"
                                />
                            </button>
                        </div>
                        <UButton
                            v-bind="refreshButtonProps"
                            :disabled="refreshing"
                            class="model-catalog-refresh-btn retro-btn border-2 dark:border-white/70 border-black/80 flex items-center justify-center min-w-[34px]"
                            aria-label="Refresh model catalog"
                            :title="
                                refreshing
                                    ? 'Refreshing…'
                                    : 'Force refresh models (bypass cache)'
                            "
                            @click="doRefresh"
                        >
                            <UIcon
                                v-if="!refreshing"
                                name="i-heroicons-arrow-path"
                                class="h-4 w-4"
                            />
                            <UIcon
                                v-else
                                name="i-heroicons-arrow-path"
                                class="h-4 w-4 animate-spin"
                            />
                        </UButton>
                    </div>
                </div>
                <div
                    v-if="!searchReady"
                    class="model-catalog-loading p-6 text-sm text-neutral-500"
                >
                    Indexing models…
                </div>
                <div v-else class="model-catalog-list flex-1 min-h-0">
                    <VList
                        :data="chunkedModels as OpenRouterModel[][]"
                        style="height: 100%"
                        class="model-catalog-list__rows [scrollbar-color:rgb(156_163_175)_transparent] [scrollbar-width:thin] sm:py-4 w-full px-0!"
                        :overscan="4"
                        #default="{ item: row }"
                    >
                        <div
                            class="model-catalog-row grid grid-cols-1 sm:grid-cols-2 sm:gap-5 pt-2 sm:pt-0 px-2 sm:px-6 w-full"
                            :class="gridColsClass"
                        >
                            <div
                                v-for="m in row"
                                :key="m.id"
                                class="model-catalog-item group relative mb-5 retro-shadow flex flex-col justify-between rounded-xl border-2 border-black/90 dark:border-white/90 bg-white/80 not-odd:bg-primary/5 dark:bg-neutral-900/70 backdrop-blur-sm shadow-sm hover:shadow-md transition overflow-hidden h-[170px] px-4 py-5"
                                :data-model-id="m.id"
                            >
                                <div
                                    class="model-catalog-item__header flex items-start justify-between gap-2"
                                >
                                    <div
                                        class="model-catalog-item__title-area flex flex-col min-w-0"
                                    >
                                        <div
                                            class="model-catalog-item__title font-medium text-sm truncate"
                                            :title="m.canonical_slug"
                                        >
                                            {{ m.canonical_slug }}
                                        </div>
                                        <div
                                            class="model-catalog-item__context text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                                        >
                                            CTX {{ m.context_length }}
                                        </div>
                                    </div>
                                    <button
                                        class="model-catalog-item__favorite text-yellow-400 hover:text-yellow-500 hover:text-shadow-sm transition text-[24px] cursor-pointer"
                                        :aria-pressed="isFavorite(m)"
                                        @click.stop="toggleFavorite(m)"
                                        :title="
                                            isFavorite(m)
                                                ? 'Unfavorite'
                                                : 'Favorite'
                                        "
                                    >
                                        <span v-if="isFavorite(m)">★</span>
                                        <span v-else>☆</span>
                                    </button>
                                </div>
                                <div
                                    class="model-catalog-item__pricing mt-2 grid grid-cols-2 gap-1 text-xs leading-tight"
                                >
                                    <div
                                        class="model-catalog-item__pricing-vitals flex flex-col"
                                    >
                                        <span
                                            class="text-neutral-500 dark:text-neutral-400"
                                            >Input</span
                                        >
                                        <span
                                            class="font-semibold tabular-nums"
                                            >{{
                                                formatPerMillion(
                                                    m.pricing.prompt,
                                                    m.pricing?.currency
                                                )
                                            }}</span
                                        >
                                    </div>
                                    <div
                                        class="model-catalog-item__pricing-output flex flex-col items-end text-right"
                                    >
                                        <span
                                            class="text-neutral-500 dark:text-neutral-400"
                                            >Output</span
                                        >
                                        <span
                                            class="font-semibold tabular-nums"
                                            >{{
                                                formatPerMillion(
                                                    m.pricing.completion,
                                                    m.pricing?.currency
                                                )
                                            }}</span
                                        >
                                    </div>
                                </div>
                                <div
                                    class="model-catalog-item__footer mt-auto pt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400"
                                >
                                    <span>{{
                                        m.architecture?.modality || 'text'
                                    }}</span>
                                    <span class="opacity-60">/1M tokens</span>
                                </div>
                                <div
                                    class="model-catalog-item__outline absolute inset-0 pointer-events-none border border-black/5 dark:border-white/5 rounded-xl"
                                />
                            </div>
                        </div>
                    </VList>
                    <div
                        v-if="!chunkedModels.length && searchQuery"
                        class="model-catalog-empty px-6 pb-6 text-xs text-neutral-500"
                    >
                        No models match "{{ searchQuery }}".
                    </div>
                </div>
            </div>
        </template>
        <template #footer> </template>
    </UModal>
</template>
<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { VList } from 'virtua/vue';
import { useModelSearch } from '~/core/search/useModelSearch';
import type { OpenRouterModel } from '~/core/auth/models-service';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{
    showModal: boolean;
}>();
const emit = defineEmits<{ (e: 'update:showModal', value: boolean): void }>();

// Bridge prop showModal to UModal's v-model:open (which emits update:open) by mapping update to parent event
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

const modelCatalogModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'modal',
    identifier: 'modal.model-catalog',
    isNuxtUI: true,
});

const modelCatalogModalProps = computed(() => {
    const baseClass =
        'border-2 w-[98dvw] h-[98dvh] sm:min-w-[720px]! sm:min-h-[80dvh] sm:max-h-[80dvh] overflow-hidden';
    const baseUi = {
        footer: 'justify-end border-t-2',
        body: 'p-0!',
    } as Record<string, unknown>;

    const overrideValue =
        (modelCatalogModalOverrides.value as Record<string, unknown>) || {};
    const overrideClass =
        typeof overrideValue.class === 'string'
            ? (overrideValue.class as string)
            : '';
    const overrideUi =
        (overrideValue.ui as Record<string, unknown> | undefined) || {};
    const mergedUi = { ...baseUi, ...overrideUi };
    const rest = Object.fromEntries(
        Object.entries(overrideValue).filter(
            ([key]) => key !== 'class' && key !== 'ui'
        )
    ) as Record<string, unknown>;

    const result: Record<string, unknown> = {
        ...rest,
        ui: mergedUi,
    };

    const mergedClass = [baseClass, overrideClass].filter(Boolean).join(' ');
    if (mergedClass) {
        result.class = mergedClass;
    }

    return result;
});

const modelCatalog = ref<OpenRouterModel[]>([]);
// Search state (Orama index built client-side)
const {
    query: searchQuery,
    results: searchResults,
    ready: searchReady,
} = useModelSearch(modelCatalog);

const searchInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'modal',
        identifier: 'model-catalog.search-input',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
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
        icon: 'pixelarticons:search',
        placeholder: 'Search models (id, name, description, modality)',
        size: 'sm' as const,
        ...restOverrides,
        ui: {
            ...uiOverrides,
            base: baseUi,
        },
        class: [overrideClass].filter(Boolean).join(' '),
    };
});

const refreshButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'modal',
        identifier: 'model-catalog.refresh',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
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

// Fixed 3-column layout for consistent rows
const COLS = 2;
const gridColsClass = computed(() => ''); // class already on container; keep placeholder if future tweaks

const chunkedModels = computed(() => {
    const source = searchQuery.value.trim()
        ? searchResults.value
        : modelCatalog.value;
    const cols = COLS;
    const rows: OpenRouterModel[][] = [];
    for (let i = 0; i < source.length; i += cols) {
        rows.push(source.slice(i, i + cols));
    }
    return rows;
});

const {
    favoriteModels,
    getFavoriteModels,
    catalog,
    fetchModels,
    refreshModels,
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();

// Refresh state
const refreshing = ref(false);

async function doRefresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
        await refreshModels();
        modelCatalog.value = catalog.value.slice();
    } catch (e) {
        console.warn('[SettingsModal] model refresh failed', e);
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

/**
 * Format a per-token price into a "per 1,000,000 tokens" currency string.
 * Accepts numbers or numeric strings. Defaults to USD when no currency provided.
 */
function formatPerMillion(raw: unknown, currency = 'USD') {
    const perToken = Number(raw ?? 0);
    const perMillion = perToken * 1_000_000;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
        }).format(perMillion);
    } catch (e) {
        // Fallback: simple fixed formatting
        return `$${perMillion.toFixed(2)}`;
    }
}
</script>
