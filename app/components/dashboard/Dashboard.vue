<template>
    <AppModal
        id="dashboard-modal-shell"
        v-bind="dashboardModalOverrides"
        :size="state.view === 'dashboard' ? 'md' : 'lg'"
        v-model:open="open"
        :modal="true"
        title="Dashboard"
        :dismissible="true"
        description="Browse all apps, plugins, and settings."
    >
        <template #default>
            <div
                v-if="state.view === 'dashboard'"
                id="dashboard-grid-view"
                class="w-full"
            >
                <div
                    v-if="shouldDeferDashboardGrid"
                    id="dashboard-grid-loading"
                    class="text-sm opacity-70 px-1"
                >
                    Loading dashboard...
                </div>
                <div
                    v-else
                    id="dashboard-plugin-grid"
                    class="dashboard-plugin-grid"
                >
                    <plugin-icons
                        v-for="item in dashboardItems"
                        :key="item.id"
                        class="dashboard-plugin-icon-item"
                        :icon="item.icon"
                        :image="item.image"
                        :label="item.label"
                        :description="item.description"
                        @click="handlePluginClick(item.id)"
                    />
                </div>
            </div>
            <div
                v-if="state.view === 'page'"
                id="dashboard-page-view"
                class="h-[min(640px,calc(100dvh-12rem))] flex flex-col min-h-0 min-w-0 max-w-full"
            >
                <div
                    id="dashboard-page-header"
                    class="flex h-14 shrink-0 items-center border-b-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[color:var(--md-border-color)] px-3 sm:px-5"
                >
                    <UButton
                        id="dashboard-back-button"
                        aria-label="Return to dashboard overview"
                        v-bind="backButtonProps"
                        class="text-[20px] gap-0.5"
                        @click="reset()"
                    >
                        <UIcon
                            class="h-6 w-6"
                            :name="useIcon('ui.chevron.left').value"
                        />
                    </UButton>
                    <div
                        id="dashboard-page-breadcrumb"
                        class="ml-2 font-semibold text-sm truncate"
                    >
                        {{ headerPluginLabel }}
                        <span
                            v-if="activePageTitle && activePageTitle !== headerPluginLabel"
                            class="text-[var(--md-on-surface)]"
                            >/ {{ activePageTitle }}</span
                        >
                    </div>
                </div>
                <div
                    v-if="state.error"
                    id="dashboard-page-error"
                    class="mx-4 mt-3 rounded-[var(--md-border-radius)] border-[var(--md-border-width)] border-(--md-error) bg-(--md-error-container) px-3 py-2 text-xs text-(--md-on-error-container)"
                >
                    {{ state.error.message }}
                </div>
                <!-- Landing list if multiple pages and none chosen -->
                <div
                    v-if="!state.activePageId && landingPages.length > 1"
                    id="dashboard-landing-grid"
                    class="p-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                >
                    <button
                        v-for="p in landingPages"
                        :key="p.id"
                        v-bind="landingPageButtonProps"
                        :class="[
                            'dashboard-landing-item group flex flex-col items-start gap-2 p-3 text-left',
                            (landingPageButtonProps as any)?.class || '',
                        ]"
                        @click="handleLandingPageClick(p.id)"
                    >
                        <div class="flex items-center gap-2">
                            <AppIcon
                                v-if="p.image || p.icon"
                                :image="p.image"
                                :icon="p.icon"
                                class="w-5 h-5 opacity-80 group-hover:opacity-100"
                            />
                            <span class="font-medium text-sm">{{
                                p.title
                            }}</span>
                        </div>
                        <p
                            v-if="p.description"
                            class="text-xs opacity-70 leading-snug line-clamp-3"
                        >
                            {{ p.description }}
                        </p>
                    </button>
                </div>
                <!-- Single page or chosen page -->
                <div
                    v-else
                    id="dashboard-page-content"
                    class="dashboard-page-scroll flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden bg-[var(--md-surface-container-low)]"
                >
                    <div
                        v-if="state.loadingPage"
                        id="dashboard-page-loading"
                        class="text-sm opacity-70 p-4"
                    >
                        Loading…
                    </div>
                    <component
                        v-else-if="resolvedPageComponent"
                        :is="resolvedPageComponent"
                    />
                    <div
                        v-else-if="
                            !state.activePageId && landingPages.length === 1
                        "
                        id="dashboard-single-landing-placeholder"
                        class="text-xs opacity-60"
                    >
                        Preparing page…
                    </div>
                    <div
                        v-else-if="!landingPages.length"
                        id="dashboard-empty-placeholder"
                        class="text-xs"
                    >
                        No pages registered for this plugin.
                    </div>
                </div>
            </div>
        </template>
    </AppModal>
</template>
<script setup lang="ts">
import { computed, provide } from 'vue';
import PluginIcons from './PluginIcons.vue';
import AppModal from '~/components/ui/AppModal.vue';
import AppIcon from '~/components/ui/AppIcon.vue';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';
import { createCoreDashboardItems } from '~/core/dashboard/core-items';
import { useRuntimeConfig } from '#imports';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { projectProfileItems } from '~/core/workspace-profiles';

const props = defineProps<{
    showModal: boolean;
}>();

const emit = defineEmits<{ (e: 'update:showModal', value: boolean): void }>();

// Bridge the shared modal's open state to the existing dashboard API.
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

provide('or3:dashboard:close', () => { open.value = false; });

const runtimeConfig = useRuntimeConfig();
const ssrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
const sessionContext = ssrAuthEnabled ? useSessionContext() : null;
const shouldDeferDashboardGrid = computed(
    () =>
        ssrAuthEnabled &&
        sessionContext?.pending.value === true &&
        sessionContext?.data.value === null
);

// Core (built-in) items; can be overridden by external plugin with same id
const coreItems = createCoreDashboardItems(ssrAuthEnabled);

const {
    state,
    resolvedPageComponent,
    dashboardItems: rawDashboardItems,
    landingPages,
    headerPluginLabel,
    activePageTitle,
    openPlugin,
    openPage,
    reset,
} = useDashboardNavigation({ baseItems: coreItems });

const dashboardItems = computed(() =>
    projectProfileItems('dashboard', rawDashboardItems.value)
);

const handlePluginClick = (pluginId: string) => {
    void openPlugin(pluginId);
};

const handleLandingPageClick = (pageId: string) => {
    const pluginId = state.activePluginId;
    if (!pluginId) return;
    void openPage(pluginId, pageId);
};

// Theme overrides for Nuxt UI elements
const dashboardModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'dashboard',
    identifier: 'dashboard.shell',
    isNuxtUI: true,
});

const backButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.back',
        isNuxtUI: true,
    });
    return {
        variant: 'subtle' as const,
        color: 'primary' as const,
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});

const landingPageButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.landing-page',
        isNuxtUI: false,
    });
    return overrides.value;
});
</script>

<style scoped>
#dashboard-grid-view {
    display: flex;
    justify-content: center;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
}

.dashboard-page-scroll {
    scrollbar-gutter: stable;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
}

#dashboard-page-view,
#dashboard-page-header,
#dashboard-landing-grid {
    min-width: 0;
    max-width: 100%;
}

#dashboard-plugin-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    width: 100%;
}

@media (max-width: 540px) {
    #dashboard-plugin-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }
}

@media (max-width: 360px) {
    #dashboard-plugin-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
