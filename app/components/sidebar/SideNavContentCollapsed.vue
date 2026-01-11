<template>
    <div
        id="nav-collapsed-container"
        class="flex min-w-[63.8px] max-w-[63.8px] flex-col justify-between h-[calc(100dvh-49.818px)] relative bg-[color:var(--md-surface)]/5 dark:bg-transparent backdrop-blur-xs"
    >
        <div id="nav-top-section" class="px-1 pt-2 flex flex-col space-y-2">
            <div
                class="new-chat-wrapper flex items-center justify-center w-full pr-0.5"
            >
                <UTooltip
                    :delay-duration="0"
                    :content="{
                        side: 'right',
                    }"
                    text="New chat"
                >
                    <UButton
                        v-bind="newChatButtonProps"
                        id="btn-new-chat"
                        aria-label="New chat"
                        class="flex item-center justify-center"
                        @click="emit('new-chat')"
                    ></UButton>
                </UTooltip>
            </div>
            <UTooltip
                id="tooltip-search"
                :delay-duration="0"
                :content="{
                    side: 'right',
                }"
                text="Search"
            >
                <UButton
                    v-bind="searchButtonProps"
                    id="btn-search"
                    aria-label="Search"
                    class="flex item-center justify-center"
                    @click="emit('focus-search')"
                >
                    <span class="sr-only">Search</span>
                </UButton>
            </UTooltip>
            <UTooltip
                id="tooltip-doc"
                :delay-duration="0"
                :content="{
                    side: 'right',
                }"
                text="Create document"
            >
                <UButton
                    v-bind="newDocButtonProps"
                    id="btn-new-doc"
                    aria-label="Create document"
                    class="flex item-center justify-center"
                    @click="emit('new-document')"
                >
                    <span class="sr-only">Create document</span>
                </UButton>
            </UTooltip>
            <UTooltip
                id="tooltip-project"
                :delay-duration="0"
                :content="{
                    side: 'right',
                }"
                text="Create project"
            >
                <UButton
                    v-bind="newProjectButtonProps"
                    id="btn-new-project"
                    aria-label="Create project"
                    class="flex item-center justify-center"
                    @click="emit('new-project')"
                >
                    <span class="sr-only">Create project</span>
                </UButton>
            </UTooltip>

            <ClientOnly>
                <div
                    id="nav-pages-section"
                    class="pt-2 flex flex-col space-y-2 border-t-[length:var(--md-border-width)] border-t-[color:var(--md-border-color)]"
                >
                    <UTooltip
                        id="tooltip-home"
                        :delay-duration="0"
                        :content="{
                            side: 'right',
                        }"
                        text="Home"
                    >
                        <UButton
                            v-bind="
                                activePageId === DEFAULT_PAGE_ID
                                    ? pageButtonActiveProps
                                    : pageButtonProps
                            "
                            id="btn-home"
                            class="flex item-center justify-center"
                            :icon="iconPageHome"
                            :aria-pressed="activePageId === DEFAULT_PAGE_ID"
                            aria-label="Home"
                            @click="() => handlePageSelect(DEFAULT_PAGE_ID)"
                            @keydown.enter="
                                () => handlePageSelect(DEFAULT_PAGE_ID)
                            "
                            @keydown.space.prevent="
                                () => handlePageSelect(DEFAULT_PAGE_ID)
                            "
                        />
                    </UTooltip>
                    <UTooltip
                        v-for="page in orderedPages"
                        :key="`sidebar-page-btn-${page.id}`"
                        :content="{
                            side: 'right',
                        }"
                        :delay-duration="0"
                        :text="page.label"
                        class="page-nav-item"
                    >
                        <UButton
                            v-bind="
                                activePageId === page.id
                                    ? pageButtonActiveProps
                                    : pageButtonProps
                            "
                            :id="`btn-page-${page.id}`"
                            class="flex item-center justify-center"
                            :icon="page.icon || iconPageDefault"
                            :aria-pressed="activePageId === page.id"
                            :aria-label="page.label"
                            @click="() => handlePageSelect(page.id)"
                            @keydown.enter="() => handlePageSelect(page.id)"
                            @keydown.space.prevent="
                                () => handlePageSelect(page.id)
                            "
                        />
                    </UTooltip>
                </div>
            </ClientOnly>
        </div>
        <div
            id="nav-middle-section"
            class="px-1 pt-2 flex flex-col space-y-2 mb-2"
        ></div>
        <div
            id="nav-footer-section"
            v-if="sidebarFooterActions.length"
            class="px-1 pb-2 flex flex-col space-y-2"
        >
            <UTooltip
                v-for="entry in sidebarFooterActions"
                :key="`sidebar-collapsed-footer-${entry.action.id}`"
                :delay-duration="0"
                :text="entry.action.tooltip || entry.action.label"
                class="footer-action-item"
            >
                <UButton
                    :id="`btn-footer-${entry.action.id}`"
                    size="md"
                    variant="ghost"
                    :color="(entry.action.color || 'neutral') as any"
                    :square="!entry.action.label"
                    :disabled="entry.disabled"
                    class="theme-btn pointer-events-auto flex items-center justify-center gap-1"
                    :ui="{ base: 'theme-btn' }"
                    :aria-label="
                        entry.action.tooltip ||
                        entry.action.label ||
                        entry.action.id
                    "
                    @click="() => handleSidebarFooterAction(entry)"
                >
                    <UIcon
                        :name="entry.action.icon"
                        class="footer-icon w-5 h-5"
                    />
                    <span
                        v-if="entry.action.label"
                        class="footer-label text-xs font-medium"
                    >
                        {{ entry.action.label }}
                    </span>
                </UButton>
            </UTooltip>
        </div>
        <ClientOnly>
            <SideBottomNav
                id="bottom-nav"
                @toggle-dashboard="emit('toggle-dashboard')"
            />
        </ClientOnly>
    </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useToast } from '#imports';
import {
    useSidebarFooterActions,
    type SidebarFooterActionEntry,
} from '~/composables/sidebar/useSidebarSections';
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import SideBottomNav from './SideBottomNav.vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';

const iconNewChat = useIcon('sidebar.new_chat');
const iconSearch = useIcon('sidebar.search');
const iconNewNote = useIcon('sidebar.new_note');
const iconNewFolder = useIcon('sidebar.new_folder');
const iconPageHome = useIcon('sidebar.page.home');
const iconPageDefault = useIcon('sidebar.page.default');

const props = defineProps<{
    activeThread?: string;
}>();

const DEFAULT_PAGE_ID = 'sidebar-home';

// Theme overrides for collapsed sidebar buttons
const newChatButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.new-chat',
        isNuxtUI: true,
    });

    const themeUi = (overrides.value as any)?.ui || {};

    const mergedUi = { ...themeUi };

    return {
        size: 'sb-square' as const,
        icon: iconNewChat.value,
        ...(overrides.value as any),
        ui: mergedUi,
    };
});

const searchButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.collapsed-search',
        isNuxtUI: true,
    });

    const themeUi = (overrides.value as any)?.ui || {};
    const mergedUi = { ...themeUi };

    return {
        size: 'sb-base' as const,
        color: 'on-surface' as const,
        square: false as const,
        icon: iconSearch.value,
        ...(overrides.value as any),
        ui: mergedUi,
    };
});

const newDocButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.new-document',
        isNuxtUI: true,
    });

    const themeUi = (overrides.value as any)?.ui || {};

    const mergedUi = { ...themeUi };

    return {
        icon: iconNewNote.value,
        size: 'sb-base' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
        ui: mergedUi,
    };
});

const newProjectButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.new-project',
        isNuxtUI: true,
    });

    const themeUi = (overrides.value as any)?.ui || {};

    const mergedUi = { ...themeUi };

    return {
        icon: iconNewFolder.value,
        size: 'sb-base' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
        ui: mergedUi,
    };
});

const collapsedPageButtonUiDefaults = {
    default: {
        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] hover:ring-1 hover:ring-[var(--md-surface-active)] active:bg-[var(--md-surface-active)] text-[var(--md-on-surface)]',
        leadingIcon: 'w-6 h-6',
    },
    active: {
        base: 'bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]  text-[var(--md-on-surface)]',
        leadingIcon: 'w-6 h-6',
    },
} as const;

function createCollapsedPageButtonProps(state?: 'active') {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.collapsed-page',
        state,
        isNuxtUI: true,
    });

    const stateKey = state === 'active' ? 'active' : 'default';

    return computed(() => {
        const overrideValue = (overrides.value as any) || {};
        const { ui: themeUi = {}, ...restOverrides } = overrideValue;
        const mergedUi = {
            ...collapsedPageButtonUiDefaults[stateKey],
            ...(themeUi as Record<string, unknown>),
        };

        return {
            size: 'sb-base' as const,
            color: 'on-surface' as const,
            ...restOverrides,
            ui: mergedUi,
        };
    });
}

const pageButtonProps = createCollapsedPageButtonProps();
const pageButtonActiveProps = createCollapsedPageButtonProps('active');

const { listSidebarPages } = useSidebarPages();
const { activePageId, setActivePage } = useActiveSidebarPage();

const orderedPages = computed(() => {
    const pages = listSidebarPages.value.slice();
    if (!pages.length) return [];

    // Filter out the default and inline pages as they are rendered in the home scroll
    const hiddenPages = new Set([
        DEFAULT_PAGE_ID,
        'sidebar-chats',
        'sidebar-docs',
    ]);
    const filtered = pages.filter((page) => !hiddenPages.has(page.id));

    // Sort by order (default 200) so custom pages appear under built-in controls
    return filtered.sort((a, b) => (a.order ?? 200) - (b.order ?? 200));
});

const activeDocumentIds = computed<string[]>(() => {
    const api = getGlobalMultiPaneApi();
    if (api && api.panes && Array.isArray(api.panes.value)) {
        return api.panes.value
            .filter((p) => p.mode === 'doc' && p.documentId)
            .map((p) => p.documentId as string);
    }
    return [];
});

const activeThreadIds = computed<string[]>(() => {
    const api = getGlobalMultiPaneApi();
    if (api && api.panes && Array.isArray(api.panes.value)) {
        const ids = api.panes.value
            .filter((p) => p.mode === 'chat' && p.threadId)
            .map((p) => p.threadId as string)
            .filter(Boolean);
        if (ids.length) return ids;
    }
    return props.activeThread ? [props.activeThread] : [];
});

const collapsedFooterContext = () => ({
    activeThreadId: activeThreadIds.value[0] ?? null,
    activeDocumentId: activeDocumentIds.value[0] ?? null,
    isCollapsed: true,
});

const sidebarFooterActions = useSidebarFooterActions(collapsedFooterContext);

async function handleSidebarFooterAction(entry: SidebarFooterActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler(collapsedFooterContext());
    } catch (error) {
        console.error(
            `[SidebarCollapsed] footer action "${entry.action.id}" failed`,
            error
        );
    }
}

const toast = useToast();

async function handlePageSelect(pageId: string) {
    if (pageId === activePageId.value) return;

    try {
        const ok = await setActivePage(pageId);
        if (!ok) {
            // Show toast if activation was vetoed
            const page = listSidebarPages.value.find((p) => p.id === pageId);
            toast.add({
                title: 'Cannot switch page',
                description: page?.label
                    ? `Unable to activate "${page.label}"`
                    : 'Page activation failed',
                color: 'neutral',
            });
        } else {
            // Expand sidebar to show the selected page content
            emit('expand-sidebar');
        }
    } catch (error) {
        console.error(
            `[SidebarCollapsed] failed to activate sidebar page "${pageId}"`,
            error
        );
        toast.add({
            title: 'Error',
            description: 'Failed to switch pages',
            color: 'error',
        });
    }
}

const emit = defineEmits<{
    (e: 'new-chat'): void;
    (e: 'new-document'): void;
    (e: 'new-project'): void;
    (e: 'focus-search'): void;
    (e: 'toggle-dashboard'): void;
    (e: 'expand-sidebar'): void;
}>();
</script>
