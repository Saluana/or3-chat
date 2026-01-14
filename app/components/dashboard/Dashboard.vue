<template>
    <UModal
        id="dashboard-modal-shell"
        v-bind="dashboardModalProps"
        v-model:open="open"
        :modal="false"
        title="Dashboard"
        :dismissible="false"
        description="Browse all apps, plugins, and settings."
    >
        <template #body>
            <!-- iOS style springboard grid: fixed icon cell width per breakpoint, centered, nice vertical rhythm -->
            <div
                v-if="state.view === 'dashboard'"
                id="dashboard-grid-view"
                class="p-4 flex justify-start w-full"
            >
                <div id="dashboard-plugin-grid" class="dashboard-plugin-grid">
                    <plugin-icons
                        v-for="item in dashboardItems"
                        :key="item.id"
                        class="dashboard-plugin-icon-item"
                        :icon="item.icon"
                        :label="item.label"
                        :size="pluginIconSize"
                        :radius="3"
                        @click="handlePluginClick(item.id)"
                    />
                </div>
            </div>
            <div
                v-if="state.view === 'page'"
                id="dashboard-page-view"
                class="h-full flex flex-col min-h-0"
            >
                <div
                    id="dashboard-page-header"
                    class="flex h-10 shrink-0 items-center border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)] pr-2 px-4"
                >
                    <UButton
                        id="dashboard-back-button"
                        v-bind="backButtonProps"
                        class="ml-2 text-[20px] gap-0.5"
                        @click="goBack()"
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
                        <span v-if="activePageTitle" class="opacity-60"
                            >/ {{ activePageTitle }}</span
                        >
                    </div>
                </div>
                <div
                    v-if="state.error"
                    id="dashboard-page-error"
                    class="mx-4 mt-3 rounded-md border-[var(--md-border-width)] border-(--md-error) bg-(--md-error-container) px-3 py-2 text-xs text-(--md-on-error-container)"
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
                            <UIcon
                                v-if="p.icon"
                                :name="p.icon"
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
                    class="flex-1 min-h-0 overflow-y-auto"
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
    </UModal>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import PluginIcons from './PluginIcons.vue';
import {
    useDashboardNavigation,
    registerDashboardPluginPage,
    type DashboardPlugin,
} from '~/composables';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { isMobile } from '~/state/global';

const props = defineProps<{
    showModal: boolean;
}>();

const emit = defineEmits<{ (e: 'update:showModal', value: boolean): void }>();

// Bridge prop showModal to UModal's v-model:open (which emits update:open) by mapping update to parent event
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

// Core (built-in) items; can be overridden by external plugin with same id
const coreItems: DashboardPlugin[] = [
    {
        id: 'core:settings',
        icon: useIcon('dashboard.settings').value,
        label: 'Settings',
        order: 1,
        pages: [
            {
                id: 'theme-settings',
                title: 'Theme Settings',
                description: 'Configure application theme and appearance.',
                icon: useIcon('ui.view').value,
                component: () => import('./ThemePage.vue'),
            },
            {
                id: 'ai-settings',
                title: 'AI Settings',
                description: 'Configure AI-related preferences and options.',
                icon: useIcon('dashboard.plugins').value,
                component: () => import('./AiPage.vue'),
            },
        ],
    },
    {
        id: 'core:images',
        icon: useIcon('dashboard.images').value,
        label: 'Images',
        order: 10,
        pages: [
            {
                id: 'images-library',
                title: 'Images',
                description: 'Browse saved and generated images.',
                icon: useIcon('dashboard.images').value,
                component: () => import('~/pages/images/index.vue'),
            },
        ],
    },
];

// Register any inline pages defined on core items with the shared dashboard page registry
// so that onPluginClick() finds them (core items themselves are not registered as plugins).
for (const item of coreItems) {
    if (Array.isArray((item as any).pages)) {
        for (const p of (item as any).pages) {
            registerDashboardPluginPage(item.id, p as any);
        }
    }
}

const {
    state,
    resolvedPageComponent,
    dashboardItems,
    landingPages,
    headerPluginLabel,
    activePageTitle,
    openPlugin,
    openPage,
    goBack,
} = useDashboardNavigation({ baseItems: coreItems });

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

const dashboardModalProps = computed(() => {
    const baseClass =
        'w-[98dvw] h-[98dvh] sm:min-w-[720px] sm:min-h-[90dvh] sm:max-h-[90dvh] overflow-hidden';
    const baseUi = {
        content: 'z-[10]',
        footer: 'justify-end border-t-[var(--md-border-width)]',
        body: 'overflow-hidden h-full flex-1 !p-0',
    } as Record<string, unknown>;

    const overrideValue =
        (dashboardModalOverrides.value as Record<string, unknown>) || {};
    const overrideClass =
        typeof overrideValue.class === 'string'
            ? (overrideValue.class as string)
            : '';
    const overrideUi =
        (overrideValue.ui as Record<string, unknown> | undefined) || {};
    const mergedUi = { ...baseUi, ...overrideUi };
    const rest = Object.fromEntries(
        Object.entries(overrideValue).filter(
            ([key]) => key !== 'class' && key !== 'ui'
        )
    ) as Record<string, unknown>;

    const result: Record<string, unknown> = {
        ...rest,
        ui: mergedUi,
    };

    const mergedClass = [baseClass, overrideClass].filter(Boolean).join(' ');
    if (mergedClass) {
        result.class = mergedClass;
    }

    return result;
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

// SSR-safe: default to desktop size during server render to avoid hydration mismatch
const pluginIconSize = computed(() => {
    if (import.meta.server) return 74;
    return isMobile.value ? 52 : 74;
});
</script>

<style scoped>
#dashboard-grid-view {
    display: flex;
    justify-content: center;
}

#dashboard-plugin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 100px);
    gap: 20px 16px;
    justify-content: start;
    max-width: 100%;
}

.dashboard-plugin-icon-item {
    width: 100px;
    display: flex;
    justify-content: center;
}

@media (min-width: 820px) {
    #dashboard-plugin-grid {
        grid-template-columns: repeat(auto-fill, 120px);
        gap: 40px 32px;
    }
    .dashboard-plugin-icon-item {
        width: 120px;
    }
}

@media (min-width: 1200px) {
    #dashboard-plugin-grid {
        gap: 48px 40px;
    }
}
</style>
