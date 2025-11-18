<template>
    <UButton v-bind="glassButtonProps"><slot></slot></UButton>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const glassButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'ui',
        identifier: 'ui.glass-button',
        isNuxtUI: true,
    });
    return {
        class: 'w-full',
        ...(overrides.value as any),
    };
});
</script>
