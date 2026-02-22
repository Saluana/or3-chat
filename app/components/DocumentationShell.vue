<template>
    <div
        class="docs-shell h-[100dvh] flex flex-col bg-[var(--md-surface)] overflow-hidden"
    >
        <!-- Header -->
        <header
            class="docs-header flex-shrink-0 flex flex-col gap-3 px-4 py-2 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] z-10 md:flex-row md:items-center md:justify-between md:gap-0"
        >
            <div class="flex w-full items-center gap-3 md:w-[260px]">
                <UButton
                    v-bind="sidebarToggleButtonProps"
                    :icon="useIcon('ui.menu').value"
                    class="md:hidden!"
                    :aria-controls="sidebarId"
                    :aria-expanded="sidebarOpen"
                    :aria-label="sidebarOpen ? 'Close navigation' : 'Open navigation'"
                    @click="toggleSidebar"
                />
                <NuxtLink to="/" class="flex items-center gap-2 min-w-0">
                    <img src="/butthole-logo.webp" alt="Logo" class="h-8 w-8 shrink-0" />
                    <h1 class="font-ps2 text-base text-[var(--md-primary)] truncate">
                        OR3 Docs
                    </h1>
                </NuxtLink>
                <div class="ml-auto md:hidden">
                    <UButton
                        v-bind="headerThemeButtonProps"
                        :icon="themeToggleIcon"
                        :aria-label="'Toggle theme'"
                        @click="toggleTheme"
                    />
                </div>
            </div>

            <!-- Search -->
            <div class="docs-header-search w-full md:mx-6 md:flex-1">
                <UInput
                    v-bind="searchInputProps"
                    v-model="searchQuery"
                    @keydown.meta.k.prevent="focusSearch"
                />
            </div>

            <!-- Theme Toggle -->
            <div class="hidden w-full items-center justify-end md:flex md:w-[260px]">
                <UButton
                    v-bind="headerThemeButtonProps"
                    :icon="themeToggleIcon"
                    :aria-label="'Toggle theme'"
                    @click="toggleTheme"
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
                                        class="docs-nav-category"
                                    >
                                        <div class="docs-nav-category-label sb-group-header flex items-center gap-2 mb-2 px-1">
                                            <span class="sb-group-header-label text-[var(--md-on-surface-variant)] uppercase tracking-wider">
                                                {{ category.label }}
                                            </span>
                                            <div class="flex-1 h-px bg-[var(--md-outline-variant)] opacity-40"></div>
                                        </div>
                                        <div class="space-y-px">
                                            <div
                                                v-for="group in category.groups"
                                                :key="`${category.label}-${group.label}`"
                                            >
                                                <button
                                                    v-if="group.items.length > 1"
                                                    type="button"
                                                    class="docs-nav-group-toggle w-full flex items-center justify-between px-3 h-[40px] rounded-[var(--md-border-radius)] text-left text-[var(--md-on-surface)] transition-colors hover:bg-[var(--md-primary)]/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--md-primary)]"
                                                    @click="toggleGroup(category.label, group.label)"
                                                    :aria-expanded="isGroupExpanded(category.label, group.label)"
                                                >
                                                    <span class="font-vt323 text-[18px]">{{ group.label }}</span>
                                                    <UIcon
                                                        :name="useIcon('ui.chevron.down').value"
                                                        class="transition-transform duration-200 w-4 h-4 opacity-50 shrink-0"
                                                        :class="{ 'rotate-180': isGroupExpanded(category.label, group.label) }"
                                                        aria-hidden="true"
                                                    />
                                                </button>
                                                <Transition name="collapsible">
                                                    <div
                                                        v-if="group.items.length <= 1 || isGroupExpanded(category.label, group.label)"
                                                        :class="group.items.length > 1 ? 'docs-nav-children ml-3 pl-3 border-l-2 border-[color:var(--md-outline-variant)] py-1' : ''"
                                                    >
                                                        <ul class="space-y-px">
                                                            <li v-for="item in group.items" :key="item.path">
                                                                <NuxtLink
                                                                    :to="item.path"
                                                                    class="docs-nav-link flex h-[36px] items-center px-2 rounded-[var(--md-border-radius)] text-[var(--md-on-surface-variant)] transition-colors font-vt323 text-[17px] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/8"
                                                                    active-class="docs-nav-link-active"
                                                                    @click="closeSidebar"
                                                                >
                                                                    {{ item.label }}
                                                                </NuxtLink>
                                                            </li>
                                                        </ul>
                                                    </div>
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
                class="docs-sidebar flex-shrink-0 w-[260px] bg-[var(--md-surface)] overflow-y-auto scrollbars hidden md:block"
            >
                <nav class="docs-sidebar-nav p-3 pt-4">
                    <div class="space-y-5">
                        <!-- Categories -->
                        <div
                            v-for="category in resolvedNavigation"
                            :key="category.label"
                            class="docs-nav-category"
                        >
                            <div class="docs-nav-category-label sb-group-header flex items-center gap-2 mb-2 px-1">
                                <span class="sb-group-header-label text-[var(--md-on-surface-variant)] uppercase tracking-wider">
                                    {{ category.label }}
                                </span>
                                <div class="flex-1 h-px bg-[var(--md-outline-variant)] opacity-40"></div>
                            </div>
                            <div class="space-y-1">
                        <div
                            v-for="group in category.groups"
                            :key="`${category.label}-${group.label}`"
                        >
                            <button
                                v-if="group.items.length > 1"
                                type="button"
                                class="docs-nav-group-toggle w-full flex items-center justify-between px-3 h-[40px] rounded-[var(--md-border-radius)] text-left text-[var(--md-on-surface)] transition-colors hover:bg-[var(--md-surface-hover,color-mix(in_oklab,var(--md-primary),transparent_92%))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--md-primary)]"
                                :class="{ 'bg-[var(--md-surface-active,color-mix(in_oklab,var(--md-primary),transparent_85%))] font-medium': isGroupExpanded(category.label, group.label) }"
                                @click="toggleGroup(category.label, group.label)"
                                :aria-expanded="isGroupExpanded(category.label, group.label)"
                            >
                                <span class="font-vt323 text-[18px]">{{ group.label }}</span>
                                <UIcon
                                    :name="useIcon('ui.chevron.down').value"
                                    class="transition-transform duration-200 w-4 h-4 opacity-50 shrink-0"
                                    :class="{ 'rotate-180': isGroupExpanded(category.label, group.label) }"
                                    aria-hidden="true"
                                />
                            </button>
                            <Transition name="collapsible">
                                <div
                                    v-if="group.items.length <= 1 || isGroupExpanded(category.label, group.label)"
                                    :class="group.items.length > 1 ? 'docs-nav-children ml-3 pl-3 border-l-2 border-[color:var(--md-outline-variant)] py-1' : ''"
                                >
                                    <ul class="space-y-px">
                                        <li v-for="item in group.items" :key="item.path">
                                            <NuxtLink
                                                :to="item.path"
                                                class="docs-nav-link flex h-[36px] items-center px-2 rounded-[var(--md-border-radius)] text-[var(--md-on-surface-variant)] transition-colors font-vt323 text-[17px] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/8"
                                                active-class="docs-nav-link-active"
                                            >
                                                {{ item.label }}
                                            </NuxtLink>
                                        </li>
                                    </ul>
                                </div>
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
                    class="max-w-[100dvw] sm:max-w-[700px] lg:max-w-[740px] mx-auto pt-6 pb-24 px-5 md:px-8 md:pt-8"
                >
                    <!-- Search Results -->
                    <div v-if="searchQuery && searchTrigger" class="mb-8">
                        <h2
                            class="font-ps2 text-base mb-4 text-[var(--md-on-surface)]"
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
                            class="flex items-center justify-center py-16"
                        >
                            <div
                                class="text-[var(--md-on-surface-variant)] font-vt323 text-xl tracking-widest animate-pulse"
                            >
                                Loading...
                            </div>
                        </div>

                        <!-- Content -->
                        <div v-else ref="contentRoot">
                            <!-- Mobile TOC (collapsible) -->
                            <div
                                v-if="computedShowToc && tocList.length > 0"
                                class="lg:hidden mb-6 border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface-container)]"
                            >
                                <button
                                    type="button"
                                    class="w-full flex items-center justify-between px-4 py-3 text-left font-vt323 text-[18px] text-[var(--md-on-surface)] uppercase tracking-wide transition-colors hover:bg-[var(--md-primary)]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--md-primary)]"
                                    @click="mobileTocOpen = !mobileTocOpen"
                                    :aria-expanded="mobileTocOpen"
                                >
                                    <span>On this page</span>
                                    <UIcon
                                        :name="useIcon('ui.chevron.down').value"
                                        class="transition-transform duration-200 w-4 h-4 opacity-60"
                                        :class="{ 'rotate-180': mobileTocOpen }"
                                        aria-hidden="true"
                                    />
                                </button>
                                <Transition name="collapsible">
                                    <div
                                        v-if="mobileTocOpen"
                                        class="px-4 py-3 border-t-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
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
                class="docs-toc flex-shrink-0 w-[220px] border-l-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] overflow-y-auto scrollbars hidden lg:block"
            >
                <nav class="p-4 pt-6">
                    <div class="mb-3 pb-2 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]">
                        <h3 class="font-vt323 text-[18px] text-[var(--md-on-surface-variant)] uppercase tracking-wider">
                            On this page
                        </h3>
                    </div>
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
    const { ui: _ignoredUi, ...rest } = merged;
    return {
        placeholder: 'Search docs...',
        size: 'md' as const,
        leadingIcon: useIcon('ui.search').value,
        ...rest,
        ui: {
            ...uiOverrides,
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
    computed(() => props.navigation)
);

const { pending: isLoadingContent, displayContent } = useDocumentationContent(
    computed(() => route.path),
    computed(() => props.content)
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
            const url = import.meta.server ? new URL('/_documentation/docmap.json', useRequestURL().origin).href : '/_documentation/docmap.json';
            const map = await $fetch<Docmap | null>(url);
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
    applyDocmapNavigation(docmap.value);
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

function buildTocFromDom() {
    if (!import.meta.client) return;

    const root = contentRoot.value;
    const items = root ? buildTocFromElement(root).toc : [];

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
    border-right: var(--md-border-width) solid var(--md-border-color);
}

/* Active nav link */
.docs-nav-link-active {
    background-color: color-mix(in oklab, var(--md-primary), transparent 85%);
    color: var(--md-primary);
    font-weight: 500;
}

.docs-nav-link:hover {
    background-color: color-mix(in oklab, var(--md-primary), transparent 92%);
}

/* TOC links */
.docs-toc :deep(a) {
    display: block;
    padding: 4px 8px;
    color: var(--md-on-surface-variant);
    border-radius: var(--md-border-radius);
    transition: color 0.15s, background-color 0.15s;
    font-family: var(--font-sans);
    font-size: 17px;
    line-height: 1.4;
}

.docs-toc :deep(a:hover) {
    color: var(--md-primary);
    background-color: color-mix(in oklab, var(--md-primary), transparent 93%);
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
