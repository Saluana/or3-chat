<template>
    <UModal
        v-model:open="open"
        title="Rename thread"
        :ui="{
            footer: 'justify-end border-t-2',
            header: 'border-b-2 border-black bg-primary p-0 min-h-[50px] text-white',
        }"
        class="border-2"
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
                <VList
                    :data="modelCatalog as OpenRouterModel[]"
                    style="height: 500px"
                    class="[scrollbar-color:rgb(156_163_175)_transparent] [scrollbar-width:thin] w-full px-0!"
                    #default="{ item, index }"
                >
                    <div
                        class="flex w-full justify-between border-2 border-black px-3 py-1 mb-1"
                    >
                        <div>{{ item.canonical_slug }}</div>
                        <div>
                            {{
                                formatPerMillion(
                                    item.pricing.prompt,
                                    item.pricing?.currency
                                )
                            }}/M
                        </div>
                        <div>
                            {{
                                formatPerMillion(
                                    item.pricing.completion,
                                    item.pricing?.currency
                                )
                            }}/M
                        </div>
                        <div>CTX:{{ item.context_length }}</div>
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
