<template>
    <button
        v-if="layout === 'more-sheet'"
        type="button"
        class="more-row"
        disabled
        aria-label="Authentication unavailable"
    >
        <span class="more-row-icon more-row-icon--admin" aria-hidden="true">
            <UIcon :name="iconUser" />
        </span>
        <span class="more-row-copy">
            <span class="more-row-label">Account</span>
            <span class="more-row-desc">Authentication unavailable</span>
        </span>
    </button>
    <UButton
        v-else
        v-bind="buttonProps"
        type="button"
        disabled
        aria-label="Authentication unavailable"
    >
        <template #default>
            <span class="flex flex-col items-center gap-1 w-full">
                <UIcon :name="iconUser" class="h-[18px] w-[18px]" />
                <span
                    class="sidebar-rail-caption text-[7px] uppercase tracking-wider whitespace-nowrap"
                >
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

defineProps<{
    layout?: 'rail' | 'more-sheet';
}>();

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
