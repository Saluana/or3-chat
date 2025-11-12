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
                class="p-4 flex justify-center"
            >
                <div
                    id="dashboard-plugin-grid"
                    class="dashboard-plugin-grid grid gap-y-6 gap-x-4 place-items-center grid-cols-4 xs:grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
                >
                    <plugin-icons
                        v-for="item in dashboardItems"
                        :key="item.id"
                        class="dashboard-plugin-icon-item"
                        :icon="item.icon"
                        :label="item.label"
                        :size="74"
                        :retro="true"
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
                    class="flex h-10 shrink-0 items-center border-b-[var(--md-border-width)] border-(--md-inverse-surface) pr-2"
                >
                    <UButton
                        id="dashboard-back-button"
                        v-bind="backButtonProps"
                        class="ml-2 text-[20px] gap-0.5 hover:bg-(--md-primary)/10"
                        @click="goBack()"
                    >
                        <UIcon
                            class="h-6 w-6"
                            :name="'pixelarticons:chevron-left'"
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
        icon: 'pixelarticons:sliders',
        label: 'Settings',
        order: 1,
        pages: [
            {
                id: 'theme-settings',
                title: 'Theme Settings',
                description: 'Configure application theme and appearance.',
                icon: 'pixelarticons:visible',
                component: () => import('./ThemePage.vue'),
            },
            {
                id: 'ai-settings',
                title: 'AI Settings',
                description: 'Configure AI-related preferences and options.',
                icon: 'pixelarticons:zap',
                component: () => import('./AiPage.vue'),
            },
        ],
    },
    {
        id: 'core:images',
        icon: 'pixelarticons:image',
        label: 'Images',
        order: 10,
        pages: [
            {
                id: 'images-library',
                title: 'Images',
                description: 'Browse saved and generated images.',
                icon: 'pixelarticons:image',
                component: () => import('~/pages/images/index.vue'),
            },
        ],
    },
    {
        id: 'core:workspace-backup',
        icon: 'pixelarticons:briefcase-upload',
        label: 'Workspace Backup',
        order: 45,
        pages: [
            {
                id: 'workspace-backup-home',
                title: 'Workspace Backup',
                description: 'Export and import full workspace backups.',
                icon: 'pixelarticons:briefcase-upload',
                component: () => import('./workspace/WorkspaceBackupApp.vue'),
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
</script>
