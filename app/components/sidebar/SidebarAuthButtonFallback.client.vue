<template>
    <UButton v-bind="buttonProps" type="button" disabled aria-label="Authentication unavailable">
        <template #default>
            <span class="flex flex-col items-center gap-1 w-full">
                <UIcon :name="iconUser" class="h-[18px] w-[18px]" />
                <span class="text-[7px] uppercase tracking-wider whitespace-nowrap">
                    Auth Off
                </span>
            </span>
        </template>
    </UButton>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';

const iconUser = useIcon('sidebar.user');

const buttonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.auth',
        state: 'disconnected',
        isNuxtUI: true,
    });
    return {
        block: true,
        ...overrides.value,
    };
});
</script>
