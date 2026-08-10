<template>
    <div
        v-bind="rootAttrs"
        :id="
            (typeof attrs.id === 'string' ? attrs.id : null) ??
            'bottom-nav-root'
        "
        class="bottomnav-root absolute bottom-0 w-[63.5px] bg-transparent px-1 flex flex-col items-center justify-between"
    >
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
            class="w-[40px] h-[var(--md-border-width-subtle,var(--md-border-width,1px))] bg-[var(--md-border-color)]/50 my-1 sb-bottom-border"
        />

        <!-- Auth Button (Clerk SSR or OpenRouter) - placed above user info -->
        <component :is="sidebarAuthButtonComponent" />

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

        <!-- Mode badge: shows Local / Cloud so users always know what they're running -->
        <UTooltip
            :delay-duration="0"
            :content="{
                side: 'right',
            }"
            :text="modeTooltip"
        >
            <component
                :is="modeLinkComponent"
                v-bind="modeLinkProps"
                :aria-label="modeLabel"
                class="sidebar-mode-badge mt-auto mb-1 block rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-[length:var(--md-border-width)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider whitespace-nowrap"
                :class="
                    isSsrAuthEnabled
                        ? 'border-[var(--md-primary)]/40 text-[var(--md-primary)]'
                        : 'border-[var(--md-border-color)] text-[var(--md-secondary)]'
                "
            >
                {{ modeLabel }}
            </component>
        </UTooltip>
    </div>
    <component
        :is="modelCatalogModalComponent"
        v-model:showModal="showSettingsModal"
    />
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref, useAttrs } from 'vue';
import { useNuxtApp, useRuntimeConfig } from '#imports';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useOr3Config } from '~/composables/useOr3Config';
import SidebarAuthButton from '~/components/sidebar/SidebarAuthButton.vue';

const iconUser = useIcon('sidebar.user');
const iconActivity = useIcon('sidebar.activity');
const iconCredits = useIcon('sidebar.credits');
const iconDashboard = useIcon('dashboard.home');
const or3Config = useOr3Config();
const dashboardEnabled = computed(() => or3Config.features.dashboard.enabled);
const themePlugin = useNuxtApp().$theme;
const modelCatalogModalDefault = defineAsyncComponent(
    () => import('~/components/modal/ModelCatalog.vue')
);
const sidebarAuthButtonComponent = computed(
    () =>
        themePlugin?.activeComponents?.value?.['sidebar-auth-button'] ??
        SidebarAuthButton
);
const modelCatalogModalComponent = computed(
    () =>
        themePlugin?.activeComponents?.value?.['model-catalog-modal'] ??
        modelCatalogModalDefault
);

// Check if SSR auth is enabled via runtime config
const config = useRuntimeConfig();
const isSsrAuthEnabled = computed(() => config.public?.ssrAuthEnabled === true);

// Mode badge: shows the active runtime mode so users aren't guessing.
const modeLabel = computed(() => (isSsrAuthEnabled.value ? 'Cloud' : 'Local'));
const modeTooltip = computed(() =>
    isSsrAuthEnabled.value
        ? 'Cloud mode — user accounts, sync & file storage enabled. Click to open admin dashboard.'
        : 'Local mode — your data stays in this browser. Run `bun run or3-cloud:init` to enable accounts & sync.'
);
const modeLinkComponent = computed(() => (isSsrAuthEnabled.value ? 'NuxtLink' : 'div'));
const modeLinkProps = computed(() =>
    isSsrAuthEnabled.value ? { to: '/admin', external: false } : {}
);

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
