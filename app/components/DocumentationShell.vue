<template>
    <div
        class="docs-shell h-[100dvh] flex flex-col bg-[var(--md-surface)] overflow-hidden"
    >
        <!-- Header -->
        <header
            class="flex-shrink-0 flex flex-col gap-3 px-4 py-3 border-b-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface)] z-10 md:flex-row md:items-center md:justify-between md:gap-0"
        >
            <div class="flex w-full items-center gap-3 md:w-[250px]">
                <UButton
                    v-if="isMobile"
                    icon="i-heroicons-bars-3"
                    size="sm"
                    variant="basic"
                    square
                    class="md:hidden"
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
                        variant="basic"
                        size="sm"
                        square
                        icon="i-heroicons-sun"
                        :aria-label="'Toggle theme'"
                        @click="toggleTheme"
                    />
                </div>
            </div>

            <!-- Search -->
            <div class="w-full md:mx-4 md:flex-1 md:max-w-md">
                <UInput
                    class="w-full"
                    v-model="searchQuery"
                    placeholder="Search docs..."
                    size="md"
                    :leading-icon="
                        isSearching
                            ? 'i-heroicons-arrow-path'
                            : 'i-heroicons-magnifying-glass'
                    "
                    @keydown.meta.k.prevent="focusSearch"
                />
            </div>

            <!-- Theme Toggle -->
            <div
                class="hidden w-full items-center justify-end md:flex md:w-[250px]"
            >
                <UButton
                    variant="basic"
                    size="sm"
                    square
                    icon="i-heroicons-sun"
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
                    class="fixed inset-0 z-[60] flex"
                    role="dialog"
                    aria-modal="true"
                    :aria-labelledby="sidebarLabelId"
                >
                    <div
                        class="absolute inset-0 bg-black/50"
                        aria-hidden="true"
                        @click="() => closeSidebar()"
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
                            class="relative z-[61] h-full w-[min(80vw,320px)] max-w-full transform bg-[var(--md-surface)] border-r-2 border-[var(--md-inverse-surface)] shadow-lg overflow-y-auto scrollbars"
                            @keydown="onSidebarKeydown"
                        >
                            <h2 :id="sidebarLabelId" class="sr-only">
                                Documentation navigation
                            </h2>
                            <nav class="p-4">
                                <div class="space-y-6">
                                    <div
                                        v-for="category in resolvedNavigation"
                                        :key="category.label"
                                        class="space-y-3"
                                    >
                                        <h3
                                            class="font-ps2 text-sm text-[var(--md-on-surface-variant)] border-b-4 border-b-primary pb-2 px-2 uppercase tracking-wide"
                                        >
                                            {{ category.label }}
                                        </h3>
                                        <div class="space-y-2">
                                            <div
                                                v-for="group in category.groups"
                                                :key="`${category.label}-${group.label}`"
                                                class="rounded-md bg-[var(--md-surface)]/40 border border-[var(--md-inverse-surface)]/40"
                                            >
                                                <button
                                                    type="button"
                                                    class="w-full flex items-center justify-between px-3 py-2 text-left font-ps2 text-xs text-[var(--md-on-surface)] uppercase tracking-wide transition-colors hover:bg-[var(--md-primary)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-[var(--md-surface)]"
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
                                                    <span
                                                        class="i-heroicons-chevron-down-20-solid transition-transform duration-200"
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
                                                                class="flex h-[40px] items-center px-3 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 transition-colors"
                                                                active-class=" dark:text-white text-black  bg-primary/20 hover:bg-primary/20"
                                                                @click="
                                                                    () =>
                                                                        closeSidebar()
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
        <div class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Sidebar -->
            <aside
                v-if="!isMobile"
                :id="sidebarId"
                class="docs-sidebar flex-shrink-0 w-64 bg-[var(--md-surface)] overflow-y-auto scrollbars"
            >
                <nav class="p-4">
                    <div class="space-y-6">
                        <!-- Categories -->
                        <div
                            v-for="category in resolvedNavigation"
                            :key="category.label"
                            class="space-y-3"
                        >
                            <h3
                                class="font-ps2 text-sm text-[var(--md-on-surface-variant)] border-b-4 border-b-primary pb-2 px-2 uppercase tracking-wide"
                            >
                                {{ category.label }}
                            </h3>
                            <div class="space-y-2">
                                <div
                                    v-for="group in category.groups"
                                    :key="`${category.label}-${group.label}`"
                                    class="rounded-md bg-[var(--md-surface)]/40 border border-[var(--md-inverse-surface)]/40"
                                >
                                    <button
                                        type="button"
                                        class="w-full flex items-center justify-between px-3 py-2 text-left font-ps2 text-xs text-[var(--md-on-surface)] uppercase tracking-wide transition-colors hover:bg-[var(--md-primary)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-[var(--md-surface)]"
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
                                        <span
                                            class="i-heroicons-chevron-down-20-solid transition-transform duration-200"
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
                                                    class="flex h-[40px] items-center px-3 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 transition-colors"
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
            <main class="flex-1 min-w-0 overflow-y-auto scrollbars">
                <div class="max-w-[820px] mx-auto p-8">
                    <!-- Search Results -->
                    <div
                        v-if="searchQuery && searchResults.length > 0"
                        class="mb-8"
                    >
                        <h2
                            class="font-ps2 text-xl mb-4 text-[var(--md-on-surface)]"
                        >
                            Search Results
                        </h2>
                        <div class="space-y-2">
                            <UCard
                                v-for="result in searchResults"
                                :key="result.id"
                                class="cursor-pointer hover:border-[var(--md-primary)] transition-colors"
                                @click="navigateToResult(result)"
                            >
                                <h3
                                    class="font-bold text-[var(--md-on-surface)]"
                                >
                                    {{ result.title }}
                                </h3>
                                <p
                                    class="text-sm text-[var(--md-on-surface-variant)] mt-1"
                                >
                                    {{ result.excerpt }}
                                </p>
                            </UCard>
                        </div>
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
                        <StreamMarkdown
                            v-else
                            :content="displayContent"
                            class="prose prose-pre:font-mono prose-retro max-w-none"
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
            </main>

            <!-- Table of Contents (Right Sidebar) -->
            <aside
                v-if="showToc && toc && toc.length > 0"
                class="flex-shrink-0 w-64 border-l-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface)] overflow-y-auto scrollbars hidden xl:block"
            >
                <nav class="p-4 sticky top-0">
                    <h3
                        class="font-ps2 text-sm text-[var(--md-on-surface-variant)] mb-4"
                    >
                        On this page
                    </h3>
                    <ul class="space-y-2 text-sm">
                        <li v-for="heading in toc" :key="heading.id">
                            <a
                                :href="`#${heading.id}`"
                                class="block py-1 px-2 text-[var(--md-on-surface)] hover:text-[var(--md-primary)] transition-colors rounded-[3px] hover:bg-[var(--md-primary)]/5"
                                :class="{
                                    'pl-4': heading.level === 3,
                                    'pl-6': heading.level === 4,
                                }"
                            >
                                {{ heading.text }}
                            </a>
                        </li>
                    </ul>
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
    onBeforeUnmount,
} from 'vue';
import type { AnyOrama } from '@orama/orama';
import { StreamMarkdown } from 'streamdown-vue';
import { useResponsiveState } from '~/composables/core/useResponsiveState';

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

interface SearchResult {
    id: string;
    title: string;
    excerpt: string;
    path: string;
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

const props = defineProps<{
    navigation?: NavCategory[];
    showToc?: boolean;
    toc?: TocItem[];
    content?: string;
}>();

const searchQuery = ref('');
const isSearching = ref(false);
const searchResults = ref<SearchResult[]>([]);
const searchIndex = ref<AnyOrama | null>(null);
const docmap = ref<Docmap | null>(null);
const currentContent = ref('');
const isLoadingContent = ref(false);

// LRU Cache for markdown files - limit to 20 most recent files
const MAX_CACHE_SIZE = 20;
const contentCache = new Map<string, string>();
const cacheAccessOrder: string[] = []; // Track access order for LRU

const route = useRoute();

const { isMobile } = useResponsiveState();
const sidebarOpen = ref(false);
const mobileSidebarRef = ref<HTMLElement | null>(null);
const sidebarId = 'docs-sidebar';
const sidebarLabelId = 'docs-sidebar-heading';

let lastFocusedElement: HTMLElement | null = null;
let previousBodyOverflow: string | null = null;
let shouldRestoreFocus = true;

// Internal navigation state (shallow to avoid deep watchers)
const internalNavigation = shallowRef<NavCategory[]>([]);
// Resolved navigation prefers prop override but stays stable otherwise
const resolvedNavigation = computed<NavCategory[]>(() =>
    props.navigation ? props.navigation : internalNavigation.value
);

const expandedGroups = ref<Set<string>>(new Set());

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

function closeSidebar(options: { restoreFocus?: boolean } = {}) {
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

function lockBodyScroll() {
    if (!import.meta.client) return;
    const body = document.body;
    if (previousBodyOverflow === null) {
        previousBodyOverflow = body.style.overflow || '';
    }
    body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
    if (!import.meta.client) return;
    const body = document.body;
    if (previousBodyOverflow !== null) {
        body.style.overflow = previousBodyOverflow;
        previousBodyOverflow = null;
    }
}

// Load docmap on mount
onMounted(async () => {
    try {
        const response = await fetch('/_documentation/docmap.json');
        docmap.value = await response.json();

        // Build navigation from docmap
        if (docmap.value) {
            applyDocmapNavigation(docmap.value);
        }

        // Initialize lightweight search index (metadata only)
        if (isDocRoute.value) {
            await initializeSearch();
        }
    } catch (error) {
        console.error('[docs] Failed to load docmap:', error);
    }

    // Load content based on route
    await loadContentFromRoute();
});

watch(
    () => route.path,
    (path) => {
        expandGroupsForPath(path);
    },
    { immediate: true }
);

watch(
    () => resolvedNavigation.value,
    () => {
        expandGroupsForPath(route.path);
    },
    { immediate: true }
);

watch(isMobile, (mobile) => {
    if (!mobile && sidebarOpen.value) {
        closeSidebar({ restoreFocus: false });
    }
});

watch(
    () => route.path,
    () => {
        if (isMobile.value && sidebarOpen.value) {
            closeSidebar({ restoreFocus: false });
        }
    }
);

watch(sidebarOpen, async (open) => {
    if (!import.meta.client) return;

    if (open) {
        lastFocusedElement = document.activeElement as HTMLElement | null;
        lockBodyScroll();
        await nextTick();
        focusFirstSidebarItem();
    } else {
        unlockBodyScroll();
        await nextTick();
        if (shouldRestoreFocus && lastFocusedElement) {
            lastFocusedElement.focus({ preventScroll: true });
        }
        lastFocusedElement = null;
        shouldRestoreFocus = true;
    }
});

// Watch route changes to load new content (immediate to prevent flicker)
watch(
    () => route.path,
    async (newPath, oldPath) => {
        // Only reload if the path actually changed
        if (newPath !== oldPath) {
            await loadContentFromRoute();
        }
    },
    { immediate: false }
);

async function loadContentFromRoute() {
    const path = route.path;

    // If on base /documentation route, show welcome page
    if (path === '/documentation' || path === '/documentation/') {
        isLoadingContent.value = false;
        currentContent.value = `# OR3 Documentation

Welcome to the OR3 documentation. Select a topic from the sidebar to get started.

## Available Sections

${
    docmap.value?.sections
        .map(
            (section) =>
                `- **${section.title}**: ${section.files.length} documents`
        )
        .join('\n') || ''
}

onBeforeUnmount(() => {
    if (sidebarOpen.value) {
        unlockBodyScroll();
    }
});
`;
        return;
    }

    // Extract the doc path (e.g., /documentation/composables/useChat -> /composables/useChat)
    const docPath = path.replace('/documentation', '');

    // Find the file in docmap
    if (docmap.value) {
        for (const section of docmap.value.sections) {
            const file = section.files.find((f) => f.path === docPath);
            if (file) {
                // Don't show loading if content is cached
                const cacheKey = `${section.path}/${file.name}`;
                if (!contentCache.has(cacheKey)) {
                    isLoadingContent.value = true;
                }

                try {
                    await loadMarkdownFile(file.name, section.path);
                } finally {
                    isLoadingContent.value = false;
                }
                return;
            }
        }

        // If not found, show 404
        isLoadingContent.value = false;
        currentContent.value = `# Page Not Found

The documentation page you're looking for doesn't exist.

[← Back to Documentation](/documentation)
`;
    } else {
        // Docmap not loaded yet
        isLoadingContent.value = true;
        currentContent.value = `# Loading...

Please wait while the documentation loads.
`;
    }
}

async function loadMarkdownFile(filename: string, sectionPath: string) {
    const cacheKey = `${sectionPath}/${filename}`;

    // Check cache first for instant navigation
    if (contentCache.has(cacheKey)) {
        // Update LRU order
        updateCacheAccess(cacheKey);
        currentContent.value = contentCache.get(cacheKey)!;
        return;
    }

    try {
        // Fetch the markdown file from public/_documentation/{section}/{filename}
        const response = await fetch(
            `/_documentation${sectionPath}/${filename}`
        );
        if (!response.ok) throw new Error('File not found');
        const content = await response.text();

        // Cache the content with LRU eviction
        addToCache(cacheKey, content);
        currentContent.value = content;
    } catch (error) {
        console.error(`[docs] Failed to load ${filename}:`, error);
        const errorContent = `# Error Loading Document

Failed to load the requested documentation.

[← Back to Documentation](/documentation)
`;
        currentContent.value = errorContent;
        // Don't cache error content
    }
}

// LRU Cache Management
function addToCache(key: string, content: string) {
    // If already exists, remove old entry to update position
    if (contentCache.has(key)) {
        const index = cacheAccessOrder.indexOf(key);
        if (index > -1) {
            cacheAccessOrder.splice(index, 1);
        }
    }

    // Add to cache
    contentCache.set(key, content);
    cacheAccessOrder.push(key);

    // Evict oldest if over limit
    while (cacheAccessOrder.length > MAX_CACHE_SIZE) {
        const oldestKey = cacheAccessOrder.shift()!;
        contentCache.delete(oldestKey);
    }
}

function updateCacheAccess(key: string) {
    // Move to end (most recently used)
    const index = cacheAccessOrder.indexOf(key);
    if (index > -1) {
        cacheAccessOrder.splice(index, 1);
        cacheAccessOrder.push(key);
    }
}

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
}

// Use provided content or loaded content
const displayContent = computed(() => props.content || currentContent.value);

// Initialize search index
const isDocRoute = computed(() => route.path.startsWith('/documentation'));

watch(isDocRoute, async (isDocs) => {
    if (isDocs && !searchIndex.value && docmap.value) {
        await initializeSearch();
    }
});

async function initializeSearch() {
    try {
        const { create, insert } = await import('@orama/orama');

        searchIndex.value = create({
            schema: {
                title: 'string',
                path: 'string',
                category: 'string',
                description: 'string',
            },
        });

        // Index only metadata from docmap (no file content loading!)
        if (docmap.value) {
            for (const section of docmap.value.sections) {
                for (const file of section.files) {
                    await insert(searchIndex.value, {
                        title: file.name.replace('.md', ''),
                        path: `/documentation${file.path}`,
                        category: section.title,
                        description: file.category || '', // Use category as description
                    });
                }
            }
            console.debug('[docs] Search index initialized with metadata only');
        }
    } catch (error) {
        console.error('[docs] Failed to initialize search:', error);
    }
}

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, async (query) => {
    if (searchTimeout) clearTimeout(searchTimeout);

    if (!query || query.length < 2) {
        searchResults.value = [];
        return;
    }

    searchTimeout = setTimeout(async () => {
        await performSearch(query);
    }, 120);
});

async function performSearch(query: string) {
    if (!searchIndex.value) return;

    isSearching.value = true;
    try {
        const { search } = await import('@orama/orama');
        const results = await search(searchIndex.value, {
            term: query,
            limit: 10,
        });

        searchResults.value = results.hits.map((hit: any) => ({
            id: hit.id,
            title: hit.document.title,
            excerpt: `${hit.document.category} - ${hit.document.description}`,
            path: hit.document.path,
        }));
    } catch (error) {
        console.error('[docs] Search failed:', error);
        searchResults.value = [];
    } finally {
        isSearching.value = false;
    }
}

async function navigateToResult(result: SearchResult) {
    searchQuery.value = '';
    searchResults.value = [];
    await navigateTo(result.path);
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
</script>

<style scoped>
@import '~/assets/css/prose-retro.css';

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
