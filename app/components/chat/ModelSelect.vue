<template>
    <div v-if="show" class="inline-block">
        <USelectMenu
            v-model="internalModel"
            :items="items"
            :value-key="'value'"
            :disabled="loading"
            :ui="ui"
            :search-input="searchInput"
            class="retro-btn h-[32px] text-sm rounded-md border px-2 bg-white dark:bg-gray-800 w-full min-w-[100px] max-w-[320px]"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { useModelStore } from '~/composables/useModelStore';

interface Emits {
    (e: 'update:model', value: string): void;
    (e: 'change', value: string): void;
}

const props = defineProps<{
    model?: string;
    loading?: boolean;
}>();
const emit = defineEmits<Emits>();

const { favoriteModels } = useModelStore();

// Mirror v-model
const internalModel = ref<string | undefined>(props.model);
watch(
    () => props.model,
    (val) => {
        if (val !== internalModel.value) internalModel.value = val;
    }
);
watch(internalModel, (val) => {
    if (typeof val === 'string') {
        emit('update:model', val);
        emit('change', val);
    }
});

const show = computed(
    () =>
        !!internalModel.value &&
        favoriteModels.value &&
        favoriteModels.value.length > 0
);

const items = computed(() =>
    favoriteModels.value.map((m: any) => ({
        label: m.canonical_slug,
        value: m.canonical_slug,
    }))
);

const ui = {
    content: 'border-[2px] border-black rounded-[3px] w-[320px]',
    input: 'border-0 rounded-none!',
    arrow: 'h-[18px] w-[18px]',
    itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
};

const searchInput = {
    icon: 'pixelarticons:search',
    ui: {
        base: 'border-0 border-b-1 rounded-none!',
        leadingIcon: 'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
    },
};
</script>

<style scoped></style>
