<template>
    <UModal
        v-model:open="open"
        title="Rename thread"
        :ui="{
            footer: 'justify-end border-t-2',
            header: 'border-b-2  border-black bg-primary p-0 min-h-[50px] text-white',
            body: 'p-0!',
        }"
        class="border-2 min-w-[720px]! overflow-hidden"
    >
        <template #header>
            <div class="flex w-full items-center justify-between pr-2">
                <h3 class="font-semibold text-sm">Settings</h3>
                <UButton
                    class="bg-white/90 hover:bg-white/95 active:bg-white/95 flex items-center justify-center"
                    :square="true"
                    variant="ghost"
                    size="xs"
                    icon="i-heroicons-x-mark"
                    @click="open = false"
                />
            </div>
        </template>
        <template #body>
            <div v-if="modelCatalog">
                <!-- Virtualized rows; each row is a chunk of models rendered as a CSS grid -->
                <VList
                    :data="chunkedModels as OpenRouterModel[][]"
                    style="height: 75vh"
                    class="[scrollbar-color:rgb(156_163_175)_transparent] [scrollbar-width:thin] py-4 w-full px-0!"
                    :overscan="4"
                    #default="{ item: row, index }"
                >
                    <div
                        class="grid grid-cols-2 gap-5 px-6 w-full"
                        :class="gridColsClass"
                    >
                        <div
                            v-for="m in row"
                            :key="m.id"
                            class="group relative mb-5 retro-shadow flex flex-col justify-between rounded-xl border-2 border-black/90 dark:border-white/90 bg-white/80 dark:bg-neutral-900/70 backdrop-blur-sm shadow-sm hover:shadow-md transition overflow-hidden h-[170px] px-4 py-5"
                        >
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex flex-col min-w-0">
                                    <div
                                        class="font-medium text-sm truncate"
                                        :title="m.canonical_slug"
                                    >
                                        {{ m.canonical_slug }}
                                    </div>
                                    <div
                                        class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                                    >
                                        CTX {{ m.context_length }}
                                    </div>
                                </div>
                                <button
                                    class="text-yellow-500/60 hover:text-yellow-500 transition text-sm"
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
                                class="mt-2 grid grid-cols-2 gap-1 text-xs leading-tight"
                            >
                                <div class="flex flex-col">
                                    <span
                                        class="text-neutral-500 dark:text-neutral-400"
                                        >Input</span
                                    >
                                    <span class="font-semibold tabular-nums">{{
                                        formatPerMillion(
                                            m.pricing.prompt,
                                            m.pricing?.currency
                                        )
                                    }}</span>
                                </div>
                                <div class="flex flex-col items-end text-right">
                                    <span
                                        class="text-neutral-500 dark:text-neutral-400"
                                        >Output</span
                                    >
                                    <span class="font-semibold tabular-nums">{{
                                        formatPerMillion(
                                            m.pricing.completion,
                                            m.pricing?.currency
                                        )
                                    }}</span>
                                </div>
                            </div>
                            <div
                                class="mt-auto pt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400"
                            >
                                <span>{{
                                    m.architecture?.modality || 'text'
                                }}</span>
                                <span class="opacity-60">/1M tokens</span>
                            </div>
                            <div
                                class="absolute inset-0 pointer-events-none border border-black/5 dark:border-white/5 rounded-xl"
                            />
                        </div>
                    </div>
                </VList>
            </div>
        </template>
        <template #footer> </template>
    </UModal>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { VList } from 'virtua/vue';

const props = defineProps<{
    showModal: boolean;
}>();
const emit = defineEmits<{ (e: 'update:showModal', value: boolean): void }>();

// Bridge prop showModal to UModal's v-model:open (which emits update:open) by mapping update to parent event
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

const modelCatalog = ref<OpenRouterModel[]>([]);

// Fixed 3-column layout for consistent rows
const COLS = 2;
const gridColsClass = computed(() => ''); // class already on container; keep placeholder if future tweaks

const chunkedModels = computed(() => {
    const cols = COLS;
    const rows: OpenRouterModel[][] = [];
    for (let i = 0; i < modelCatalog.value.length; i += cols) {
        rows.push(modelCatalog.value.slice(i, i + cols));
    }
    return rows;
});

const {
    favoriteModels,
    catalog,
    fetchModels,
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();

onMounted(() => {
    fetchModels().then(() => {
        modelCatalog.value = catalog.value;
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
