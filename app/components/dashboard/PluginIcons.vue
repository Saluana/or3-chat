<script setup lang="ts">
import { useThemeOverrides } from '~/composables/useThemeResolver';
import AppIcon from '~/components/ui/AppIcon.vue';
import { useIcon } from '~/composables/useIcon';
import type { IconToken } from '~/config/icon-tokens';

defineProps<{
    icon?: string;
    iconToken?: IconToken;
    image?: string;
    label: string;
    description?: string;
}>();

const chevronIcon = useIcon('ui.chevron.right');
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
        class="dashboard-plugin-icon dashboard-plugin-icon-button group flex min-w-0 items-center gap-4 rounded-[var(--md-border-radius-large,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-5 py-4 text-left text-[var(--md-on-surface)] cursor-pointer transition-colors duration-[var(--app-motion-duration-fast,100ms)] hover:bg-[var(--md-surface-hover)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
    >
        <AppIcon
            :image="image"
            :icon="icon"
            :icon-token="iconToken"
            class="dashboard-button-icon size-6 shrink-0 text-[var(--md-on-surface-variant)] group-hover:text-[var(--md-on-surface)]"
        />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="dashboard-plugin-icon-label truncate text-[15px] font-medium leading-6">
                {{ label }}
            </span>
            <span
                v-if="description"
                class="dashboard-plugin-icon-description text-[13px] leading-5 text-[var(--md-on-surface-variant)] line-clamp-2"
            >
                {{ description }}
            </span>
        </span>
        <!-- Shown only when the dashboard lays the tiles out as one list. -->
        <UIcon
            :name="chevronIcon"
            class="dashboard-plugin-chevron hidden size-[18px] shrink-0 text-[var(--md-on-surface-variant)]"
            aria-hidden="true"
        />
    </button>
</template>
