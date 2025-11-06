<template>
    <UTooltip :text="label" :placement="'bottom'">
        <button
            :class="buttonClasses"
            :title="label"
            :aria-pressed="active ? 'true' : 'false'"
            :aria-label="computedAriaLabel"
            type="button"
            @click="$emit('activate')"
        >
            <template v-if="text">{{ text }}</template>
            <template v-else-if="icon">
                <UIcon :name="icon" class="w-4 h-4" />
            </template>
        </button>
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
const square = computed(
    () => !props.text || (props.text && props.text.length <= 2)
);

// Theme integration for toolbar button
const toolbarButtonOverrides = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'document',
        identifier: 'document.toolbar',
        isNuxtUI: false,
    });
    return overrides.value;
});

// Compute final button classes with theme overrides
const buttonClasses = computed(() => {
    const themeClass = (toolbarButtonOverrides.value as any)?.class || '';
    const baseClasses = 'h-[32px] md:h-[40px] py-0 flex items-center justify-center gap-1 border-2 rounded-[4px] text-sm leading-none';
    const stateClasses = props.active
        ? 'bg-primary/40 aria-[pressed=true]:outline'
        : 'opacity-80 hover:opacity-100';
    const sizeClasses = square.value ? 'w-[32px] md:w-[40px] p-0' : 'p-0';
    
    return `${themeClass} ${baseClasses} ${stateClasses} ${sizeClasses}`.trim();
});
</script>

<style scoped>
button {
    font-family: inherit;
}
</style>
