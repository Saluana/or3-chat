<template>
    <div
        id="model-select-root"
        v-if="show"
        class="model-select-container inline-flex w-full justify-end min-w-0 max-w-full"
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

    const overrideValue: Record<string, unknown> = overrides.value || {};
    const {
        searchInput,
        class: themeClass,
        ...restOverrides
    } = overrideValue;

    const baseClass =
        'h-[32px] text-[14px] px-2 w-full min-w-[100px] max-w-full truncate whitespace-nowrap';
    const mergedClass = [
        baseClass,
        typeof themeClass === 'string' ? themeClass : '',
    ]
        .filter(Boolean)
        .join(' ');

    interface SelectSearchInput {
        icon?: string;
        autofocus?: boolean;
        ui?: Record<string, unknown>;
        [key: string]: unknown;
    }

    const defaultSearchInput = {
        icon: useIcon('ui.search').value,
        autofocus: !isMobile.value,
        ui: {},
    };

    const themeSearchInput =
        searchInput && typeof searchInput === 'object'
            ? (searchInput as SelectSearchInput)
            : undefined;

    const mergedSearchInput = themeSearchInput
        ? {
              ...defaultSearchInput,
              ...themeSearchInput,
              ui: {
                  ...defaultSearchInput.ui,
                  ...(themeSearchInput.ui || {}),
              },
          }
        : defaultSearchInput;

    return {
        class: mergedClass,
        searchInput: mergedSearchInput,
        ...restOverrides,
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
    (favoriteModels.value || [])
        .map((m) => {
            const value = m.canonical_slug ?? m.id;
            if (!value) return null;
            return {
                label: value,
                value,
            };
        })
        .filter(
            (
                m
            ): m is {
                label: string;
                value: string;
            } => Boolean(m)
        )
);
</script>

<style scoped></style>
