<template>
    <nav
        id="mobile-bottom-nav"
        class="mobile-bottom-nav-root shrink-0 w-full flex items-stretch gap-1 px-2 pt-1.5 border-t-[length:var(--md-border-width)] border-t-[color:var(--md-border-color)] bg-[var(--md-surface)]"
        aria-label="Sidebar navigation"
    >
        <!-- Home -->
        <button
            v-if="showHomePage"
            v-bind="
                activePageId === DEFAULT_PAGE_ID
                    ? homeButtonActiveProps
                    : homeButtonProps
            "
            id="mobile-nav-home"
            type="button"
            :aria-pressed="activePageId === DEFAULT_PAGE_ID"
            aria-label="Home"
            @click="() => handlePageSelect(DEFAULT_PAGE_ID)"
        >
            <UIcon :name="iconPageHome" class="mobile-nav-icon" />
            <span class="mobile-nav-label">Home</span>
        </button>

        <!-- Search -->
        <button
            v-bind="searchButtonProps"
            id="mobile-nav-search"
            type="button"
            aria-label="Search everything"
            @click="emit('focus-search')"
        >
            <UIcon :name="iconSearch" class="mobile-nav-icon" />
            <span class="mobile-nav-label">Search</span>
        </button>

        <!-- Create (center, prominent) -->
        <UPopover
            v-model:open="createOpen"
            :content="{ side: 'top', align: 'center', sideOffset: 12 }"
        >
            <button
                v-bind="createButtonProps"
                id="mobile-nav-create"
                type="button"
                aria-label="Create"
                :aria-expanded="createOpen"
            >
                <span class="mobile-nav-create-fab">
                    <UIcon :name="iconPlus" class="w-[22px] h-[22px]" />
                </span>
                <span class="mobile-nav-label">Create</span>
            </button>
            <template #content>
                <div
                    class="mobile-nav-menu flex flex-col gap-0.5 p-1.5 min-w-[190px]"
                >
                    <button
                        v-bind="createItemProps"
                        id="mobile-nav-create-chat"
                        type="button"
                        @click="onCreate('chat')"
                    >
                        <UIcon
                            :name="iconNewChat"
                            class="mobile-nav-menu-icon"
                        />
                        <span>New chat</span>
                    </button>
                    <button
                        v-if="documentsEnabled"
                        v-bind="createItemProps"
                        id="mobile-nav-create-document"
                        type="button"
                        @click="onCreate('document')"
                    >
                        <UIcon
                            :name="iconNewNote"
                            class="mobile-nav-menu-icon"
                        />
                        <span>New document</span>
                    </button>
                    <button
                        v-bind="createItemProps"
                        id="mobile-nav-create-project"
                        type="button"
                        @click="onCreate('project')"
                    >
                        <UIcon
                            :name="iconNewFolder"
                            class="mobile-nav-menu-icon"
                        />
                        <span>New project</span>
                    </button>
                </div>
            </template>
        </UPopover>

        <!-- Dashboard -->
        <button
            v-if="dashboardEnabled"
            v-bind="dashboardNavButtonProps"
            id="mobile-nav-dashboard"
            type="button"
            aria-label="Dashboard"
            @click="onToggleDashboard"
        >
            <UIcon :name="iconDashboard" class="mobile-nav-icon" />
            <span class="mobile-nav-label">Dashboard</span>
        </button>

        <!-- More (overflow pages, account, info, mode) -->
        <button
            v-bind="moreButtonProps"
            id="mobile-nav-more"
            type="button"
            aria-label="More options"
            :aria-expanded="moreOpen"
            :aria-controls="moreOpen ? 'mobile-nav-more-sheet' : undefined"
            @click="moreOpen = true"
        >
            <UIcon :name="iconMore" class="mobile-nav-icon" />
            <span class="mobile-nav-label">More</span>
        </button>

        <Teleport to="body">
            <Transition name="more-sheet" :css="!dismissByDrag">
                <div
                    v-if="moreOpen"
                    class="more-sheet-root"
                    @keydown.esc.prevent="closeMore"
                >
                    <button
                        type="button"
                        class="more-sheet-backdrop"
                        aria-label="Close more menu"
                        :style="backdropStyle"
                        @click="closeMore"
                    />
                    <div
                        id="mobile-nav-more-sheet"
                        ref="sheetPanelRef"
                        class="more-sheet-panel"
                        :class="{
                            'more-sheet-panel--dragging': isDragging,
                        }"
                        :style="panelStyle"
                        role="dialog"
                        aria-modal="true"
                        :aria-labelledby="
                            infoOpen
                                ? 'mobile-more-info-title'
                                : 'mobile-more-title'
                        "
                        :aria-describedby="
                            infoOpen
                                ? 'mobile-more-info-desc'
                                : 'mobile-more-description'
                        "
                    >
                        <div
                            class="more-sheet-handle-hit"
                            @pointerdown="onHandlePointerDown"
                        >
                            <div class="more-sheet-handle" aria-hidden="true" />
                        </div>

                        <header
                            class="more-sheet-header"
                            @pointerdown="onHandlePointerDown"
                        >
                            <template v-if="!infoOpen">
                                <h2
                                    id="mobile-more-title"
                                    class="more-sheet-title"
                                >
                                    More
                                </h2>
                                <p
                                    id="mobile-more-description"
                                    class="more-sheet-description"
                                >
                                    Manage your workspace and account.
                                </p>
                            </template>
                            <template v-else>
                                <button
                                    type="button"
                                    class="more-sheet-back"
                                    aria-label="Back to More"
                                    @click.stop="infoOpen = false"
                                    @pointerdown.stop
                                >
                                    <UIcon
                                        :name="iconChevronLeft"
                                        class="h-4 w-4"
                                    />
                                    Back
                                </button>
                                <h2
                                    id="mobile-more-info-title"
                                    class="more-sheet-title"
                                >
                                    Info
                                </h2>
                                <p
                                    id="mobile-more-info-desc"
                                    class="more-sheet-description"
                                >
                                    OpenRouter account shortcuts.
                                </p>
                            </template>
                        </header>

                    <div class="more-sheet-body mobile-nav-more-panel">
                        <div
                            v-if="!infoOpen"
                            class="mobile-nav-more-sheet"
                        >
                            <section
                                v-if="orderedPages.length > 0"
                                class="more-section"
                            >
                                <p class="more-section-label">Workspace</p>
                                <div
                                    class="more-tile-grid"
                                    :class="
                                        orderedPages.length === 1
                                            ? 'more-tile-grid--single'
                                            : ''
                                    "
                                >
                                    <button
                                        v-for="(page, index) in orderedPages"
                                        :key="`mobile-nav-more-page-${page.id}`"
                                        :id="`mobile-nav-page-${page.id}`"
                                        type="button"
                                        class="more-tile"
                                        :class="[
                                            `more-tile--accent-${tileAccent(index)}`,
                                            {
                                                'more-tile--active':
                                                    activePageId === page.id,
                                            },
                                        ]"
                                        :aria-pressed="activePageId === page.id"
                                        :aria-label="page.label"
                                        @click="() => onMorePageSelect(page.id)"
                                    >
                                        <span
                                            class="more-tile-icon"
                                            aria-hidden="true"
                                        >
                                            <UIcon
                                                :name="
                                                    page.icon || iconPageDefault
                                                "
                                            />
                                        </span>
                                        <span class="more-tile-copy">
                                            <span class="more-tile-label">{{
                                                page.label
                                            }}</span>
                                            <span class="more-tile-desc">{{
                                                pageDescription(page)
                                            }}</span>
                                        </span>
                                    </button>
                                </div>
                            </section>

                            <section class="more-section">
                                <p class="more-section-label">Account</p>
                                <div class="more-list">
                                    <div class="mobile-nav-more-auth">
                                        <component
                                            :is="sidebarAuthButtonComponent"
                                        />
                                    </div>

                                    <button
                                        v-if="!isSsrAuthEnabled"
                                        id="mobile-nav-info"
                                        type="button"
                                        class="more-row"
                                        aria-label="My Info"
                                        @click="infoOpen = true"
                                    >
                                        <span
                                            class="more-row-icon more-row-icon--info"
                                            aria-hidden="true"
                                        >
                                            <UIcon :name="iconUser" />
                                        </span>
                                        <span class="more-row-copy">
                                            <span class="more-row-label"
                                                >Info</span
                                            >
                                            <span class="more-row-desc"
                                                >Activity and credits</span
                                            >
                                        </span>
                                        <UIcon
                                            :name="iconChevron"
                                            class="more-row-chevron"
                                            aria-hidden="true"
                                        />
                                    </button>
                                </div>
                            </section>
                        </div>

                        <div v-else class="more-list more-list--nested">
                            <button
                                type="button"
                                class="more-row"
                                @click="navigateToActivity"
                            >
                                <span class="more-row-icon" aria-hidden="true">
                                    <UIcon :name="iconActivity" />
                                </span>
                                <span class="more-row-copy">
                                    <span class="more-row-label">Activity</span>
                                    <span class="more-row-desc"
                                        >Usage and request history</span
                                    >
                                </span>
                                <UIcon
                                    :name="iconChevron"
                                    class="more-row-chevron"
                                    aria-hidden="true"
                                />
                            </button>
                            <button
                                type="button"
                                class="more-row"
                                @click="navigateToCredits"
                            >
                                <span class="more-row-icon" aria-hidden="true">
                                    <UIcon :name="iconCredits" />
                                </span>
                                <span class="more-row-copy">
                                    <span class="more-row-label">Credits</span>
                                    <span class="more-row-desc"
                                        >Billing and balance</span
                                    >
                                </span>
                                <UIcon
                                    :name="iconChevron"
                                    class="more-row-chevron"
                                    aria-hidden="true"
                                />
                            </button>
                        </div>
                    </div>

                    <footer v-if="!infoOpen" class="more-sheet-footer">
                        <div class="more-system">
                            <p class="more-section-label">System</p>
                            <div class="more-system-card">
                                <div
                                    class="more-system-mode"
                                    :aria-label="`${modeLabel} mode`"
                                >
                                    <span
                                        class="more-row-icon more-row-icon--mode"
                                        aria-hidden="true"
                                    >
                                        <UIcon :name="iconCloud" />
                                    </span>
                                    <span class="more-row-copy">
                                        <span class="more-row-label"
                                            >{{ modeLabel }} mode</span
                                        >
                                        <span
                                            class="more-row-desc"
                                            :class="{
                                                'more-row-desc--active':
                                                    isSsrAuthEnabled,
                                            }"
                                        >
                                            {{
                                                isSsrAuthEnabled
                                                    ? 'Currently enabled'
                                                    : 'Local-first workspace'
                                            }}
                                        </span>
                                    </span>
                                    <span
                                        v-if="isSsrAuthEnabled"
                                        class="more-status-badge"
                                        >Active</span
                                    >
                                </div>

                                <button
                                    v-if="isSsrAuthEnabled"
                                    type="button"
                                    class="more-system-admin"
                                    aria-label="Open admin"
                                    @click="openAdmin"
                                >
                                    <span
                                        class="more-row-icon more-row-icon--admin"
                                        aria-hidden="true"
                                    >
                                        <UIcon :name="iconShield" />
                                    </span>
                                    <span class="more-row-copy">
                                        <span class="more-row-label"
                                            >Admin</span
                                        >
                                        <span class="more-row-desc"
                                            >Workspace and settings</span
                                        >
                                    </span>
                                    <UIcon
                                        :name="iconChevron"
                                        class="more-row-chevron"
                                        aria-hidden="true"
                                    />
                                </button>
                            </div>
                        </div>
                    </footer>
                </div>
            </div>
            </Transition>
        </Teleport>
    </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, watch } from 'vue';
import { navigateTo, useNuxtApp, useRuntimeConfig, useToast } from '#imports';
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useOr3Config } from '~/composables/useOr3Config';
import {
    projectProfileItems,
    resolvedWorkspaceProfile,
} from '~/core/workspace-profiles/projection';
import SidebarAuthButton from '~/components/sidebar/SidebarAuthButton.vue';

/** Keep nested auth menus on-screen inside the mobile More sheet. */
provide('or3:auth-ui-popover-content', {
    side: 'top' as const,
    align: 'center' as const,
    sideOffset: 8,
    collisionPadding: 16,
});

const DEFAULT_PAGE_ID = 'sidebar-home';

const PAGE_DESCRIPTIONS: Record<string, string> = {
    'or3-external-agents': 'Build & manage AI agents',
    'or3-workflows-page': 'Automate tasks & flows',
};

const TILE_ACCENTS = ['primary', 'secondary', 'tertiary'] as const;

const iconPageHome = useIcon('sidebar.page.home');
const iconPageDefault = useIcon('sidebar.page.default');
const iconSearch = useIcon('sidebar.search');
const iconPlus = useIcon('ui.plus');
const iconMore = useIcon('ui.more');
const iconNewChat = useIcon('sidebar.new_chat');
const iconNewNote = useIcon('sidebar.new_note');
const iconNewFolder = useIcon('sidebar.new_folder');
const iconDashboard = useIcon('dashboard.home');
const iconUser = useIcon('sidebar.user');
const iconActivity = useIcon('sidebar.activity');
const iconCredits = useIcon('sidebar.credits');
const iconChevron = useIcon('ui.chevron.right');
const iconChevronLeft = useIcon('ui.chevron.left');
const iconCloud = useIcon('ui.cloud');
const iconShield = useIcon('ui.shield');

const or3Config = useOr3Config();
const documentsEnabled = computed(() => or3Config.features.documents.enabled);
const dashboardEnabled = computed(() => or3Config.features.dashboard.enabled);

// SSR auth flag drives info links + mode badge (mirrors SideBottomNav)
const config = useRuntimeConfig();
const isSsrAuthEnabled = computed(
    () => config.public?.ssrAuthEnabled === true
);

// Provider-adaptive auth button (theme-swappable via 'sidebar-auth-button')
const themePlugin = useNuxtApp().$theme;
const sidebarAuthButtonComponent = computed(
    () =>
        themePlugin?.activeComponents?.value?.['sidebar-auth-button'] ??
        SidebarAuthButton
);

// Mode badge (Local / Cloud) — same semantics as SideBottomNav
const modeLabel = computed(() => (isSsrAuthEnabled.value ? 'Cloud' : 'Local'));

const createOpen = ref(false);
const moreOpen = ref(false);
const infoOpen = ref(false);
const sheetPanelRef = ref<HTMLElement | null>(null);
const dragY = ref(0);
const isDragging = ref(false);
const dismissByDrag = ref(false);

const SHEET_DISMISS_PX = 110;
const SHEET_DISMISS_VELOCITY = 0.55;

const panelStyle = computed(() => {
    if (dragY.value <= 0 && !isDragging.value) return undefined;
    return {
        transform: `translateY(${dragY.value}px)`,
    };
});

const backdropStyle = computed(() => {
    if (dragY.value <= 0) return undefined;
    const height = sheetPanelRef.value?.offsetHeight || 480;
    const progress = Math.min(1, dragY.value / height);
    return {
        opacity: String(Math.max(0.15, 1 - progress * 0.85)),
    };
});

let activePointerId: number | null = null;
let dragStartY = 0;
let dragStartOffset = 0;
let lastPointerY = 0;
let lastPointerTs = 0;
let dragVelocity = 0;

function cleanupDragListeners() {
    window.removeEventListener('pointermove', onSheetPointerMove);
    window.removeEventListener('pointerup', onSheetPointerUp);
    window.removeEventListener('pointercancel', onSheetPointerUp);
}

function onHandlePointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Don't start a drag from interactive controls inside the header.
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select')) return;

    event.preventDefault();
    isDragging.value = true;
    activePointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartOffset = dragY.value;
    lastPointerY = event.clientY;
    lastPointerTs = event.timeStamp;
    dragVelocity = 0;

    window.addEventListener('pointermove', onSheetPointerMove, {
        passive: false,
    });
    window.addEventListener('pointerup', onSheetPointerUp);
    window.addEventListener('pointercancel', onSheetPointerUp);
}

function onSheetPointerMove(event: PointerEvent) {
    if (!isDragging.value || event.pointerId !== activePointerId) return;
    event.preventDefault();
    const delta = event.clientY - dragStartY;
    dragY.value = Math.max(0, dragStartOffset + delta);
    const dt = event.timeStamp - lastPointerTs;
    if (dt > 0) {
        dragVelocity = (event.clientY - lastPointerY) / dt;
    }
    lastPointerY = event.clientY;
    lastPointerTs = event.timeStamp;
}

function onSheetPointerUp(event: PointerEvent) {
    if (event.pointerId !== activePointerId) return;
    cleanupDragListeners();
    isDragging.value = false;
    activePointerId = null;

    const shouldDismiss =
        dragY.value >= SHEET_DISMISS_PX ||
        dragVelocity >= SHEET_DISMISS_VELOCITY;

    if (shouldDismiss) {
        void dismissSheetByDrag();
        return;
    }

    dragY.value = 0;
}

async function dismissSheetByDrag() {
    dismissByDrag.value = true;
    const height = sheetPanelRef.value?.offsetHeight || window.innerHeight;
    dragY.value = height;
    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 230);
    });
    moreOpen.value = false;
    infoOpen.value = false;
    dragY.value = 0;
    dismissByDrag.value = false;
    if (import.meta.client) {
        document.body.style.overflow = '';
    }
}

function closeMore() {
    if (dismissByDrag.value) return;
    cleanupDragListeners();
    isDragging.value = false;
    activePointerId = null;
    dragY.value = 0;
    moreOpen.value = false;
    infoOpen.value = false;
}

watch(moreOpen, (open) => {
    if (!import.meta.client) return;
    document.body.style.overflow = open ? 'hidden' : '';
    if (!open) {
        infoOpen.value = false;
        dragY.value = 0;
        isDragging.value = false;
    }
});

onBeforeUnmount(() => {
    cleanupDragListeners();
    if (!import.meta.client) return;
    document.body.style.overflow = '';
});

function tileAccent(index: number) {
    return TILE_ACCENTS[index % TILE_ACCENTS.length] ?? 'primary';
}

function pageDescription(page: { id: string; label: string }) {
    return PAGE_DESCRIPTIONS[page.id] ?? `Open ${page.label}`;
}

/* ---------------- Pages (mobile projection) ---------------- */

const { listSidebarPages } = useSidebarPages();
const { activePageId, setActivePage } = useActiveSidebarPage();

const projectedPages = computed(() => {
    void resolvedWorkspaceProfile.value;
    return projectProfileItems(
        'mobile-bottom-navigation',
        listSidebarPages.value
    );
});

const showHomePage = computed(() =>
    resolvedWorkspaceProfile.value.mobile.bottomNavigation.includes(
        DEFAULT_PAGE_ID
    )
);

// Home / chats / docs render inside the home page scroll, not the bar
const orderedPages = computed(() => {
    if (!projectedPages.value.length) return [];
    const hiddenPages = new Set([
        DEFAULT_PAGE_ID,
        'sidebar-chats',
        'sidebar-docs',
    ]);
    return projectedPages.value.filter((page) => !hiddenPages.has(page.id));
});

const toast = useToast();

async function handlePageSelect(pageId: string) {
    if (pageId === DEFAULT_PAGE_ID) {
        await navigateTo('/');
    }
    if (pageId === activePageId.value) return;
    try {
        const ok = await setActivePage(pageId);
        if (!ok) {
            const page = listSidebarPages.value.find((p) => p.id === pageId);
            toast.add({
                title: 'Cannot switch page',
                description: page?.label
                    ? `Unable to activate "${page.label}"`
                    : 'Page activation failed',
                color: 'neutral',
            });
        }
    } catch (error) {
        console.error(
            `[SideMobileBottomNav] failed to activate sidebar page "${pageId}"`,
            error
        );
        toast.add({
            title: 'Error',
            description: 'Failed to switch pages',
            color: 'error',
        });
    }
}

/* ---------------- Actions ---------------- */

const emit = defineEmits<{
    (e: 'new-chat'): void;
    (e: 'new-document'): void;
    (e: 'new-project'): void;
    (e: 'focus-search'): void;
    (e: 'toggle-dashboard'): void;
}>();

function onCreate(kind: 'chat' | 'document' | 'project') {
    createOpen.value = false;
    if (kind === 'chat') emit('new-chat');
    else if (kind === 'document') emit('new-document');
    else emit('new-project');
}

async function onMorePageSelect(pageId: string) {
    closeMore();
    await handlePageSelect(pageId);
}

function onToggleDashboard() {
    closeMore();
    emit('toggle-dashboard');
}

function navigateToActivity() {
    closeMore();
    window.open('https://openrouter.ai/activity', '_blank');
}

function navigateToCredits() {
    closeMore();
    window.open('https://openrouter.ai/settings/credits', '_blank');
}

async function openAdmin() {
    closeMore();
    await navigateTo('/admin');
}

/* ---------------- Theme-integrated button props ---------------- */
/* Plain <button> elements are used for the bar so theme app.config button
   size injections (mobile padding/height rules) don't fight the compact
   icon-over-label layout. Overrides resolve with isNuxtUI: false; the
   `class` from each theme's `button#sidebar.mobile-nav.*` entry passes
   through unchanged. */

const NAV_ITEM_BASE_CLASS =
    'mobile-nav-item group flex flex-1 min-w-0 flex-col items-center justify-center gap-[3px] rounded-[var(--md-border-radius)] px-1 py-1.5 min-h-[54px] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)] hover:text-[var(--md-on-surface)] active:bg-[var(--md-surface-active)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]';

const NAV_ITEM_ACTIVE_CLASS =
    'mobile-nav-item group flex flex-1 min-w-0 flex-col items-center justify-center gap-[3px] rounded-[var(--md-border-radius)] px-1 py-1.5 min-h-[54px] text-[var(--md-primary)] bg-[var(--md-primary)]/10 hover:bg-[var(--md-primary)]/15 hover:text-[var(--md-primary)] active:bg-[var(--md-primary)]/20 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]';

function createNavItemProps(state?: 'active') {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.mobile-nav.item',
        state,
        isNuxtUI: false,
    });
    return computed(() => {
        const overrideValue = (overrides.value as any) || {};
        const { class: overrideClass, ...restOverrides } = overrideValue;
        return {
            ...restOverrides,
            class: [
                state === 'active'
                    ? NAV_ITEM_ACTIVE_CLASS
                    : NAV_ITEM_BASE_CLASS,
                overrideClass,
            ],
        };
    });
}

const homeButtonProps = createNavItemProps();
const homeButtonActiveProps = createNavItemProps('active');
const searchButtonProps = createNavItemProps();
const moreButtonProps = createNavItemProps();
const dashboardNavButtonProps = createNavItemProps();

// Center create button — container column; the FAB circle itself is styled
// via .mobile-nav-create-fab (scoped CSS + theme cssSelectors).
const createButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.mobile-nav.create',
    isNuxtUI: false,
});
const createButtonProps = computed(() => {
    const overrideValue = (createButtonOverrides.value as any) || {};
    const { class: overrideClass, ...restOverrides } = overrideValue;
    return {
        ...restOverrides,
        class: [
            'mobile-nav-item mobile-nav-create group flex flex-1 min-w-0 flex-col items-center justify-center gap-[3px] rounded-[var(--md-border-radius)] px-1 py-1.5 min-h-[54px] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]',
            overrideClass,
        ],
    };
});

const MENU_ITEM_CLASS =
    'mobile-nav-menu-item flex items-center gap-2.5 w-full min-h-[44px] px-3 py-2 rounded-[var(--md-border-radius)] text-[14px] text-left text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]';

// Create menu rows
const createItemOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.mobile-nav.create-item',
    isNuxtUI: false,
});
const createItemProps = computed(() => {
    const overrideValue = (createItemOverrides.value as any) || {};
    const { class: overrideClass, ...restOverrides } = overrideValue;
    return {
        ...restOverrides,
        class: [MENU_ITEM_CLASS, overrideClass],
    };
});
</script>

<style scoped>
.mobile-bottom-nav-root {
    /* Respect device safe areas so the bar never collides with OS UI */
    padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
    /* Sit above page footers (e.g. agents host switcher) so the Create FAB wins */
    position: relative;
    z-index: 30;
}

.mobile-nav-icon {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
}

.mobile-nav-label {
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Center create FAB — raised above the bar like classic mobile tab bars */
.mobile-nav-create-fab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-top: -26px;
    margin-bottom: 2px;
    flex-shrink: 0;
    border-radius: 9999px;
    border: var(--md-border-width, 2px) solid
        var(--md-border-color, transparent);
    background: var(--md-primary);
    color: var(--md-on-primary);
    box-shadow:
        0 4px 12px color-mix(in srgb, var(--md-primary) 35%, transparent),
        0 1px 3px rgb(0 0 0 / 0.15);
    transition:
        transform 120ms ease,
        box-shadow 120ms ease,
        filter 120ms ease;
}

.group:hover .mobile-nav-create-fab {
    filter: brightness(1.06);
    transform: translateY(-1px);
}

.group:active .mobile-nav-create-fab {
    transform: translateY(0) scale(0.96);
}

.mobile-nav-menu-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
}

/* ── More sheet (custom bottom drawer; avoids UDrawer/vaul-vue) ─ */

.more-sheet-root {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
}

.more-sheet-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    background: rgb(0 0 0 / 0.4);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
}

.more-sheet-panel {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: min(88dvh, 720px);
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    border-radius: 1.5rem 1.5rem 0 0;
    background: var(--md-surface);
    box-shadow: 0 -12px 40px rgb(15 23 42 / 0.18);
    will-change: transform;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.more-sheet-panel--dragging {
    transition: none;
}

.more-sheet-handle-hit {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 1.75rem;
    padding-top: 0.45rem;
    cursor: grab;
    touch-action: none;
}

.more-sheet-handle-hit:active {
    cursor: grabbing;
}

.more-sheet-handle {
    width: 2.35rem;
    height: 0.3rem;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--md-on-surface) 22%, transparent);
}

.more-sheet-header {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.15rem 1.25rem 0.75rem;
    touch-action: none;
}

.more-sheet-back {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    align-self: flex-start;
    margin-bottom: 0.15rem;
    padding: 0.2rem 0.15rem;
    border: 0;
    background: transparent;
    color: var(--md-primary);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
}

.more-sheet-title {
    margin: 0;
    color: var(--md-on-surface);
    font-size: 1.35rem;
    font-weight: 700;
    line-height: 1.2;
}

.more-sheet-description {
    margin: 0;
    color: var(--md-on-surface-variant);
    font-size: 0.8125rem;
    line-height: 1.4;
    opacity: 0.82;
}

.more-sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.25rem 1rem 0.5rem;
    touch-action: pan-y;
}

.more-sheet-footer {
    padding: 0.35rem 1rem 0.25rem;
}

.more-sheet-enter-active,
.more-sheet-leave-active {
    pointer-events: none;
}

.more-sheet-enter-active .more-sheet-backdrop,
.more-sheet-leave-active .more-sheet-backdrop {
    transition: opacity 180ms ease;
}

.more-sheet-enter-from .more-sheet-backdrop,
.more-sheet-leave-to .more-sheet-backdrop {
    opacity: 0;
}

.more-sheet-enter-active .more-sheet-panel,
.more-sheet-leave-active .more-sheet-panel {
    transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.more-sheet-enter-from .more-sheet-panel,
.more-sheet-leave-to .more-sheet-panel {
    transform: translateY(100%);
}

.mobile-nav-more-sheet {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    min-width: 0;
    max-width: 100%;
}

.more-section {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}

.more-section-label {
    margin: 0;
    padding-inline: 0.15rem;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--md-on-surface-variant);
    opacity: 0.72;
}

.more-tile-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
}

.more-tile-grid--single {
    grid-template-columns: 1fr;
}

.more-tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.7rem;
    min-height: 7.25rem;
    min-width: 0;
    padding: 0.85rem 0.8rem;
    border: 1px solid
        color-mix(in srgb, var(--md-border-color) 75%, transparent);
    border-radius: 1rem;
    background: var(--md-surface);
    color: var(--md-on-surface);
    text-align: left;
    cursor: pointer;
    transition:
        background 140ms ease,
        border-color 140ms ease,
        transform 120ms ease,
        box-shadow 140ms ease;
}

.more-tile:hover {
    background: var(--md-surface-hover);
}

.more-tile:active {
    transform: scale(0.985);
    background: var(--md-surface-active);
}

.more-tile--active {
    border-color: color-mix(in srgb, var(--md-primary) 45%, transparent);
    background: color-mix(in srgb, var(--md-primary) 8%, var(--md-surface));
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--md-primary) 18%, transparent);
}

.more-tile-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.35rem;
    height: 2.35rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--more-tile-accent) 14%, transparent);
    color: var(--more-tile-accent);
}

.more-tile--accent-primary {
    --more-tile-accent: var(--md-primary);
}

.more-tile--accent-secondary {
    --more-tile-accent: var(--md-secondary, var(--md-tertiary, var(--md-primary)));
}

.more-tile--accent-tertiary {
    --more-tile-accent: var(--md-tertiary, var(--md-primary));
}

.more-tile-icon :deep(.iconify),
.more-tile-icon :deep(svg) {
    width: 1.15rem;
    height: 1.15rem;
}

.more-tile-copy {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
    width: 100%;
}

.more-tile-label {
    font-size: 0.92rem;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: 0.01em;
}

.more-tile-desc {
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--md-on-surface-variant);
    opacity: 0.82;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.more-list {
    display: flex;
    flex-direction: column;
    border: 1px solid
        color-mix(in srgb, var(--md-border-color) 75%, transparent);
    border-radius: 1rem;
    background: var(--md-surface);
    overflow: hidden;
}

.more-list--nested {
    border-radius: 0.9rem;
}

.more-list > * + *,
.mobile-nav-more-auth > * + * {
    border-top: 1px solid
        color-mix(in srgb, var(--md-border-color) 65%, transparent);
}

.more-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.65rem;
    padding: 0.75rem 0.85rem;
    border: 0;
    background: transparent;
    color: var(--md-on-surface);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 120ms ease;
}

.more-row:hover {
    background: var(--md-surface-hover);
}

.more-row:active {
    background: var(--md-surface-active);
}

.more-row-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.15rem;
    height: 2.15rem;
    flex-shrink: 0;
    border-radius: 0.7rem;
    background: color-mix(in srgb, var(--md-on-surface) 6%, transparent);
    color: var(--md-on-surface-variant);
}

.more-row-icon--info {
    background: color-mix(in srgb, var(--md-primary) 12%, transparent);
    color: var(--md-primary);
}

.more-row-icon--mode {
    background: color-mix(in srgb, var(--md-primary) 12%, transparent);
    color: var(--md-primary);
}

.more-row-icon--admin {
    background: color-mix(
        in srgb,
        var(--md-secondary, var(--md-tertiary, var(--md-primary))) 14%,
        transparent
    );
    color: var(--md-secondary, var(--md-tertiary, var(--md-primary)));
}

.more-row-icon :deep(.iconify),
.more-row-icon :deep(svg) {
    width: 1rem;
    height: 1rem;
}

.more-row-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
}

.more-row-label {
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.2;
}

.more-row-desc {
    font-size: 0.72rem;
    line-height: 1.3;
    color: var(--md-on-surface-variant);
    opacity: 0.8;
}

.more-row-desc--active {
    color: var(--md-success, var(--md-primary));
    opacity: 1;
    font-weight: 600;
}

.more-row-chevron {
    width: 0.95rem;
    height: 0.95rem;
    flex-shrink: 0;
    opacity: 0.35;
}

.more-status-badge {
    flex-shrink: 0;
    padding: 0.2rem 0.55rem;
    border-radius: 9999px;
    background: color-mix(
        in srgb,
        var(--md-success, var(--md-primary)) 14%,
        transparent
    );
    color: var(--md-success, var(--md-primary));
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.02em;
}

.more-system {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}

.more-system-card {
    display: flex;
    flex-direction: column;
    border: 1px solid
        color-mix(in srgb, var(--md-border-color) 75%, transparent);
    border-radius: 1rem;
    background: var(--md-surface);
    overflow: hidden;
}

.more-system-mode,
.more-system-admin {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.65rem;
    padding: 0.75rem 0.85rem;
    color: var(--md-on-surface);
    text-decoration: none;
}

.more-system-admin {
    border-top: 1px solid
        color-mix(in srgb, var(--md-border-color) 65%, transparent);
    cursor: pointer;
    transition: background 120ms ease;
}

.more-system-admin:hover {
    background: var(--md-surface-hover);
}

.more-system-admin:active {
    background: var(--md-surface-active);
}

/*
 * Auth adapters ship rail-oriented icon+caption tiles. Inside the More sheet,
 * reshape them into polished account rows matching System list spacing.
 */
.mobile-nav-more-auth {
    display: flex;
    flex-direction: column;
}

.mobile-nav-more-auth :deep(button),
.mobile-nav-more-auth :deep([aria-label='Account menu']),
.mobile-nav-more-auth :deep([aria-label='Login']) {
    display: flex !important;
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 3.65rem !important;
    margin: 0 !important;
    padding: 0.75rem 0.85rem !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    justify-content: flex-start !important;
    align-items: center !important;
    gap: 0 !important;
    color: var(--md-on-surface) !important;
    line-height: 1.2 !important;
}

.mobile-nav-more-auth :deep(button:hover),
.mobile-nav-more-auth :deep([aria-label='Account menu']:hover),
.mobile-nav-more-auth :deep([aria-label='Login']:hover) {
    background: var(--md-surface-hover) !important;
}

.mobile-nav-more-auth :deep(button:active),
.mobile-nav-more-auth :deep([aria-label='Account menu']:active),
.mobile-nav-more-auth :deep([aria-label='Login']:active) {
    background: var(--md-surface-active) !important;
}

.mobile-nav-more-auth :deep(button > span),
.mobile-nav-more-auth :deep([aria-label='Account menu'] > span),
.mobile-nav-more-auth :deep([aria-label='Login'] > span) {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 0.75rem !important;
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
}

/*
 * Auth adapters put the glyph as the first child (svg / .iconify), not inside
 * a .more-row-icon well. Size the glyph to 1rem and paint the well with
 * padding — never set the glyph box itself to 2.15rem or it looks huge.
 */
.mobile-nav-more-auth :deep(button > span > svg),
.mobile-nav-more-auth :deep(button > span > .iconify),
.mobile-nav-more-auth :deep([aria-label='Account menu'] > span > svg),
.mobile-nav-more-auth :deep([aria-label='Account menu'] > span > .iconify),
.mobile-nav-more-auth :deep([aria-label='Login'] > span > svg),
.mobile-nav-more-auth :deep([aria-label='Login'] > span > .iconify) {
    box-sizing: content-box !important;
    display: block !important;
    width: 1rem !important;
    height: 1rem !important;
    min-width: 1rem !important;
    min-height: 1rem !important;
    max-width: 1rem !important;
    max-height: 1rem !important;
    padding: 0.575rem !important;
    margin: 0 !important;
    flex-shrink: 0 !important;
    border-radius: 0.7rem !important;
    background: color-mix(in srgb, var(--md-on-surface) 6%, transparent) !important;
    color: var(--md-on-surface-variant) !important;
    font-size: 1rem !important;
    overflow: visible !important;
}

.mobile-nav-more-auth
    :deep(button[data-connection-state] > span > svg),
.mobile-nav-more-auth
    :deep(button[data-connection-state] > span > .iconify) {
    background: color-mix(
        in srgb,
        var(--md-success, var(--md-primary)) 12%,
        transparent
    ) !important;
    color: var(--md-success, var(--md-primary)) !important;
}

.mobile-nav-more-auth
    :deep([aria-label='Account menu'] > span > svg),
.mobile-nav-more-auth
    :deep([aria-label='Account menu'] > span > .iconify),
.mobile-nav-more-auth :deep([aria-label='Login'] > span > svg),
.mobile-nav-more-auth :deep([aria-label='Login'] > span > .iconify) {
    background: color-mix(
        in srgb,
        var(--md-secondary, var(--md-tertiary, var(--md-primary))) 14%,
        transparent
    ) !important;
    color: var(--md-secondary, var(--md-tertiary, var(--md-primary))) !important;
}

/* Nested svg inside an iconify host must not get a second well */
.mobile-nav-more-auth :deep(button .iconify svg),
.mobile-nav-more-auth :deep([aria-label='Account menu'] .iconify svg),
.mobile-nav-more-auth :deep([aria-label='Login'] .iconify svg) {
    box-sizing: border-box !important;
    width: 1rem !important;
    height: 1rem !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 1rem !important;
    max-height: 1rem !important;
    padding: 0 !important;
    background: transparent !important;
    border-radius: 0 !important;
}

.mobile-nav-more-auth :deep(.sidebar-rail-caption),
.mobile-nav-more-auth :deep([class~='text-[7px]']) {
    display: flex !important;
    flex: 1 1 auto !important;
    flex-direction: column !important;
    align-items: flex-start !important;
    justify-content: center !important;
    gap: 0.15rem !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    font-size: 0.92rem !important;
    font-weight: 600 !important;
    line-height: 1.2 !important;
    letter-spacing: 0.01em !important;
    text-transform: none !important;
    text-align: left !important;
    white-space: nowrap !important;
    color: var(--md-on-surface) !important;
}

.mobile-nav-more-auth
    :deep(button[data-connection-state] .sidebar-rail-caption)::after,
.mobile-nav-more-auth
    :deep(button[data-connection-state] [class~='text-[7px]'])::after {
    content: 'Integrate your tools';
    display: block;
    font-size: 0.72rem;
    font-weight: 500;
    line-height: 1.3;
    color: var(--md-on-surface-variant);
    opacity: 0.8;
    white-space: normal;
}

.mobile-nav-more-auth
    :deep([aria-label='Account menu'] .sidebar-rail-caption)::after,
.mobile-nav-more-auth
    :deep([aria-label='Account menu'] [class~='text-[7px]'])::after,
.mobile-nav-more-auth :deep([aria-label='Login'] .sidebar-rail-caption)::after,
.mobile-nav-more-auth
    :deep([aria-label='Login'] [class~='text-[7px]'])::after {
    content: 'Manage your profile & settings';
    display: block;
    font-size: 0.72rem;
    font-weight: 500;
    line-height: 1.3;
    color: var(--md-on-surface-variant);
    opacity: 0.8;
    white-space: normal;
}

.mobile-nav-more-auth :deep(button)::after,
.mobile-nav-more-auth :deep([aria-label='Account menu'])::after,
.mobile-nav-more-auth :deep([aria-label='Login'])::after {
    content: '';
    width: 0.55rem;
    height: 0.55rem;
    margin-left: auto;
    flex-shrink: 0;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    opacity: 0.35;
    transform: rotate(-45deg);
    color: var(--md-on-surface);
}

/* Connection status bar under Connect caption — hide in sheet rows */
.mobile-nav-more-auth :deep(button span[aria-hidden='true']),
.mobile-nav-more-auth :deep(button span.opacity-50),
.mobile-nav-more-auth :deep(button span[class*='h-[3px]']),
.mobile-nav-more-auth :deep(button span[class*='w-[54%]']) {
    display: none !important;
}

.mobile-nav-more-auth :deep(div[class*='h-[54px]']) {
    width: 100% !important;
    height: auto !important;
    min-height: 3.65rem !important;
    justify-content: flex-start !important;
    padding: 0.75rem 0.85rem !important;
}

.more-list > .mobile-nav-more-auth:first-child > :first-child {
    border-top: 0;
}
</style>
