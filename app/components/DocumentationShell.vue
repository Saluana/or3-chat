<template>
    <div
        class="docs-shell h-[100dvh] flex flex-col bg-[var(--md-surface)] overflow-hidden"
    >
        <!-- Header -->
        <header
            class="docs-header flex-shrink-0 flex flex-col gap-3 px-4 py-3 border-b-[var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] z-10 md:flex-row md:items-center md:justify-between md:gap-0"
        >
            <div class="flex w-full items-center gap-3 md:w-[250px]">
                <UButton
                    v-bind="sidebarToggleButtonProps"
                    :icon="useIcon('ui.menu').value"
                    class="sm:hidden!"
                    :aria-controls="sidebarId"
                    :aria-expanded="sidebarOpen"
                    :aria-label="
                        sidebarOpen ? 'Close navigation' : 'Open navigation'
                    "
                    @click="toggleSidebar"
                />
                <NuxtLink to="/" class="flex items-center gap-2">
                    <img src="/butthole-logo.webp" alt="Logo" class="h-8 w-8" />
                    <h1 class="font-ps2 text-lg text-[var(--md-primary)]">
                        OR3 Docs
                    </h1>
                </NuxtLink>
                <div class="ml-auto md:hidden">
                    <UButton
                        v-bind="headerThemeButtonProps"
                        :aria-label="'Toggle theme'"
                        @click="toggleTheme"
                    />
                </div>
            </div>

            <!-- Search -->
            <div
                class="docs-header-search w-full md:mx-4 md:flex-1 md:max-w-md"
            >
                <UInput
                    v-bind="searchInputProps"
                    v-model="searchQuery"
                    @keydown.meta.k.prevent="focusSearch"
                />
            </div>

            <!-- Theme Toggle -->
            <div
                class="hidden w-full items-center justify-end md:flex md:w-[250px]"
            >
                <UButton v-bind="headerThemeButtonProps" @click="toggleTheme" />
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
                    class="docs-mobile-sidebar-root fixed inset-0 z-[60] flex"
                    role="dialog"
                    aria-modal="true"
                    :aria-labelledby="sidebarLabelId"
                >
                    <div
                        class="docs-mobile-sidebar-backdrop absolute inset-0 bg-black/50"
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
                            class="docs-mobile-sidebar relative z-[61] h-full w-[min(80vw,320px)] max-w-full transform bg-[var(--md-surface)] border-r-[var(--md-border-width)] border-[color:var(--md-border-color)] shadow-lg overflow-y-auto scrollbars"
                            @keydown="onSidebarKeydown"
                        >
                            <h2 :id="sidebarLabelId" class="sr-only">
                                Documentation navigation
                            </h2>
                            <nav class="docs-mobile-nav p-4">
                                <div class="space-y-6">
                                    <div
                                        v-for="category in resolvedNavigation"
                                        :key="category.label"
                                        class="docs-nav-category space-y-3"
                                    >
                                        <h3
                                            class="font-ps2 text-sm text-[var(--md-on-surface-variant)] border-b-4 border-b-primary pb-2 px-2 uppercase tracking-wide"
                                        >
                                            {{ category.label }}
                                        </h3>
                                        <div class="docs-nav-groups space-y-2">
                                            <div
                                                v-for="group in category.groups"
                                                :key="`${category.label}-${group.label}`"
                                                class="docs-nav-group rounded-md bg-[var(--md-surface)]/40 border border-[color:var(--md-border-color)] border-opacity-40"
                                            >
                                                <button
                                                    type="button"
                                                    class="docs-nav-group-toggle w-full flex items-center justify-between px-3 py-2 text-left font-ps2 text-xs text-[var(--md-on-surface)] uppercase tracking-wide transition-colors hover:bg-[var(--md-primary)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-[var(--md-surface)]"
                                                    @click="
                                                        toggleGroup(
                                                            category.label,
                                                            group.label
                                                        )
                                                    "
                                                    :aria-expanded="
                                                        isGroupExpanded(
                                                            category.label,
                                                            group.label
                                                        )
                                                    "
                                                >
                                                    <span>{{
                                                        group.label
                                                    }}</span>
                                                    <UIcon
                                                        :name="
                                                            useIcon(
                                                                'ui.chevron.down'
                                                            ).value
                                                        "
                                                        class="transition-transform duration-200 w-5 h-5"
                                                        :class="{
                                                            'rotate-180':
                                                                isGroupExpanded(
                                                                    category.label,
                                                                    group.label
                                                                ),
                                                        }"
                                                        aria-hidden="true"
                                                    />
                                                </button>
                                                <Transition name="collapsible">
                                                    <ul
                                                        v-if="
                                                            isGroupExpanded(
                                                                category.label,
                                                                group.label
                                                            )
                                                        "
                                                        class="space-y-1 py-1"
                                                    >
                                                        <li
                                                            v-for="item in group.items"
                                                            :key="item.path"
                                                        >
                                                            <NuxtLink
                                                                :to="item.path"
                                                                class="docs-nav-link flex h-[40px] items-center px-3 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 transition-colors"
                                                                active-class=" dark:text-white text-black  bg-primary/20 hover:bg-primary/20"
                                                                @click="
                                                                    closeSidebar
                                                                "
                                                            >
                                                                {{ item.label }}
                                                            </NuxtLink>
                                                        </li>
                                                    </ul>
                                                </Transition>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </nav>
                        </aside>
                    </Transition>
                </div>
            </Transition>
        </Teleport>

        <!-- Main Layout -->
        <div class="docs-layout flex flex-1 min-h-0 overflow-hidden">
            <!-- Sidebar -->
            <aside
                :id="sidebarId"
                class="docs-sidebar flex-shrink-0 w-64 bg-[var(--md-surface)] overflow-y-auto scrollbars hidden md:block"
            >
                <nav class="docs-sidebar-nav p-4">
                    <div class="space-y-6">
                        <!-- Categories -->
                        <div
                            v-for="category in resolvedNavigation"
                            :key="category.label"
                            class="docs-nav-category space-y-3"
                        >
                            <h3
                                class="font-ps2 text-sm text-[var(--md-on-surface-variant)] border-b-4 border-b-primary pb-2 px-2 uppercase tracking-wide"
                            >
                                {{ category.label }}
                            </h3>
                            <div class="docs-nav-groups space-y-2">
                                <div
                                    v-for="group in category.groups"
                                    :key="`${category.label}-${group.label}`"
                                    class="docs-nav-group rounded-md bg-[var(--md-surface)]/40 border border-[color:var(--md-border-color)] border-opacity-40"
                                >
                                    <button
                                        type="button"
                                        class="docs-nav-group-toggle w-full flex items-center justify-between px-3 py-2 text-left font-ps2 text-xs text-[var(--md-on-surface)] uppercase tracking-wide transition-colors hover:bg-[var(--md-primary)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-[var(--md-surface)]"
                                        @click="
                                            toggleGroup(
                                                category.label,
                                                group.label
                                            )
                                        "
                                        :aria-expanded="
                                            isGroupExpanded(
                                                category.label,
                                                group.label
                                            )
                                        "
                                    >
                                        <span>{{ group.label }}</span>
                                        <UIcon
                                            :name="
                                                useIcon('ui.chevron.down').value
                                            "
                                            class="transition-transform duration-200 w-5 h-5"
                                            :class="{
                                                'rotate-180': isGroupExpanded(
                                                    category.label,
                                                    group.label
                                                ),
                                            }"
                                            aria-hidden="true"
                                        />
                                    </button>
                                    <Transition name="collapsible">
                                        <ul
                                            v-if="
                                                isGroupExpanded(
                                                    category.label,
                                                    group.label
                                                )
                                            "
                                            class="space-y-1 py-1"
                                        >
                                            <li
                                                v-for="item in group.items"
                                                :key="item.path"
                                            >
                                                <NuxtLink
                                                    :to="item.path"
                                                    class="docs-nav-link flex h-[40px] items-center px-3 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 transition-colors"
                                                    active-class=" dark:text-white text-black  bg-primary/20 hover:bg-primary/20"
                                                >
                                                    {{ item.label }}
                                                </NuxtLink>
                                            </li>
                                        </ul>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                    </div>
                </nav>
            </aside>

            <!-- Content Area -->
            <main
                class="docs-main flex-1 min-w-0 max-w-[100dvw] overflow-x-hidden overflow-y-auto scrollbars"
            >
                <div
                    class="max-w-[100dvw] sm:max-w-[680px] lg:max-w-[720px] mx-auto pt-5 pb-24 px-4 md:p-8"
                >
                    <!-- Search Results -->
                    <div v-if="searchQuery && searchTrigger" class="mb-8">
                        <h2
                            class="font-ps2 text-xl mb-4 text-[var(--md-on-surface)]"
                        >
                            Search Results
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
                        <!-- Loading indicator -->
                        <div
                            v-if="isLoadingContent"
                            class="flex items-center justify-center py-12"
                        >
                            <div
                                class="text-[var(--md-on-surface-variant)] font-ps2 text-sm"
                            >
                                Loading...
                            </div>
                        </div>

                        <!-- Content -->
                        <div v-else ref="contentRoot">
                            <!-- Mobile TOC (collapsible) -->
                            <div
                                v-if="computedShowToc && tocList.length > 0"
                                class="lg:hidden mb-6 border-[var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/40"
                            >
                                <button
                                    type="button"
                                    class="w-full flex items-center justify-between px-4 py-3 text-left font-ps2 text-sm text-[var(--md-on-surface)] uppercase tracking-wide transition-colors hover:bg-[var(--md-primary)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-[var(--md-surface)]"
                                    @click="mobileTocOpen = !mobileTocOpen"
                                    :aria-expanded="mobileTocOpen"
                                >
                                    <span>On this page</span>
                                    <UIcon
                                        :name="useIcon('ui.chevron.down').value"
                                        class="transition-transform duration-200 w-5 h-5"
                                        :class="{ 'rotate-180': mobileTocOpen }"
                                        aria-hidden="true"
                                    />
                                </button>
                                <Transition name="collapsible">
                                    <div
                                        v-if="mobileTocOpen"
                                        class="px-4 py-3 border-t-[var(--md-border-width)] border-[color:var(--md-border-color)]"
                                    >
                                        <TocListView
                                            :toc="tocList"
                                            @select="onMobileTocSelect"
                                        />
                                    </div>
                                </Transition>
                            </div>

                            <StreamMarkdown
                                :content="displayContent"
                                class="prose prose-pre:font-mono or3-prose max-w-none"
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
                        </div>
                    </div>
                </div>
            </main>

            <!-- Table of Contents (Right Sidebar) -->
            <aside
                v-if="computedShowToc && tocList.length > 0"
                class="docs-toc flex-shrink-0 w-64 border-l-[var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] overflow-y-auto scrollbars hidden lg:block"
            >
                <nav class="p-4 sticky top-0">
                    <h3
                        class="font-ps2 text-sm text-[var(--md-on-surface-variant)] mb-4"
                    >
                        On this page
                    </h3>
                    <TocListView :toc="tocList" @select="scrollToHeading" />
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
    shallowRef,
    nextTick,
    defineComponent,
    h,
} from 'vue';
import type { PropType } from 'vue';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import { useScrollLock } from '~/composables/core/useScrollLock';
import LazySearchPanel from '~/components/documents/LazySearchPanel.vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useMutationObserver, useEventListener } from '@vueuse/core';

const { $theme } = useNuxtApp();

const currentShikiTheme = computed(() => {
    const theme =
        ($theme as any)?.current?.value ?? ($theme as any)?.get?.() ?? 'light';
    return String(theme).startsWith('dark') ? 'github-dark' : 'github-light';
});

interface NavItem {
    label: string;
    path: string;
}

interface NavGroup {
    label: string;
    items: NavItem[];
}

interface NavCategory {
    label: string;
    groups: NavGroup[];
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
                { class: 'space-y-2 text-sm' },
                props.toc.map((heading) =>
                    h(
                        'li',
                        { key: heading.id },
                        h(
                            'a',
                            {
                                href: `#${heading.id}`,
                                class: [
                                    'block py-1 px-2 text-[var(--md-on-surface)] transition-colors rounded-[var(--md-border-radius)] hover:text-[var(--md-primary)] hover:bg-[var(--md-primary)]/5',
                                    heading.level === 3
                                        ? 'pl-4'
                                        : heading.level === 4
                                        ? 'pl-6'
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
        navigation?: NavCategory[];
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
// currentContent and isLoadingContent defined later via useAsyncData

// Root element that contains rendered markdown to extract headings from
const contentRoot = ref<HTMLElement | null>(null);
// Flag to enable/disable mutation observer for TOC building
const shouldObserveToc = ref(false);
const headingOffsets = ref<Record<string, number>>({});

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
    variant: 'basic',
    size: 'sm',
    square: true,
    color: 'neutral',
});
const headerThemeButtonProps = useDocsButtonProps('docs.theme-toggle', {
    class: 'docs-theme-toggle-btn theme-btn',
    variant: 'basic',
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
    const overridesValue = (overrides.value as Record<string, any>) || {};
    const {
        class: overrideClass = '',
        ui: overrideUi = {},
        ...rest
    } = overridesValue;
    const uiOverrides = (overrideUi as Record<string, any>) || {};
    const baseUi = ['w-full', uiOverrides.base]
        .filter(Boolean)
        .join(' ')
        .trim();
    return {
        placeholder: 'Search docs...',
        size: 'md' as const,
        leadingIcon: useIcon('ui.search').value,
        ...rest,
        ui: {
            ...uiOverrides,
            base: baseUi,
        },
        class: ['docs-search-input', overrideClass].filter(Boolean).join(' '),
    };
});

// Internal navigation state (shallow to avoid deep watchers)
const internalNavigation = shallowRef<NavCategory[]>([]);
// Resolved navigation prefers prop override but stays stable otherwise
const resolvedNavigation = computed<NavCategory[]>(() =>
    props.navigation ? props.navigation : internalNavigation.value
);

const expandedGroups = ref<Set<string>>(new Set());
const mobileTocOpen = ref(false);

function groupKey(category: string, group: string) {
    return `${category}::${group}`;
}

function isGroupExpanded(category: string, group: string): boolean {
    return expandedGroups.value.has(groupKey(category, group));
}

function setGroupExpanded(category: string, group: string, expanded: boolean) {
    const key = groupKey(category, group);
    const has = expandedGroups.value.has(key);
    if (expanded === has) return;
    const next = new Set(expandedGroups.value);
    if (expanded) {
        next.add(key);
    } else {
        next.delete(key);
    }
    expandedGroups.value = next;
}

function toggleGroup(category: string, group: string) {
    setGroupExpanded(category, group, !isGroupExpanded(category, group));
}

function expandGroupsForPath(path: string) {
    if (!path.startsWith('/documentation')) return;
    for (const category of resolvedNavigation.value) {
        for (const group of category.groups) {
            const matches = group.items.some((item) => item.path === path);
            if (matches) {
                setGroupExpanded(category.label, group.label, true);
            }
        }
    }
}

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
    () => $fetch<Docmap>('/_documentation/docmap.json'),
    { server: false }
);

// Apply docmap immediately if available (server or client)
if (docmapData.value) {
    docmap.value = docmapData.value;
    applyDocmapNavigation(docmap.value);
}

// Watch for updates to docmapData (e.g. client-side navigation re-fetch if configured, though unlikely for static json)
watch(docmapData, (newData) => {
    if (newData) {
        docmap.value = newData;
        applyDocmapNavigation(newData);
    }
});



onMounted(() => {
    useShikiHighlighter();
});

// Use VueUse's useEventListener for window resize (auto-cleanup)
useEventListener(window, 'resize', computeHeadingOffsets);

watch(
    () => route.path,
    async (path, oldPath) => {
        mobileTocOpen.value = false;
        headingOffsets.value = {};
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
        nextTick(computeHeadingOffsets);
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



// ----------------------------------------------------------------------
// Content Loading (SSR-safe via useAsyncData)
// ----------------------------------------------------------------------

const { data: fetchedContent, pending: fetchPending, error: fetchError } = await useAsyncData(
    () => `docs-${route.path}`,
    async () => {
        const path = route.path.replace(/\/$/, '') || '/';
        
        // 1. Determine file path
        let docPath = '';
        if (path === '/documentation') {
            docPath = '/_documentation/README.md';
        } else {
            const rel = path.replace(/^\/documentation/, '');
            docPath = `/_documentation${rel}.md`;
        }

        // 2. Fetch content
        try {
            return await $fetch<string>(docPath, { responseType: 'text' });
        } catch (e) {
            // Re-throw to let useAsyncData handle the error state
            throw e; 
        }
    },
    {
        watch: [() => route.path], // Reactive auto-fetch
        server: false, // Client-side only to match previous behavior and avoid SSR loopback issues
    }
);

// Map to existing component API
const isLoadingContent = fetchPending;

const currentContent = computed(() => {
    if (fetchError.value) {
        return `# Page Not Found\n\nThe documentation page you're looking for doesn't exist.\n\n[← Back to Documentation](/documentation)`;
    }
    return fetchedContent.value || '';
});

// Remove old manual loader watchers - useAsyncData handles route watching
// watch(() => route.path, ...) is handled by { watch: [...] } option above


function applyDocmapNavigation(map: Docmap) {
    if (props.navigation) return; // respect external navigation overrides
    if (internalNavigation.value.length) return; // already built

    // Sort sections alphabetically, but always put "Getting Started" first
    const sortedSections = [...map.sections].sort((a, b) => {
        const aIsGettingStarted = a.title.toLowerCase() === 'getting started';
        const bIsGettingStarted = b.title.toLowerCase() === 'getting started';

        if (aIsGettingStarted) return -1;
        if (bIsGettingStarted) return 1;

        return a.title.localeCompare(b.title);
    });

    internalNavigation.value = sortedSections.map((section) => {
        const groupsMap = new Map<string, NavGroup>();
        const sortedFiles = [...section.files].sort((a, b) =>
            a.name.replace('.md', '').localeCompare(b.name.replace('.md', ''))
        );

        sortedFiles.forEach((file) => {
            const groupLabel = file.category || 'General';
            if (!groupsMap.has(groupLabel)) {
                groupsMap.set(groupLabel, {
                    label: groupLabel,
                    items: [],
                });
            }
            const group = groupsMap.get(groupLabel)!;
            group.items.push({
                label: file.name.replace('.md', '').trim(),
                path: `/documentation${file.path}`,
            });
        });

        const groups = Array.from(groupsMap.values())
            .map((group) => ({
                ...group,
                items: [...group.items].sort((a, b) =>
                    a.label.localeCompare(b.label)
                ),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        return {
            label: section.title,
            groups,
        } satisfies NavCategory;
    });

    expandGroupsForPath(route.path);
}

// Use provided content or loaded content
const displayContent = computed(() => props.content || currentContent.value);

// Build TOC from rendered markdown in the DOM
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function buildTocFromDom() {
    if (!import.meta.client) return;

    const headings = contentRoot.value
        ? Array.from(
              contentRoot.value.querySelectorAll<HTMLHeadingElement>(
                  'h2, h3, h4'
              )
          )
        : [];

    const used = new Set<string>();
    const items: TocItem[] = [];

    for (const el of headings) {
        const level = Number(el.tagName.substring(1));
        const text = (el.textContent || '').trim();
        if (!text) continue;

        let id = el.id || slugify(text);
        if (used.has(id)) {
            let n = 2;
            while (used.has(`${id}-${n}`)) n++;
            id = `${id}-${n}`;
        }
        used.add(id);
        if (!el.id) el.id = id;

        items.push({ id, text, level });
    }

    // If DOM headings found, use them
    if (items.length > 0) {
        localToc.value = items;
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
        const id = slugify(text);
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
    () => shouldObserveToc.value ? contentRoot.value : null,
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
    const container = document.querySelector('main.flex-1');
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

// Recompute TOC after content loads/renders
watch([displayContent, isLoadingContent], async ([content, loading]) => {
    if (!import.meta.client) return;
    if (!loading && content) {
        await nextTick();
        // Build now and also observe in case streaming/async render continues
        buildTocFromDom();
        observeTocUntilReady();
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
    // Focus search input
    const input = document.querySelector(
        'input[placeholder*="Search"]'
    ) as HTMLInputElement;
    input?.focus();
}

function toggleTheme() {
    const nuxtApp = useNuxtApp();
    const theme = nuxtApp.$theme as { toggle?: () => void } | undefined;
    theme?.toggle?.();
}

function scrollToHeading(id: string) {
    const main = document.querySelector('main.flex-1');
    if (!main) return;

    if (!(id in headingOffsets.value)) {
        computeHeadingOffsets();
    }

    const target = headingOffsets.value[id];
    if (typeof target !== 'number') return;

    const offset = isMobile.value ? 24 : 32;
    main.scrollTo({
        top: Math.max(0, target - offset),
        behavior: 'smooth',
    });
}

function onMobileTocSelect(id: string) {
    scrollToHeading(id);
    mobileTocOpen.value = false;
}
</script>

<style scoped>
@import '~/assets/css/or3-prose.css';

.docs-shell {
    font-family: var(--font-sans);
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
}

.docs-sidebar {
    border-right: 2px solid var(--md-inverse-surface);
}

.collapsible-enter-active,
.collapsible-leave-active {
    transition: all 0.18s ease;
    overflow: hidden;
}

.collapsible-enter-from,
.collapsible-leave-to {
    opacity: 0;
    max-height: 0;
    transform: translateY(-4px);
}

.collapsible-enter-to,
.collapsible-leave-from {
    opacity: 1;
    max-height: 600px;
    transform: translateY(0);
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
