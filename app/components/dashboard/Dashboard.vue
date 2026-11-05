<template>
    <AppModal
        id="dashboard-modal-shell"
        v-bind="dashboardModalOverrides"
        size="workspace"
        v-model:open="open"
        :modal="true"
        :title="pageTitle"
        :dismissible="true"
        description="Browse all apps, plugins, and settings."
    >
        <template #default>
            <div id="dashboard-shell" class="dashboard-shell">
                <aside
                    id="dashboard-sidebar"
                    class="dashboard-sidebar"
                    aria-label="Dashboard sections"
                >
                    <div class="dashboard-sidebar-brand">
                        <img
                            :src="logoUrl"
                            :alt="appName"
                            class="h-7 w-auto max-w-full"
                        />
                    </div>
                    <nav class="dashboard-sidebar-nav">
                        <button
                            v-for="entry in sidebarEntries"
                            :key="entry.id"
                            type="button"
                            class="dashboard-nav-item"
                            :class="{ 'dashboard-nav-item--divided': entry.divided }"
                            :aria-current="entry.active ? 'page' : undefined"
                            @click="entry.open()"
                        >
                            <AppIcon
                                :icon="entry.icon"
                                :icon-token="entry.iconToken"
                                :image="entry.image"
                                class="size-5"
                            />
                            <span class="truncate">{{ entry.label }}</span>
                        </button>
                    </nav>
                </aside>

                <section class="dashboard-main">
                    <header id="dashboard-page-header">
                        <div class="dashboard-header-text">
                            <button
                                v-if="backTarget"
                                id="dashboard-back-button"
                                type="button"
                                :class="['dashboard-back-button', { 'dashboard-back-button--home': backTarget.home }]"
                                :aria-label="`Back to ${backTarget.label}`"
                                @click="backTarget.action()"
                            >
                                <UIcon
                                    class="size-4 shrink-0"
                                    :name="useIcon('ui.chevron.left').value"
                                />
                                <span id="dashboard-page-breadcrumb" class="truncate">{{ backTarget.label }}</span>
                            </button>
                            <h2
                                ref="titleEl"
                                class="dashboard-shell-title"
                                tabindex="-1"
                            >
                                {{ pageTitle }}
                            </h2>
                        </div>
                        <UButton
                            :icon="useIcon('ui.close').value"
                            color="neutral"
                            variant="ghost"
                            square
                            class="dashboard-close-button"
                            data-slot="close"
                            aria-label="Close dashboard"
                            @click="open = false"
                        />
                    </header>

                    <div
                        v-if="state.error"
                        id="dashboard-page-error"
                        role="alert"
                        class="dashboard-error"
                    >
                        {{ presentError(state.error, { fallbackMessage: 'Could not open this page. Please try again.' }).message }}
                    </div>

                    <div
                        v-if="state.view === 'dashboard'"
                        id="dashboard-grid-view"
                        class="dashboard-main-scroll"
                    >
                        <div
                            v-if="shouldDeferDashboardGrid"
                            id="dashboard-grid-loading"
                            class="text-sm opacity-70"
                        >
                            Loading dashboard…
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
                                :icon-token="item.iconToken"
                                :image="item.image"
                                :label="item.label"
                                :description="item.description"
                                @click="handlePluginClick(item.id)"
                            />
                        </div>
                    </div>

                    <!-- Landing list if multiple pages and none chosen -->
                    <div
                        v-else-if="!state.activePageId && landingPages.length > 1"
                        id="dashboard-page-view"
                        class="dashboard-main-scroll"
                    >
                        <div id="dashboard-landing-grid" class="dashboard-list">
                            <DashboardListRow
                                v-for="p in landingPages"
                                :key="p.id"
                                v-bind="landingPageButtonProps"
                                :class="['dashboard-landing-item', (landingPageButtonProps as any)?.class || '']"
                                :label="p.title"
                                :description="p.description"
                                :image="p.image"
                                :icon="p.icon || (p.iconToken ? undefined : fallbackPageIcon)"
                                :icon-token="p.iconToken"
                                @click="handleLandingPageClick(p.id)"
                            />
                        </div>
                    </div>

                    <!-- Single page or chosen page -->
                    <div
                        v-else
                        id="dashboard-page-view"
                        class="flex min-h-0 min-w-0 flex-1 flex-col"
                    >
                        <div
                            id="dashboard-page-content"
                            class="dashboard-page-scroll flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden"
                        >
                            <div
                                v-if="state.loadingPage"
                                id="dashboard-page-loading"
                                class="text-sm opacity-70 px-[var(--dashboard-gutter)]"
                            >
                                Loading…
                            </div>
                            <component
                                v-else-if="resolvedPageComponent"
                                :is="resolvedPageComponent"
                            />
                            <div
                                v-else-if="!state.activePageId && landingPages.length === 1"
                                id="dashboard-single-landing-placeholder"
                                class="text-xs opacity-60 px-[var(--dashboard-gutter)]"
                            >
                                Preparing page…
                            </div>
                            <div
                                v-else-if="!landingPages.length"
                                id="dashboard-empty-placeholder"
                                class="text-xs px-[var(--dashboard-gutter)]"
                            >
                                No pages registered for this plugin.
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </template>
    </AppModal>
</template>
<script setup lang="ts">
import { presentError } from '~~/shared/errors';
import { computed, nextTick, provide, ref, shallowRef, watch } from 'vue';
import PluginIcons from './PluginIcons.vue';
import DashboardListRow from './DashboardListRow.vue';
import AppModal from '~/components/ui/AppModal.vue';
import AppIcon from '~/components/ui/AppIcon.vue';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';
import { createCoreDashboardItems } from '~/core/dashboard/core-items';
import {
    DASHBOARD_SUBPAGE_KEY,
    type DashboardSubpage,
} from '~/core/dashboard/dashboard-navigation-types';
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

const subpage = shallowRef<DashboardSubpage | null>(null);
provide(DASHBOARD_SUBPAGE_KEY, subpage);

const runtimeConfig = useRuntimeConfig();
const ssrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
const sessionContext = ssrAuthEnabled ? useSessionContext() : null;
const shouldDeferDashboardGrid = computed(
    () =>
        ssrAuthEnabled &&
        sessionContext?.pending.value === true &&
        sessionContext?.data.value === null
);
const appName = computed(() => runtimeConfig.public?.branding?.appName || 'OR3');
const logoUrl = computed(
    () => runtimeConfig.public?.branding?.logoUrl || '/logos/logo-svg.svg'
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
    goBack,
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

const dashboardIcon = useIcon('dashboard.home');
const fallbackPageIcon = useIcon('sidebar.page.default');

// Settings sits beside the Dashboard home; every other app follows a divider.
const sidebarEntries = computed(() => {
    const settings = dashboardItems.value.find((item) => item.id === 'core:settings');
    const apps = dashboardItems.value.filter((item) => item !== settings);
    return [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: dashboardIcon.value,
            iconToken: undefined,
            image: undefined,
            active: state.view === 'dashboard',
            divided: false,
            open: reset,
        },
        ...[settings, ...apps].filter((item) => item !== undefined).map((item, index) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            iconToken: item.iconToken,
            image: item.image,
            active: state.view === 'page' && state.activePluginId === item.id,
            divided: index === (settings ? 1 : 0),
            open: () => handlePluginClick(item.id),
        })),
    ];
});

const pageTitle = computed(() => {
    if (state.view === 'dashboard') return 'Dashboard';
    if (subpage.value) return subpage.value.title;
    return activePageTitle.value || headerPluginLabel.value;
});

// The sidebar already leads home, so a link back to the Dashboard is mobile-only.
const backTarget = computed(() => {
    if (state.view === 'dashboard') return null;
    if (subpage.value) {
        return { label: activePageTitle.value, action: subpage.value.back, home: false };
    }
    if (state.activePageId && landingPages.value.length > 1) {
        return { label: headerPluginLabel.value, action: goBack, home: false };
    }
    return { label: 'Dashboard', action: reset, home: true };
});

watch(() => [state.view, state.activePluginId, state.activePageId], () => {
    subpage.value = null;
});

// Navigating removes the control that was clicked. Keep keyboard focus in the
// header rather than letting it fall back to the dialog itself.
const titleEl = ref<HTMLElement | null>(null);
watch(pageTitle, async () => {
    await nextTick();
    requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.getAttribute('role') !== 'dialog') return;
        const back = document.getElementById('dashboard-back-button');
        const target = back?.getClientRects().length ? back : titleEl.value;
        target?.focus({ preventScroll: true });
    });
});

// Theme overrides for Nuxt UI elements
const dashboardModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'dashboard',
    identifier: 'dashboard.shell',
    isNuxtUI: true,
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
@layer utilities {
    /* A settings-sized sheet; phones get the full screen from AppModal's workspace size. */
    @media (min-width: 640px) {
        :global(.app-modal:has(#dashboard-shell)) {
            max-width: 1040px;
            height: min(760px, calc(100dvh - 2rem));
        }
    }

    /* The dashboard draws its own title bar inside the main column. The hidden
       header still names the dialog through aria-labelledby. */
    :global(.app-modal:has(#dashboard-shell) > [data-slot='header']) {
        display: none !important;
    }
}

.dashboard-shell {
    --dashboard-gutter: 32px;
    display: flex;
    height: 100%;
    min-height: 0;
    min-width: 0;
}

.dashboard-sidebar {
    display: none;
    width: 232px;
    flex-shrink: 0;
    flex-direction: column;
    gap: 24px;
    padding: 24px 14px;
    overflow-y: auto;
    /* Themes match this to their icon rail; the default is the rail's surface. */
    background: var(--md-surface);
    border-right: var(--md-border-width, 1px) solid var(--md-border-color);
}

.dashboard-sidebar-brand {
    display: flex;
    align-items: center;
    min-height: 36px;
    padding-inline: 10px;
}

.dashboard-sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.dashboard-nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 8px 12px;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 15px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--app-motion-duration-fast, 100ms) var(--app-motion-easing-standard, ease);
}

.dashboard-nav-item:hover {
    background: var(--md-surface-hover);
    color: var(--md-on-surface);
}

.dashboard-nav-item[aria-current='page'] {
    background: color-mix(in srgb, var(--md-primary) 10%, transparent);
    color: var(--md-primary);
}

.dashboard-nav-item:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid var(--md-focus-ring, var(--md-primary));
    outline-offset: -2px;
}

.dashboard-nav-item--divided {
    position: relative;
    margin-top: 25px;
}

.dashboard-nav-item--divided::before {
    content: '';
    position: absolute;
    top: -13px;
    inset-inline: 10px;
    border-top: var(--md-border-width, 1px) solid var(--md-border-color);
}

.dashboard-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    container-type: inline-size;
}

#dashboard-page-header {
    display: flex;
    flex-shrink: 0;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 28px var(--dashboard-gutter) 20px;
}

.dashboard-header-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
}

/* A plain button: themes style every UButton with borders and fills. The
   negative margin puts the chevron on the title's edge, and the cap gives that
   back so the label never clips. */
.dashboard-back-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100% + 4px);
    min-height: 32px;
    margin-inline-start: -4px;
    padding: 4px;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--app-motion-duration-fast, 100ms) var(--app-motion-easing-standard, ease);
}

.dashboard-back-button:hover {
    background: var(--md-surface-hover);
    color: var(--md-on-surface);
}

.dashboard-back-button:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid var(--md-focus-ring, var(--md-primary));
    outline-offset: 1px;
}

.dashboard-shell-title {
    color: var(--md-on-surface);
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.15;
    overflow-wrap: anywhere;
    outline: none;
}

.dashboard-close-button {
    flex-shrink: 0;
    margin-inline-end: -8px;
}

.dashboard-error {
    margin: 0 var(--dashboard-gutter) 12px;
    padding: 8px 12px;
    border: var(--md-border-width) solid var(--md-error);
    border-radius: var(--md-border-radius);
    background: var(--md-error-container);
    color: var(--md-on-error-container);
    font-size: 12px;
}

.dashboard-main-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px var(--dashboard-gutter) max(32px, env(safe-area-inset-bottom));
}

.dashboard-page-scroll {
    scrollbar-gutter: stable;
    padding-bottom: env(safe-area-inset-bottom);
}

#dashboard-plugin-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
}

@container (min-width: 560px) {
    #dashboard-plugin-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
}

/* One column reads as a grouped list, like the settings rows. */
@container (max-width: 559px) {
    #dashboard-plugin-grid {
        gap: 0;
        overflow: hidden;
        border: var(--md-border-width) solid var(--md-border-color);
        border-radius: var(--md-border-radius-large, var(--md-border-radius));
    }

    #dashboard-plugin-grid > .dashboard-plugin-icon-button {
        position: relative;
        border: 0 !important;
        border-radius: 0 !important;
        outline-offset: -2px;
    }

    #dashboard-plugin-grid :deep(.dashboard-plugin-chevron) {
        display: block;
    }

    #dashboard-plugin-grid > .dashboard-plugin-icon-button + .dashboard-plugin-icon-button::before {
        content: '';
        position: absolute;
        top: 0;
        left: 60px;
        right: 20px;
        border-top: var(--md-border-width, 1px) solid var(--md-border-color);
    }
}

@media (min-width: 768px) {
    .dashboard-sidebar {
        display: flex;
    }

    .dashboard-back-button--home {
        display: none;
    }
}

@media (max-width: 639px), (max-height: 500px) {
    .dashboard-shell {
        --dashboard-gutter: 16px;
    }

    #dashboard-page-header {
        padding-top: 12px;
        padding-bottom: 16px;
    }

    .dashboard-shell-title {
        font-size: 26px;
    }
}
</style>
