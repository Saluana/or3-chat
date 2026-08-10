<template>
    <div
        class="docs-shell h-[100dvh] flex flex-col bg-[var(--md-surface)] overflow-hidden"
    >
        <!-- Header -->
        <header class="docs-header">
            <div class="docs-header-row">
                <div class="docs-header-brand-cell">
                    <UButton
                        v-bind="sidebarToggleButtonProps"
                        :icon="useIcon('ui.menu').value"
                        class="md:hidden!"
                        :aria-controls="sidebarId"
                        :aria-expanded="sidebarOpen"
                        :aria-label="
                            sidebarOpen ? 'Close navigation' : 'Open navigation'
                        "
                        @click="toggleSidebar"
                    />
                    <NuxtLink to="/" class="docs-brand">
                        <img
                            src="/butthole-logo.webp"
                            alt="OR3 logo"
                            class="docs-brand-logo"
                        />
                        <span class="docs-brand-text">
                            OR3&nbsp;<span class="docs-brand-accent">Docs</span>
                        </span>
                    </NuxtLink>
                </div>

                <!-- Search (desktop): aligned with the content column below -->
                <div class="docs-header-search hidden md:block">
                    <div class="docs-header-search-inner">
                        <UInput
                            v-bind="searchInputProps"
                            v-model="searchQuery"
                            class="docs-search"
                        >
                            <template #trailing>
                                <kbd class="docs-search-kbd" aria-hidden="true"
                                    >⌘K</kbd
                                >
                            </template>
                        </UInput>
                    </div>
                </div>

                <div class="docs-header-actions-cell">
                    <UButton
                        v-bind="headerThemeButtonProps"
                        :icon="themeToggleIcon"
                        :aria-label="'Toggle theme'"
                        @click="toggleTheme"
                    />
                </div>
            </div>

            <!-- Search (mobile): full-width row -->
            <div class="docs-header-search-mobile md:hidden">
                <UInput
                    v-bind="searchInputProps"
                    v-model="searchQuery"
                    class="docs-search"
                />
            </div>
        </header>

        <Teleport to="body">
            <Transition
                enter-active-class="transition-opacity duration-150 ease-out"
                leave-active-class="transition-opacity duration-150 ease-in"
                enter-from-class="opacity-0"
                leave-to-class="opacity-0"
            >
                <div
                    v-if="isMobile && sidebarOpen"
                    class="fixed inset-0 z-[60] flex"
                    role="dialog"
                    aria-modal="true"
                    :aria-labelledby="sidebarLabelId"
                >
                    <div
                        class="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
                        aria-hidden="true"
                        @click="closeSidebar"
                    ></div>
                    <Transition
                        enter-active-class="transition-transform duration-200 ease-out"
                        leave-active-class="transition-transform duration-200 ease-in"
                        enter-from-class="-translate-x-full"
                        leave-to-class="-translate-x-full"
                    >
                        <aside
                            v-if="sidebarOpen"
                            ref="mobileSidebarRef"
                            :id="sidebarId"
                            class="docs-mobile-sidebar relative z-[61] h-full w-[min(84vw,320px)] max-w-full transform bg-[var(--md-surface)] border-r-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[color:var(--md-border-color)] shadow-2xl overflow-y-auto scrollbars"
                            @keydown="onSidebarKeydown"
                        >
                            <h2 :id="sidebarLabelId" class="sr-only">
                                Documentation navigation
                            </h2>
                            <div class="px-4 pt-5 pb-10">
                                <DocsSidebarNav
                                    :navigation="resolvedNavigation"
                                    :is-group-expanded="isGroupExpanded"
                                    :toggle-group="toggleGroup"
                                    @navigate="closeSidebar"
                                />
                            </div>
                        </aside>
                    </Transition>
                </div>
            </Transition>
        </Teleport>

        <!-- Main Layout -->
        <div class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Sidebar -->
            <aside
                :id="sidebarId"
                class="docs-sidebar flex-shrink-0 w-[272px] overflow-y-auto scrollbars hidden md:block"
            >
                <div class="px-4 pt-6 pb-12">
                    <DocsSidebarNav
                        :navigation="resolvedNavigation"
                        :is-group-expanded="isGroupExpanded"
                        :toggle-group="toggleGroup"
                    />
                </div>
            </aside>

            <!-- Content Area -->
            <main
                ref="mainEl"
                class="docs-main flex-1 min-w-0 max-w-[100dvw] overflow-x-hidden overflow-y-auto scrollbars"
            >
                <div
                    class="docs-content-wrap max-w-[100dvw] sm:max-w-[720px] lg:max-w-[768px] mx-auto pt-7 pb-24 px-5 sm:px-8 md:pt-10"
                >
                    <!-- Search Results -->
                    <div v-if="searchQuery && searchTrigger" class="mb-8">
                        <div class="docs-eyebrow mb-1">Search</div>
                        <h2 class="docs-search-results-title">
                            Results for &ldquo;{{ searchQuery }}&rdquo;
                        </h2>
                        <LazySearchPanel
                            v-if="docmap"
                            :docmap="docmap"
                            :search-query="searchQuery"
                            @navigate="navigateToResult"
                        />
                    </div>

                    <!-- Page Content -->
                    <div v-else class="docs-content">
                        <!-- Loading skeleton -->
                        <div
                            v-if="isLoadingContent"
                            class="docs-skeleton"
                            aria-label="Loading content"
                        >
                            <div class="docs-skeleton-bar docs-skeleton-title"></div>
                            <div class="docs-skeleton-bar w-full"></div>
                            <div class="docs-skeleton-bar w-11/12"></div>
                            <div class="docs-skeleton-bar w-4/5"></div>
                            <div class="docs-skeleton-bar docs-skeleton-heading"></div>
                            <div class="docs-skeleton-bar w-full"></div>
                            <div class="docs-skeleton-bar w-10/12"></div>
                            <div class="docs-skeleton-bar w-3/5"></div>
                        </div>

                        <!-- Content -->
                        <div v-else ref="contentRoot">
                            <!-- Mobile TOC (collapsible) -->
                            <div
                                v-if="computedShowToc && tocList.length > 0"
                                class="docs-mobile-toc lg:hidden"
                            >
                                <button
                                    type="button"
                                    class="docs-mobile-toc-toggle"
                                    @click="mobileTocOpen = !mobileTocOpen"
                                    :aria-expanded="mobileTocOpen"
                                >
                                    <span>On this page</span>
                                    <UIcon
                                        :name="useIcon('ui.chevron.down').value"
                                        class="w-3.5 h-3.5 opacity-60 transition-transform duration-200"
                                        :class="{ 'rotate-180': mobileTocOpen }"
                                        aria-hidden="true"
                                    />
                                </button>
                                <Transition name="docs-collapsible">
                                    <div
                                        v-if="mobileTocOpen"
                                        class="docs-mobile-toc-body"
                                    >
                                        <TocListView
                                            :toc="tocList"
                                            :active-id="activeTocId"
                                            @select="onMobileTocSelect"
                                        />
                                    </div>
                                </Transition>
                            </div>

                            <StreamMarkdown
                                :content="displayContent"
                                class="prose prose-pre:font-mono or3-prose docs-prose max-w-none"
                                :allowed-link-prefixes="[
                                    'https://',
                                    'http://',
                                    '/',
                                ]"
                                :allowed-image-prefixes="[
                                    'https://',
                                    'http://',
                                    '/',
                                ]"
                                :code-block-show-line-numbers="false"
                                :shiki-theme="currentShikiTheme"
                            />

                            <!-- Prev / Next navigation -->
                            <nav
                                v-if="prevPage || nextPage"
                                class="docs-prevnext"
                                aria-label="Page navigation"
                            >
                                <NuxtLink
                                    v-if="prevPage"
                                    :to="prevPage.path"
                                    class="docs-prevnext-card docs-prevnext-prev"
                                >
                                    <span class="docs-prevnext-label">
                                        <UIcon
                                            :name="useIcon('ui.arrow.left').value"
                                            class="w-3.5 h-3.5"
                                            aria-hidden="true"
                                        />
                                        Previous
                                    </span>
                                    <span class="docs-prevnext-title">{{
                                        prevPage.label
                                    }}</span>
                                </NuxtLink>
                                <span v-else class="hidden sm:block"></span>
                                <NuxtLink
                                    v-if="nextPage"
                                    :to="nextPage.path"
                                    class="docs-prevnext-card docs-prevnext-next"
                                >
                                    <span class="docs-prevnext-label">
                                        Next
                                        <UIcon
                                            :name="
                                                useIcon('ui.chevron.right').value
                                            "
                                            class="w-3.5 h-3.5"
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <span class="docs-prevnext-title">{{
                                        nextPage.label
                                    }}</span>
                                </NuxtLink>
                            </nav>
                        </div>
                    </div>
                </div>
            </main>

            <!-- Table of Contents (Right Sidebar) -->
            <aside
                v-if="computedShowToc && tocList.length > 0"
                class="docs-toc flex-shrink-0 w-[240px] overflow-y-auto scrollbars hidden lg:block"
            >
                <nav class="pl-5 pr-4 pt-9 pb-12" aria-label="On this page">
                    <div class="docs-eyebrow mb-3">On this page</div>
                    <TocListView
                        :toc="tocList"
                        :active-id="activeTocId"
                        @select="scrollToHeading"
                    />
                </nav>
            </aside>
        </div>
    </div>
    <ui-help-chat :documentation-map="JSON.stringify(docmap)" />
</template>

<script setup lang="ts">
import {
    ref,
    computed,
    watch,
    onMounted,
    nextTick,
    defineComponent,
    h,
} from 'vue';
import type { PropType } from 'vue';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import {
    useNuxtApp,
    useRoute,
    useAsyncData,
    navigateTo,
} from '#imports';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import { useScrollLock } from '~/composables/core/useScrollLock';
import LazySearchPanel from '~/components/documents/LazySearchPanel.vue';
import DocsSidebarNav from '~/components/documentation/DocsSidebarNav.vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';
import { useMutationObserver, useEventListener } from '@vueuse/core';
import { useDocumentationNavigation } from '~/composables/documents/useDocumentationNavigation';
import { useDocumentationContent } from '~/composables/documents/useDocumentationContent';
import {
    buildTocFromElement,
    slugifyHeading,
} from '~/composables/documents/useDocumentationToc';

const { $theme } = useNuxtApp();

const currentThemeName = computed<string>(() => {
    return ($theme as any)?.current?.value ?? ($theme as any)?.get?.() ?? 'light';
});

const currentShikiTheme = computed(() => {
    return currentThemeName.value.startsWith('dark') ? 'github-dark' : 'github-light';
});

const themeToggleIcon = computed(() => {
    return currentThemeName.value.startsWith('dark')
        ? useIcon('shell.theme.light').value
        : useIcon('ui.moon').value;
});

interface NavItem {
    label: string;
    path: string;
}

interface TocItem {
    id: string;
    text: string;
    level: number;
}

interface DocmapFile {
    name: string;
    path: string;
    category: string;
}

interface DocmapSection {
    title: string;
    path: string;
    files: DocmapFile[];
}

interface Docmap {
    title: string;
    description: string;
    version: string;
    sections: DocmapSection[];
}

const TocListView = defineComponent({
    name: 'DocumentationTocList',
    props: {
        toc: {
            type: Array as PropType<TocItem[]>,
            required: true,
        },
        activeId: {
            type: String as PropType<string | null>,
            default: null,
        },
    },
    emits: ['select'],
    setup(props, { emit }) {
        const handleSelect = (id: string, event: MouseEvent) => {
            event.preventDefault();
            emit('select', id);
        };

        return () =>
            h(
                'ul',
                { class: 'docs-toc-list' },
                props.toc.map((heading) =>
                    h(
                        'li',
                        { key: heading.id },
                        h(
                            'a',
                            {
                                href: `#${heading.id}`,
                                class: [
                                    'docs-toc-link',
                                    heading.id === props.activeId
                                        ? 'docs-toc-link-active'
                                        : undefined,
                                    heading.level === 3
                                        ? 'docs-toc-link-l3'
                                        : heading.level === 4
                                        ? 'docs-toc-link-l4'
                                        : undefined,
                                ],
                                onClick: (event: MouseEvent) =>
                                    handleSelect(heading.id, event),
                            },
                            heading.text
                        )
                    )
                )
            );
    },
});

const props = withDefaults(
    defineProps<{
        navigation?: any[];
        showToc?: boolean;
        toc?: TocItem[];
        content?: string;
    }>(),
    {
        showToc: true,
    }
);

const searchQuery = ref('');
const searchTrigger = ref(false);
const docmap = ref<Docmap | null>(null);

// Root element that contains rendered markdown to extract headings from
const contentRoot = ref<HTMLElement | null>(null);
const mainEl = ref<HTMLElement | null>(null);
// Flag to enable/disable mutation observer for TOC building
const shouldObserveToc = ref(false);
const headingOffsets = ref<Record<string, number>>({});
const activeTocId = ref<string | null>(null);
let scrollSpyRaf = 0;

// Local TOC derived from DOM when not provided via props
const localToc = ref<TocItem[]>([]);
const tocList = computed<TocItem[]>(
    () =>
        (props.toc && props.toc.length
            ? props.toc
            : localToc.value) as TocItem[]
);
const computedShowToc = computed(
    () =>
        props.showToc &&
        tocList.value.length > 0 &&
        !isLoadingContent.value &&
        !(searchQuery.value && searchTrigger.value)
);

const route = useRoute();

const { isMobile } = useResponsiveState();
const sidebarOpen = ref(false);
const mobileSidebarRef = ref<HTMLElement | null>(null);
const sidebarId = 'docs-sidebar';
const sidebarLabelId = 'docs-sidebar-heading';

let lastFocusedElement: HTMLElement | null = null;
let shouldRestoreFocus = true;

const { lock: lockScroll, unlock: unlockScroll } = useScrollLock();

function useDocsButtonProps(
    identifier: string,
    fallback: Record<string, unknown> = {}
) {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'docs',
        identifier,
        isNuxtUI: true,
    });
    return computed(() => ({
        ...fallback,
        ...(overrides.value as Record<string, unknown>),
    }));
}

const sidebarToggleButtonProps = useDocsButtonProps('docs.sidebar-toggle', {
    class: 'docs-sidebar-toggle-btn theme-btn',
    variant: 'ghost',
    size: 'sm',
    square: true,
    color: 'neutral',
});
const headerThemeButtonProps = useDocsButtonProps('docs.theme-toggle', {
    class: 'docs-theme-toggle-btn theme-btn',
    variant: 'ghost',
    size: 'sm',
    square: true,
    color: 'neutral',
});

const searchInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'docs',
        identifier: 'docs.search-input',
        isNuxtUI: true,
    });
    const merged = buildThemeOverrideProps(overrides.value, {
        baseClass: 'docs-search-input',
    }) as Record<string, any>;
    const uiOverrides = ((merged.ui as Record<string, any>) || {}) as Record<
        string,
        any
    >;
    const baseUi = ['w-full', uiOverrides.base]
        .filter(Boolean)
        .join(' ')
        .trim();
    const rootUi = ['w-full', uiOverrides.root]
        .filter(Boolean)
        .join(' ')
        .trim();
    const { ui: _ignoredUi, ...rest } = merged;
    return {
        placeholder: 'Search docs...',
        size: 'md' as const,
        leadingIcon: useIcon('ui.search').value,
        ...rest,
        ui: {
            ...uiOverrides,
            root: rootUi,
            base: baseUi,
        },
    };
});

const {
    resolvedNavigation,
    isGroupExpanded,
    toggleGroup,
    expandGroupsForPath,
    applyDocmapNavigation,
} = useDocumentationNavigation(
    computed(() => route.path),
    computed(() => props.navigation as any)
);

const { pending: isLoadingContent, displayContent } = useDocumentationContent(
    computed(() => route.path),
    computed(() => props.content)
);

// Prev / Next page navigation (flattened doc order)
const flatNavItems = computed<NavItem[]>(() => {
    const items: NavItem[] = [];
    for (const category of resolvedNavigation.value) {
        for (const group of category.groups) {
            items.push(...group.items);
        }
    }
    return items;
});

const currentNavIndex = computed(() =>
    flatNavItems.value.findIndex((item) => item.path === route.path)
);

const prevPage = computed<NavItem | null>(() =>
    currentNavIndex.value > 0
        ? flatNavItems.value[currentNavIndex.value - 1]!
        : null
);

const nextPage = computed<NavItem | null>(() =>
    currentNavIndex.value >= 0 &&
    currentNavIndex.value < flatNavItems.value.length - 1
        ? flatNavItems.value[currentNavIndex.value + 1]!
        : null
);

const mobileTocOpen = ref(false);

function toggleSidebar() {
    if (!isMobile.value) return;
    shouldRestoreFocus = true;
    sidebarOpen.value = !sidebarOpen.value;
}

function closeSidebar(eventOrOptions: Event | { restoreFocus?: boolean } = {}) {
    const options = eventOrOptions instanceof Event ? {} : eventOrOptions;

    if (eventOrOptions instanceof Event) {
        eventOrOptions.preventDefault();
    }

    if (!sidebarOpen.value) return;
    shouldRestoreFocus = options.restoreFocus ?? true;
    sidebarOpen.value = false;
}

function focusFirstSidebarItem() {
    const [firstFocusable] = getSidebarFocusableElements();
    firstFocusable?.focus({ preventScroll: true });
}

function getSidebarFocusableElements(): HTMLElement[] {
    if (!mobileSidebarRef.value) return [];
    const selector =
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(
        mobileSidebarRef.value.querySelectorAll<HTMLElement>(selector)
    ).filter(
        (el) =>
            !el.hasAttribute('disabled') &&
            el.tabIndex !== -1 &&
            !el.getAttribute('aria-hidden')
    );
}

function onSidebarKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault();
        closeSidebar();
        return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getSidebarFocusableElements();
    if (focusable.length === 0) {
        event.preventDefault();
        return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
    } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
    }
}

// Use useAsyncData for docmap to enable SSR and hydration
const { data: docmapData } = await useAsyncData(
    'docmap',
    async () => {
        try {
            if (import.meta.server) {
                const bundled = await import(
                    '~~/public/_documentation/docmap.json'
                );
                return bundled.default as Docmap;
            }
            const map = await $fetch<Docmap | null>(
                '/_documentation/docmap.json'
            );
            return map ?? null;
        } catch (e) {
            console.error('Failed to fetch docmap.json:', e);
            return null;
        }
    },
    { server: true, default: () => null }
);

// Apply docmap immediately if available (server or client)
if (docmapData.value) {
    docmap.value = docmapData.value;
    applyDocmapNavigation(docmapData.value);
}

watch(docmapData, (newData) => {
    if (newData) {
        docmap.value = newData;
        applyDocmapNavigation(newData);
    }
});

onMounted(async () => {
    useShikiHighlighter();

    if (!docmapData.value) {
        try {
            const map = await $fetch<Docmap | null>('/_documentation/docmap.json');
            if (map) {
                docmapData.value = map;
            }
        } catch (e) {
            console.error('Client fetch failed:', e);
        }
    }

    // Ensure the TOC builds on fresh SSR loads where the content watcher
    // never fires (data already resolved during hydration).
    await nextTick();
    if (!isLoadingContent.value && displayContent.value) {
        buildTocFromDom();
        observeTocUntilReady();
        updateActiveHeading();
    }
});

// Use VueUse's useEventListener for window resize (auto-cleanup)
useEventListener(window, 'resize', computeHeadingOffsets);

// Scroll-spy: track the active heading while scrolling the main pane
useEventListener(mainEl, 'scroll', onMainScroll, { passive: true });

// Global Cmd/Ctrl+K focuses the docs search
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
    }
});

watch(
    () => route.path,
    async (path, oldPath) => {
        mobileTocOpen.value = false;
        headingOffsets.value = {};
        activeTocId.value = null;
        expandGroupsForPath(path);
        if (isMobile.value && sidebarOpen.value) {
            closeSidebar({ restoreFocus: false });
        }
        await nextTick();
        computeHeadingOffsets();
        // Content loading handled by useAsyncData auto-watch
    },
    { immediate: true }
);

watch(
    tocList,
    () => {
        headingOffsets.value = {};
        nextTick(() => {
            computeHeadingOffsets();
            updateActiveHeading();
        });
    },
    { immediate: true }
);

watch(isMobile, (mobile) => {
    if (!mobile && sidebarOpen.value) {
        closeSidebar({ restoreFocus: false });
    }
});

watch(sidebarOpen, async (open) => {
    if (!import.meta.client) return;

    if (open && isMobile.value) {
        lastFocusedElement = document.activeElement as HTMLElement | null;
        lockScroll();
        await nextTick();
        focusFirstSidebarItem();
    } else {
        unlockScroll();
        await nextTick();
        if (shouldRestoreFocus && lastFocusedElement) {
            lastFocusedElement.focus({ preventScroll: true });
        }
        lastFocusedElement = null;
        shouldRestoreFocus = true;
    }
});

function buildTocFromDom() {
    if (!import.meta.client) return;

    const root = contentRoot.value;
    const items = root ? buildTocFromElement(root).toc : [];

    // If DOM headings found, use them (skip the page-level h1)
    if (items.length > 0) {
        localToc.value = items.filter((item) => item.level > 1);
        nextTick(computeHeadingOffsets);
        return;
    }

    // Fallback: parse headings from markdown string (SSR-safe)
    const md = displayContent.value || '';
    if (!md) {
        localToc.value = [];
        return;
    }

    const mdItems: TocItem[] = [];
    let inCode = false;
    for (const rawLine of md.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('```')) {
            inCode = !inCode;
            continue;
        }
        if (inCode) continue;
        const m = /^\s*(#{2,4})\s+(.+)$/.exec(line);
        if (!m) continue;
        const level = m[1]!.length; // 2..4
        const text = m[2]!.replace(/[#`*_~<>\[\]\(\)]/g, '').trim();
        if (!text) continue;
        const id = slugifyHeading(text);
        mdItems.push({ id, text, level });
    }
    localToc.value = mdItems;
    nextTick(computeHeadingOffsets);
}

function observeTocUntilReady() {
    if (!import.meta.client) return;
    if (!contentRoot.value) return;

    // If headings already present, build immediately
    const hasHeadings = contentRoot.value.querySelector('h2, h3, h4');
    if (hasHeadings) {
        buildTocFromDom();
        shouldObserveToc.value = false;
        return;
    }

    // Enable TOC observation
    shouldObserveToc.value = true;
}

// Use VueUse's useMutationObserver for TOC observation (auto-cleanup)
useMutationObserver(
    () => (shouldObserveToc.value ? contentRoot.value : null),
    () => {
        if (!contentRoot.value) return;
        const found = contentRoot.value.querySelector('h2, h3, h4');
        if (found) {
            buildTocFromDom();
            shouldObserveToc.value = false;
        }
    },
    { childList: true, subtree: true }
);

function computeHeadingOffsets() {
    if (!import.meta.client) return;
    const container = mainEl.value;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const offsets: Record<string, number> = {};

    for (const item of tocList.value) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        offsets[item.id] = container.scrollTop + (rect.top - containerRect.top);
    }

    headingOffsets.value = offsets;
}

function onMainScroll() {
    if (scrollSpyRaf) return;
    scrollSpyRaf = requestAnimationFrame(() => {
        scrollSpyRaf = 0;
        updateActiveHeading();
    });
}

function updateActiveHeading() {
    if (!import.meta.client) return;
    const container = mainEl.value;
    if (!container || tocList.value.length === 0) {
        activeTocId.value = null;
        return;
    }
    if (Object.keys(headingOffsets.value).length === 0) {
        computeHeadingOffsets();
    }

    const scrollTop = container.scrollTop;
    const threshold = scrollTop + 96;
    let current: string | null = null;

    for (const item of tocList.value) {
        const offset = headingOffsets.value[item.id];
        if (typeof offset !== 'number') continue;
        if (offset <= threshold) {
            current = item.id;
        } else {
            break;
        }
    }

    // Near the bottom, activate the last heading
    if (
        container.scrollHeight - container.clientHeight - scrollTop < 48 &&
        tocList.value.length > 0
    ) {
        current = tocList.value[tocList.value.length - 1]!.id;
    }

    activeTocId.value = current;
}

// Recompute TOC after content loads/renders
watch([displayContent, isLoadingContent], async ([content, loading]) => {
    if (!import.meta.client) return;
    if (!loading && content) {
        await nextTick();
        // Build now and also observe in case streaming/async render continues
        buildTocFromDom();
        observeTocUntilReady();
        updateActiveHeading();
    }
});

// Trigger lazy search panel load when user types
watch(searchQuery, (query) => {
    if (query && query.length >= 2) {
        searchTrigger.value = true;
    } else {
        searchTrigger.value = false;
    }
});

async function navigateToResult(path: string) {
    searchQuery.value = '';
    searchTrigger.value = false;
    await navigateTo(path);
}

function focusSearch() {
    const input = document.querySelector(
        '.docs-header-search input, .docs-header-search-mobile input'
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
}

function toggleTheme() {
    const nuxtApp = useNuxtApp();
    const theme = nuxtApp.$theme as { toggle?: () => void } | undefined;
    theme?.toggle?.();
}

function scrollToHeading(id: string) {
    const main = mainEl.value;
    if (!main) return;

    if (!(id in headingOffsets.value)) {
        computeHeadingOffsets();
    }

    const target = headingOffsets.value[id];
    if (typeof target !== 'number') return;

    const offset = isMobile.value ? 20 : 28;
    main.scrollTo({
        top: Math.max(0, target - offset),
        behavior: 'smooth',
    });
    activeTocId.value = id;
}

function onMobileTocSelect(id: string) {
    scrollToHeading(id);
    mobileTocOpen.value = false;
}
</script>

<style scoped>
@import '~/assets/css/or3-prose.css';
@import '~/assets/css/docs-prose.css';

.docs-shell {
    --docs-font:
        'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont,
        'Segoe UI', Roboto, sans-serif;
    /* Theme-sanctioned border token (design-token registry), with a softer
       variant for hairlines inside content */
    --docs-border: var(--md-border-color);
    --docs-border-soft: color-mix(
        in oklab,
        var(--md-border-color),
        transparent 35%
    );
    --docs-sidebar-bg: color-mix(
        in oklab,
        var(--md-surface-variant) 70%,
        var(--md-surface)
    );
    --docs-eyebrow-fg: color-mix(
        in oklab,
        var(--md-on-surface-variant),
        transparent 25%
    );
    font-family: var(--docs-font);
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

/* ---------- Header ---------- */

.docs-header {
    flex-shrink: 0;
    border-bottom: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--docs-border);
    background: color-mix(in oklab, var(--md-surface) 88%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--md-shadow) 4%, transparent);
    z-index: 10;
}

.docs-header-row {
    display: flex;
    align-items: center;
    height: 60px;
}

@media (max-width: 767px) {
    .docs-header-row {
        height: 56px;
    }
}

/* Brand cell mirrors the sidebar width so the search below-lines up with
   the content column */
.docs-header-brand-cell {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    flex-shrink: 0;
    padding-left: 0.875rem;
}

@media (min-width: 768px) {
    .docs-header-brand-cell {
        width: 272px;
        padding-left: 1.25rem;
    }
}

.docs-header-actions-cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    margin-left: auto;
    padding-right: 0.875rem;
}

@media (min-width: 768px) {
    .docs-header-actions-cell {
        padding-right: 1.25rem;
    }
}

/* Actions cell mirrors the TOC rail width on large screens */
@media (min-width: 1024px) {
    .docs-header-actions-cell {
        width: 240px;
    }
}

.docs-brand {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
    border-radius: var(--md-border-radius-small, calc(var(--md-border-radius) * 0.75));
}

.docs-brand-logo {
    height: 28px;
    width: 28px;
    flex-shrink: 0;
}

.docs-brand-text {
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--md-on-surface);
    white-space: nowrap;
}

.docs-brand-accent {
    color: var(--md-primary);
    font-weight: 550;
}

.docs-header-search {
    flex: 1;
    min-width: 0;
}

/* Same max-width + padding as the content wrapper, so the pill's edges
   align exactly with the article text column */
.docs-header-search-inner {
    max-width: 768px;
    margin-inline: auto;
    padding-inline: 2rem;
}

.docs-header-search-mobile {
    padding: 0 1.25rem 0.75rem;
}

/* Filled-pill search: overrides the theme's default outlined input.
   Elevation uses on-surface alpha so the pill darkens in light mode and
   lightens in dark mode, staying visible on any theme. */
.docs-search :deep(input) {
    background-color: color-mix(in oklab, var(--md-on-surface) 6%, transparent);
    border-color: transparent;
    border-radius: 9999px;
    box-shadow: none;
    height: 40px;
    transition:
        background-color 0.15s ease,
        border-color 0.15s ease,
        box-shadow 0.15s ease;
}

.docs-search :deep(input:hover) {
    background-color: color-mix(in oklab, var(--md-on-surface) 9%, transparent);
}

.docs-search :deep(input:focus),
.docs-search :deep(input:focus-visible) {
    background-color: color-mix(in oklab, var(--md-on-surface) 9%, transparent);
    border-color: color-mix(in oklab, var(--md-primary) 45%, transparent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--md-primary) 14%, transparent);
    outline: none;
}

.docs-search :deep(input::placeholder) {
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
}

.docs-search-kbd {
    display: inline-flex;
    align-items: center;
    padding: 0.18rem 0.42rem;
    border: var(--md-border-width, 1px) solid var(--docs-border);
    border-radius: var(--md-border-radius-small, 6px);
    background: color-mix(in oklab, var(--md-on-surface) 4%, transparent);
    box-shadow: 0 1px 0 var(--docs-border);
    color: var(--md-on-surface-variant);
    font-family: var(--docs-font);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    pointer-events: none;
}

/* ---------- Sidebar ---------- */

.docs-sidebar {
    border-right: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--docs-border);
    background: var(--docs-sidebar-bg);
}

/* ---------- Eyebrow labels ---------- */

.docs-eyebrow {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--docs-eyebrow-fg);
    user-select: none;
}

.docs-search-results-title {
    font-size: 1.35rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--md-on-surface);
    margin-bottom: 1.25rem;
}

/* ---------- TOC (right rail) ---------- */

.docs-toc {
    border-left: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--docs-border);
}

.docs-toc :deep(.docs-toc-list) {
    display: flex;
    flex-direction: column;
    border-left: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--docs-border);
}

.docs-toc :deep(.docs-toc-link) {
    display: block;
    margin-left: -1px;
    padding: 0.28rem 0 0.28rem 0.875rem;
    border-left: var(--md-border-width-strong, var(--md-border-width, 2px)) solid transparent;
    font-size: 13px;
    line-height: 1.4;
    color: var(--md-on-surface-variant);
    transition:
        color 0.15s ease,
        border-color 0.15s ease;
}

.docs-toc :deep(.docs-toc-link:hover) {
    color: var(--md-on-surface);
}

.docs-toc :deep(.docs-toc-link-l3) {
    padding-left: 1.75rem;
}

.docs-toc :deep(.docs-toc-link-l4) {
    padding-left: 2.5rem;
}

.docs-toc :deep(.docs-toc-link-active),
.docs-toc :deep(.docs-toc-link-active:hover) {
    color: var(--md-primary);
    border-left-color: var(--md-primary);
    font-weight: 550;
}

/* ---------- Mobile TOC ---------- */

.docs-mobile-toc {
    margin-bottom: 1.75rem;
    border: var(--md-border-width, 1px) solid var(--docs-border);
    border-radius: var(--md-border-radius, calc(var(--md-border-radius) * 0.9));
    background: var(--md-surface-container-lowest);
    overflow: hidden;
}

.docs-mobile-toc-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.6rem 0.875rem;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--md-on-surface-variant);
    cursor: pointer;
    transition: background-color 0.15s ease;
}

.docs-mobile-toc-toggle:hover {
    background: color-mix(in oklab, var(--md-on-surface) 4%, transparent);
}

.docs-mobile-toc-toggle:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: -2px;
}

.docs-mobile-toc-body {
    padding: 0.5rem 0.875rem 0.75rem;
    border-top: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--docs-border);
}

.docs-mobile-toc-body :deep(.docs-toc-list) {
    border-left: none;
}

.docs-mobile-toc-body :deep(.docs-toc-link) {
    margin-left: 0;
    border-left: none;
    padding-left: 0;
}

.docs-mobile-toc-body :deep(.docs-toc-link-l3) {
    padding-left: 1rem;
}

.docs-mobile-toc-body :deep(.docs-toc-link-l4) {
    padding-left: 1.75rem;
}

/* ---------- Loading skeleton ---------- */

.docs-skeleton {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding-top: 0.5rem;
}

.docs-skeleton-bar {
    height: 13px;
    border-radius: 6px;
    background: linear-gradient(
        90deg,
        var(--md-surface-container) 25%,
        var(--md-surface-container-high) 50%,
        var(--md-surface-container) 75%
    );
    background-size: 200% 100%;
    animation: docs-skeleton-shimmer 1.4s ease infinite;
}

.docs-skeleton-title {
    height: 30px;
    width: 46%;
    margin-bottom: 1rem;
}

.docs-skeleton-heading {
    height: 20px;
    width: 32%;
    margin-top: 1.5rem;
    margin-bottom: 0.25rem;
}

@keyframes docs-skeleton-shimmer {
    0% {
        background-position: 200% 0;
    }
    100% {
        background-position: -200% 0;
    }
}

/* ---------- Prev / Next ---------- */

.docs-prevnext {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    margin-top: 4rem;
    padding-top: 2rem;
    border-top: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--docs-border);
}

@media (min-width: 640px) {
    .docs-prevnext {
        grid-template-columns: 1fr 1fr;
    }
}

.docs-prevnext-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.875rem 1rem;
    border: var(--md-border-width, 1px) solid var(--docs-border);
    border-radius: var(--md-border-radius, calc(var(--md-border-radius) * 1.1));
    transition:
        border-color 0.15s ease,
        background-color 0.15s ease;
}

.docs-prevnext-card:hover {
    border-color: color-mix(in oklab, var(--md-primary) 45%, transparent);
    background: color-mix(in oklab, var(--md-primary) 4%, transparent);
}

.docs-prevnext-card:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}

.docs-prevnext-next {
    text-align: right;
    align-items: flex-end;
}

.docs-prevnext-label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--md-on-surface-variant);
}

.docs-prevnext-title {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--md-primary);
}

/* ---------- Collapsible transition ---------- */

.docs-collapsible-enter-active,
.docs-collapsible-leave-active {
    transition:
        opacity 0.18s ease,
        transform 0.18s ease;
    overflow: hidden;
}

.docs-collapsible-enter-from,
.docs-collapsible-leave-to {
    opacity: 0;
    transform: translateY(-3px);
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
</style>
