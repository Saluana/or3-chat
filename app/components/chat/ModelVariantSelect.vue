<template>
    <USelectMenu
        v-if="items.length"
        v-model="selected"
        :items="items"
        value-key="value"
        :search-input="false"
        :disabled="disabled"
        :size="size"
        :aria-label="ariaLabel"
        class="border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] ring-0!"
        :ui="{
            content:
                'ring-0! border-[length:var(--md-border-width)] border-[color:color-mix(in_srgb,var(--md-border-color)_45%,transparent)]',
        }"
    >
        <template #leading>
            <UIcon :name="activeIcon" class="size-4 shrink-0" aria-hidden="true" />
        </template>
        <template #item-leading="{ item }">
            <UIcon
                :name="item.icon"
                class="size-4 shrink-0"
                aria-hidden="true"
            />
        </template>
    </USelectMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useModelVariantItems } from '~/composables/chat/useModelVariantItems';
import {
    OPENROUTER_OPTION_DESCRIPTORS,
    sanitizeModelVariant,
} from '~~/shared/openrouter/model-variants';
import type { ModelOptionDescriptor } from '~~/shared/ai/types';

const props = withDefaults(
    defineProps<{
        modelValue?: string | null;
        disabled?: boolean;
        size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
        ariaLabel?: string;
        options?: readonly ModelOptionDescriptor[];
    }>(),
    { modelValue: 'off', disabled: false, size: 'md', ariaLabel: 'Model variant' }
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
}>();

const items = useModelVariantItems(() => props.options ?? OPENROUTER_OPTION_DESCRIPTORS);

const selected = computed<string>({
    get: () => props.options === undefined ? sanitizeModelVariant(props.modelValue) : props.modelValue ?? '',
    set: (value) => emit('update:modelValue', props.options === undefined ? sanitizeModelVariant(value) : value),
});

const activeIcon = computed(
    () => items.value.find((item) => item.value === selected.value)?.icon ?? ''
);
</script>
