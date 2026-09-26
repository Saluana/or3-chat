<script setup lang="ts">
import { useThemeOverrides } from '~/composables/useThemeResolver';
import AppIcon from '~/components/ui/AppIcon.vue';

defineProps<{
    icon?: string;
    image?: string;
    label: string;
    description?: string;
}>();

const iconButtonProps = useThemeOverrides({
    component: 'button',
    context: 'dashboard',
    identifier: 'dashboard.plugin-icon',
    isNuxtUI: false,
});
</script>

<template>
    <button
        v-bind="iconButtonProps"
        type="button"
        :aria-label="label"
        class="dashboard-plugin-icon dashboard-plugin-icon-button group flex min-w-0 flex-col items-center gap-3 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface-variant)] p-5 text-center text-[var(--md-on-surface)] cursor-pointer hover:bg-[var(--md-surface-hover)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
    >
        <AppIcon
            :image="image"
            :icon="icon"
            class="dashboard-button-icon size-9 shrink-0"
        />
        <span class="flex min-w-0 flex-col gap-1">
            <span class="dashboard-plugin-icon-label text-sm font-semibold break-words">
                {{ label }}
            </span>
            <span
                v-if="description"
                class="text-xs leading-5 text-[var(--md-on-surface-variant)] line-clamp-3"
            >
                {{ description }}
            </span>
        </span>
    </button>
</template>
