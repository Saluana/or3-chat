<template>
    <USelectMenu
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
    sanitizeModelVariant,
    type OpenRouterModelVariant,
} from '~~/shared/openrouter/model-variants';

const props = withDefaults(
    defineProps<{
        modelValue?: OpenRouterModelVariant | null;
        disabled?: boolean;
        size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
        ariaLabel?: string;
    }>(),
    { modelValue: 'off', disabled: false, size: 'md', ariaLabel: 'Model variant' }
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: OpenRouterModelVariant): void;
}>();

const items = useModelVariantItems();

const selected = computed<OpenRouterModelVariant>({
    get: () => sanitizeModelVariant(props.modelValue),
    set: (value) => emit('update:modelValue', sanitizeModelVariant(value)),
});

const activeIcon = computed(
    () => items.value.find((item) => item.value === selected.value)?.icon ?? ''
);
</script>
