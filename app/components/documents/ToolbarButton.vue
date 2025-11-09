<template>
    <UTooltip :text="label" :placement="'bottom'">
        <UButton
            v-bind="toolbarButtonProps"
            :title="label"
            :aria-pressed="active ? 'true' : 'false'"
            :aria-label="computedAriaLabel"
            @click="$emit('activate')"
        >
            <template v-if="text">{{ text }}</template>
            <template v-else-if="icon">
                <UIcon :name="icon" class="w-4 h-4" />
            </template>
        </UButton>
    </UTooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{
    icon?: string;
    active?: boolean;
    label?: string;
    text?: string;
}>();
defineEmits<{ (e: 'activate'): void }>();

const computedAriaLabel = computed(() => props.text || props.label || '');
const square = computed<boolean>(() => {
    const text = props.text;
    if (!text) return true;
    return text.length <= 2;
});

// Theme integration for toolbar button
const themeOverride = useThemeOverrides({
    component: 'button',
    context: 'document',
    identifier: 'document.toolbar',
    isNuxtUI: true,
});

const baseClasses =
    'document-toolbar-button retro-document-toolbar-button h-[32px] md:h-[40px] py-0 flex items-center justify-center gap-1 text-sm leading-none';

const stateClasses = computed(() =>
    props.active
        ? 'bg-primary/40 aria-[pressed=true]:outline'
        : 'opacity-80 hover:opacity-100'
);

const sizeClasses = computed(() =>
    square.value ? 'w-[32px] md:w-[40px] p-0' : 'p-0'
);

const toolbarButtonProps = computed(() => {
    const overrideProps = (themeOverride.value || {}) as Record<
        string,
        unknown
    >;
    const {
        class: overrideClass = '',
        onClick: _unusedClick,
        ...restOverrides
    } = overrideProps ?? {};

    return {
        square: square.value,
        size: 'sm' as const,
        variant: 'ghost' as const,
        type: 'button' as const,
        ...restOverrides,
        class: [
            baseClasses,
            stateClasses.value,
            sizeClasses.value,
            overrideClass as string,
        ]
            .filter(Boolean)
            .join(' '),
    };
});
</script>

<style scoped>
button {
    font-family: inherit;
}
</style>
