<template>
    <div
        id="model-select-root"
        v-if="show"
        class="model-select-container inline-block"
    >
        <USelectMenu
            id="model-select-menu"
            v-model="internalModel"
            :items="items"
            :value-key="'value'"
            :disabled="loading"
            v-bind="selectMenuProps"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { isMobile } from '~/state/global';
import { useThemeOverrides } from '~/composables/useThemeResolver';

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

// Theme overrides for select menu
const selectMenuProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'selectmenu',
        context: 'chat',
        identifier: 'chat.model-select',
        isNuxtUI: true,
    });

    return {
        // Default props
        class: 'h-[32px] text-sm rounded-md border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] px-2 bg-white dark:bg-gray-800 w-full min-w-[100px] max-w-[320px]',
        searchInput: {
            icon: 'pixelarticons:search',
            autofocus: !isMobile.value,
            ui: {
                base: 'border-0 border-b-1 rounded-none!',
                leadingIcon: 'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
            },
        },
        // Theme overrides
        ...(overrides.value as any),
    };
});

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
</script>

<style scoped></style>
