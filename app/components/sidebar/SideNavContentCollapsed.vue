<template>
    <div
        id="nav-collapsed-container"
        class="flex min-w-[64px] max-w-[64px] flex-col justify-between h-[calc(100dvh-49.818px)] relative"
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
                        id="btn-new-chat"
                        size="md"
                        class="flex item-center justify-center"
                        icon="pixelarticons:message-plus"
                        :ui="{
                            base: 'w-[38.5px]! h-[39px]',
                            leadingIcon: 'w-5 h-5',
                        }"
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
                    id="btn-search"
                    size="md"
                    class="flex item-center justify-center"
                    icon="pixelarticons:search"
                    :ui="{
                        base: 'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-[var(--md-on-surface)]',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('focus-search')"
                ></UButton>
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
                    id="btn-new-doc"
                    class="flex item-center justify-center"
                    icon="pixelarticons:note-plus"
                    :ui="{
                        base: 'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-[var(--md-on-surface)]',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('new-document')"
                />
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
                    id="btn-new-project"
                    class="flex item-center justify-center"
                    icon="pixelarticons:folder-plus"
                    :ui="{
                        base: 'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-[var(--md-on-surface)]',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('new-project')"
                />
            </UTooltip>

            <ClientOnly>
                <div
                    id="nav-pages-section"
                    class="pt-2 flex flex-col space-y-2 border-t-2"
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
                            id="btn-home"
                            size="md"
                            class="flex item-center justify-center"
                            icon="pixelarticons:home"
                            :aria-pressed="activePageId === DEFAULT_PAGE_ID"
                            aria-label="Home"
                            :ui="pageButtonUi(activePageId === DEFAULT_PAGE_ID)"
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
                            :id="`btn-page-${page.id}`"
                            size="md"
                            class="flex item-center justify-center"
                            :icon="page.icon || 'pixelarticons:view-grid'"
                            :aria-pressed="activePageId === page.id"
                            :aria-label="page.label"
                            :ui="pageButtonUi(activePageId === page.id)"
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
        >
            <UButton
                id="btn-dashboard"
                size="md"
                class="flex item-center justify-center"
                icon="pixelarticons:dashboard"
                :ui="{
                    base: 'bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]/80 active:bg-[var(--md-surface-variant)]/90 text-[var(--md-on-surface)]',
                    leadingIcon: 'w-5 h-5',
                }"
                @click="emit('toggle-dashboard')"
            ></UButton>
        </div>
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
                    class="retro-btn pointer-events-auto flex items-center justify-center gap-1"
                    :ui="{ base: 'retro-btn' }"
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
import SideBottomNav from './SideBottomNav.vue';

const props = defineProps<{
    activeThread?: string;
}>();

const DEFAULT_PAGE_ID = 'sidebar-home';

const { listSidebarPages } = useSidebarPages();
const { activePageId, setActivePage } = useActiveSidebarPage();

const orderedPages = computed(() => {
    const pages = listSidebarPages.value.slice();
    if (!pages.length) return [];

    // Filter out the default page as it should not appear in collapsed nav
    const filtered = pages.filter((page) => page.id !== DEFAULT_PAGE_ID);

    // Sort by order (default 200) so custom pages appear under built-in controls
    return filtered.sort((a, b) => (a.order ?? 200) - (b.order ?? 200));
});

const activeDocumentIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        return api.panes.value
            .filter((p: any) => p.mode === 'doc' && p.documentId)
            .map((p: any) => p.documentId as string);
    }
    return [];
});

const activeThreadIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        const ids = api.panes.value
            .filter((p: any) => p.mode === 'chat' && p.threadId)
            .map((p: any) => p.threadId as string)
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

function pageButtonUi(isActive: boolean) {
    const base =
        'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-[var(--md-on-surface)]';
    if (!isActive) return { base };
    return {
        base: 'bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]/80 active:bg-[var(--md-surface-variant)]/90 text-[var(--md-on-surface)]',
    };
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
