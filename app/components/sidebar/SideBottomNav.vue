<template>
    <div
        v-bind="rootAttrs"
        :id="
            (typeof attrs.id === 'string' ? attrs.id : null) ??
            'bottom-nav-root'
        "
        class="bottomnav-root absolute bottom-0 w-[63.5px] border-t-[var(--md-border-width)] border-[color:var(--md-border-color)] bg-transparent px-1 flex flex-col items-center justify-between"
    >
        <!-- MY INFO (OpenRouter only - hidden in SSR auth mode) -->
        <UPopover
            v-if="!isSsrAuthEnabled"
            :content="{
                side: 'right',
            }"
        >
            <UTooltip
                id="tooltip-account-info"
                :delay-duration="0"
                :content="{
                    side: 'right',
                }"
                text="My Info"
            >
                <UButton
                    v-bind="infoButtonProps"
                    type="button"
                    aria-label="My Info"
                >
                    <template #default>
                        <span class="flex flex-col items-center gap-1 w-full">
                            <UIcon :name="iconUser" class="h-[24px] w-[24px]" />
                        </span>
                    </template>
                </UButton>
            </UTooltip>
            <template #content>
                <div class="flex flex-col items-start w-[140px]">
                    <UButton
                        v-bind="activityButtonProps"
                        @click="navigateToActivity"
                    >
                        <UIcon :name="iconActivity" class="mr-1.5" />
                        Activity
                    </UButton>
                    <UButton
                        v-bind="creditsButtonProps"
                        @click="navigateToCredits"
                    >
                        <UIcon :name="iconCredits" class="mr-1.5" />
                        Credits
                    </UButton>
                </div>
            </template>
        </UPopover>

        <!-- DASHBOARD -->
        <UTooltip
            v-if="dashboardEnabled"
            id="tooltip-dashboard"
            :delay-duration="0"
            :content="{
                side: 'right',
            }"
            text="Dashboard"
        >
            <UButton
                v-bind="dashboardButtonProps"
                @click="emit('toggleDashboard')"
                type="button"
                aria-label="Dashboard"
            >
                <template #default>
                    <span class="flex flex-col items-center gap-1 w-full">
                        <UIcon
                            class="w-[24px] h-[24px]"
                            :name="iconDashboard"
                        />
                    </span>
                </template>
            </UButton>
        </UTooltip>

        <!-- Visual separator between app tools and personal section -->
        <div
            class="w-[40px] h-[var(--md-border-width)] bg-[var(--md-border-color)]/50 my-1 sb-bottom-border"
        />

        <!-- Auth Button (Clerk SSR or OpenRouter) -->
        <SidebarAuthButton />
    </div>
    <lazy-modal-model-catalog
        hydrate-on-visible
        v-model:showModal="showSettingsModal"
    />
</template>

<script lang="ts" setup>
import { computed, ref, useAttrs } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useOr3Config } from '~/composables/useOr3Config';

const iconUser = useIcon('sidebar.user');
const iconActivity = useIcon('sidebar.activity');
const iconCredits = useIcon('sidebar.credits');
const iconDashboard = useIcon('dashboard.home');
const or3Config = useOr3Config();
const dashboardEnabled = computed(() => or3Config.features.dashboard.enabled);

// Check if SSR auth is enabled via runtime config
const config = useRuntimeConfig();
const isSsrAuthEnabled = computed(() => config.public?.ssrAuthEnabled === true);

defineOptions({ inheritAttrs: false });
const showSettingsModal = ref(false);
const attrs = useAttrs();
const rootAttrs = computed(() => {
    return Object.fromEntries(
        Object.entries(attrs).filter(([key]) => key !== 'id')
    ) as Record<string, unknown>;
});

const emit = defineEmits(['toggleDashboard']);

// Theme-integrated button props
const infoButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.info',
        isNuxtUI: true,
    });
    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        ...overrides.value,
    };
});

const dashboardButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.dashboard',
        isNuxtUI: true,
    });
    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        ...overrides.value,
    };
});

// Popover menu buttons
const activityButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.activity',
        isNuxtUI: true,
    });
    return {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        block: true,
        ...overrides.value,
    };
});

const creditsButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.credits',
        isNuxtUI: true,
    });
    return {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        block: true,
        ...overrides.value,
    };
});

function navigateToActivity() {
    window.open('https://openrouter.ai/activity', '_blank');
}

function navigateToCredits() {
    window.open('https://openrouter.ai/settings/credits', '_blank');
}
</script>

<style scoped>
/* Root area background uses configurable bottom nav color */
.bottomnav-root {
    justify-content: flex-start;
    gap: 4px; /* MD3 vertical spacing unit */
    /* Respect device safe areas so the bottom button never collides with OS UI */
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
</style>
