<template>
    <UModal
        id="app-dashboard-modal"
        v-model:open="open"
        :modal="false"
        :ui="{
            content: 'z-[10]',
            footer: 'justify-end border-t-2',
            body: 'overflow-hidden h-full flex-1 !p-0',
        }"
        title="Dashboard"
        :dismissible="false"
        description="Browse all apps, plugins, and settings."
        class="border-2 w-[98dvw] h-[98dvh] sm:min-w-[720px] sm:min-h-[90dvh] sm:max-h-[90dvh] overflow-hidden"
    >
        <template #body>
            <!-- iOS style springboard grid: fixed icon cell width per breakpoint, centered, nice vertical rhythm -->
            <div
                v-if="state.view === 'dashboard'"
                class="p-4 flex justify-center"
            >
                <div
                    class="grid gap-y-6 gap-x-4 place-items-center grid-cols-4 xs:grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
                >
                    <plugin-icons
                        v-for="item in dashboardItems"
                        :key="item.id"
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
                class="h-full flex flex-col min-h-0"
            >
                <div
                    class="flex h-[40px] shrink-0 items-center border-b-2 border-[var(--md-inverse-surface)] pr-2"
                >
                    <UButton
                        variant="subtle"
                        color="primary"
                        size="sm"
                        class="ml-2 text-[20px] gap-0.5 hover:bg-[var(--md-primary)]/10"
                        @click="goBack()"
                    >
                        <UIcon
                            class="h-6 w-6"
                            :name="'pixelarticons:chevron-left'"
                        />
                    </UButton>
                    <div class="ml-2 font-semibold text-sm truncate">
                        {{ headerPluginLabel }}
                        <span v-if="activePageTitle" class="opacity-60"
                            >/ {{ activePageTitle }}</span
                        >
                    </div>
                </div>
                <div
                    v-if="state.error"
                    class="mx-4 mt-3 rounded-md border-2 border-[var(--md-error)] bg-[var(--md-error-container)] px-3 py-2 text-xs text-[var(--md-on-error-container)]"
                >
                    {{ state.error.message }}
                </div>
                <!-- Landing list if multiple pages and none chosen -->
                <div
                    v-if="!state.activePageId && landingPages.length > 1"
                    class="p-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                >
                    <button
                        v-for="p in landingPages"
                        :key="p.id"
                        class="group flex flex-col items-start gap-2 p-3 rounded-md border-2 border-[var(--md-outline-variant)] hover:border-[var(--md-primary)] hover:bg-[var(--md-primary)]/5 transition-colors text-left"
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
                <div v-else class="flex-1 min-h-0 overflow-y-auto">
                    <div
                        v-if="state.loadingPage"
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
                        class="text-xs opacity-60"
                    >
                        Preparing page…
                    </div>
                    <div v-else-if="!landingPages.length" class="text-xs">
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
                id: 'theme-selector',
                title: 'Theme Selector',
                description: 'Switch between different themes and validate theme configurations.',
                icon: 'pixelarticons:palette',
                component: () => import('./ThemeSelector.vue'),
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
</script>
