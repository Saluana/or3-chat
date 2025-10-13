<template>
    <div
        class="docs-shell h-[100dvh] flex flex-col bg-[var(--md-surface)] overflow-hidden"
    >
        <!-- Header -->
        <header
            class="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface)] z-10"
        >
            <div class="flex items-center gap-4">
                <NuxtLink to="/" class="flex items-center gap-2">
                    <img src="/butthole-logo.webp" alt="Logo" class="h-8 w-8" />
                    <h1 class="font-ps2 text-lg text-[var(--md-primary)]">
                        OR3 Docs
                    </h1>
                </NuxtLink>
            </div>

            <!-- Search -->
            <div class="flex-1 max-w-md mx-4">
                <UInput
                    v-model="searchQuery"
                    placeholder="Search docs... ⌘K"
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
            <UButton
                variant="basic"
                size="sm"
                square
                icon="i-heroicons-sun"
                @click="toggleTheme"
            />
        </header>

        <!-- Main Layout -->
        <div class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Sidebar -->
            <aside
                class="docs-sidebar flex-shrink-0 w-64 bg-[var(--md-surface)] overflow-y-auto scrollbars"
            >
                <nav class="p-4">
                    <div class="space-y-6">
                        <!-- Categories -->
                        <div
                            v-for="category in resolvedNavigation"
                            :key="category.label"
                            class="space-y-4"
                        >
                            <h3
                                class="font-ps2 text-sm text-[var(--md-on-surface-variant)] border-b-4 border-b-primary pb-2 w-fit px-2 uppercase tracking-wide"
                            >
                                {{ category.label }}
                            </h3>
                            <div class="space-y-3">
                                <div
                                    v-for="group in category.groups"
                                    :key="`${category.label}-${group.label}`"
                                    class="space-y-2"
                                >
                                    <h4
                                        class="font-ps2 text-xs text-[var(--md-on-surface)] px-3"
                                    >
                                        {{ group.label }}
                                    </h4>
                                    <ul class="space-y-1">
                                        <li
                                            v-for="item in group.items"
                                            :key="item.path"
                                        >
                                            <NuxtLink
                                                :to="item.path"
                                                class="flex h-[40px] items-center px-3 rounded-[3px] text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 transition-colors"
                                                active-class="border-2 border-[var(--md-inverse-surface)] dark:text-white text-black retro-shadow bg-primary/20"
                                            >
                                                {{ item.label }}
                                            </NuxtLink>
                                        </li>
                                    </ul>
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
                            class="prose prose-retro max-w-none"
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
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, shallowRef } from 'vue';
import type { AnyOrama } from '@orama/orama';
import { StreamMarkdown } from 'streamdown-vue';

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
const contentCache = new Map<string, string>(); // Cache loaded markdown files
const route = useRoute();

// Internal navigation state (shallow to avoid deep watchers)
const internalNavigation = shallowRef<NavCategory[]>([]);
// Resolved navigation prefers prop override but stays stable otherwise
const resolvedNavigation = computed<NavCategory[]>(() =>
    props.navigation ? props.navigation : internalNavigation.value
);

// Load docmap on mount
onMounted(async () => {
    try {
        const response = await fetch('/_documentation/docmap.json');
        docmap.value = await response.json();

        // Pre-fetch all markdown files in the background for instant navigation
        if (docmap.value) {
            applyDocmapNavigation(docmap.value);
            prefetchAllDocs();
        }

        // Initialize search after docmap is loaded
        if (isDocRoute.value) {
            await initializeSearch();
        }
    } catch (error) {
        console.error('[docs] Failed to load docmap:', error);
    }

    // Load content based on route
    await loadContentFromRoute();
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

        // Cache the content for instant future access
        contentCache.set(cacheKey, content);
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

// Pre-fetch all documentation files in the background
async function prefetchAllDocs() {
    if (!docmap.value) return;

    // Use setTimeout to avoid blocking initial render
    setTimeout(async () => {
        for (const section of docmap.value!.sections) {
            for (const file of section.files) {
                const cacheKey = `${section.path}/${file.name}`;

                // Skip if already cached
                if (contentCache.has(cacheKey)) continue;

                try {
                    const response = await fetch(
                        `/_documentation${section.path}/${file.name}`
                    );
                    if (response.ok) {
                        const content = await response.text();
                        contentCache.set(cacheKey, content);
                    }
                } catch (error) {
                    // Silently fail for prefetch
                    console.debug(`[docs] Prefetch failed for ${file.name}`);
                }

                // Add small delay between fetches to avoid overloading
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        console.debug('[docs] All documentation prefetched');
    }, 100);
}

function applyDocmapNavigation(map: Docmap) {
    if (props.navigation) return; // respect external navigation overrides
    if (internalNavigation.value.length) return; // already built

    const sortedSections = [...map.sections].sort((a, b) =>
        a.title.localeCompare(b.title)
    );

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
                content: 'string',
                path: 'string',
                category: 'string',
            },
        });

        // Index all documentation from docmap
        if (docmap.value) {
            for (const section of docmap.value.sections) {
                for (const file of section.files) {
                    try {
                        const response = await fetch(
                            `/_documentation${section.path}/${file.name}`
                        );
                        const content = await response.text();

                        await insert(searchIndex.value, {
                            title: file.name.replace('.md', ''),
                            content: content.substring(0, 5000), // Index first 5000 chars
                            path: `/documentation${file.path}`,
                            category: section.title,
                        });
                    } catch (error) {
                        console.warn(
                            `[docs] Failed to index ${file.name}:`,
                            error
                        );
                    }
                }
            }
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
            excerpt: hit.document.content.substring(0, 150) + '...',
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

.prose-retro {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
        Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue',
        sans-serif;
    font-size: 16px;
    color: var(--md-on-surface);
}

.prose-retro :deep(h1),
.prose-retro :deep(h2),
.prose-retro :deep(h3),
.prose-retro :deep(h4) {
    font-family: system-ui !important;
    color: var(--md-primary);
    margin-top: 2rem;
    margin-bottom: 1rem;
}

.prose-retro :deep(h1) {
    font-size: 2rem;
    border-bottom: 2px solid var(--md-inverse-surface);
    padding-bottom: 0.5rem;
}

.prose-retro :deep(h2) {
    font-size: 1.5rem;
}

.prose-retro :deep(h3) {
    font-size: 1.25rem;
}

.prose-retro :deep(a) {
    color: var(--md-primary);
    text-decoration: underline;
}

.prose-retro :deep(a:hover) {
    color: var(--md-primary-variant);
}

.prose-retro :deep(code) {
    background: var(--md-surface-variant);
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    border: 1px solid var(--md-inverse-surface);
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
}

.prose-retro :deep(pre) {
    background: var(--md-surface-variant);
    padding: 1rem;
    border-radius: 3px;
    border: 2px solid var(--md-inverse-surface);
    overflow-x: auto;
    margin: 1rem 0;
}

.prose-retro :deep(pre code) {
    background: transparent;
    padding: 0;
    border: none;
    font-size: 0.875rem;
}

/* Streamdown code blocks */
.prose-retro :deep([data-streamdown='code-block']) {
    margin: 1rem 0;
    border: 2px solid var(--md-inverse-surface);
    border-radius: 3px;
    overflow: hidden;
    background: var(--md-surface-variant);
}

.prose-retro :deep([data-streamdown='code-block-header']) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: var(--md-surface);
    border-bottom: 2px solid var(--md-inverse-surface);
    font-family: 'Press Start 2P', monospace;
    font-size: 0.625rem;
}

.prose-retro :deep([data-streamdown='code-lang']) {
    text-transform: uppercase;
    color: var(--md-primary);
    letter-spacing: 0.5px;
}

.prose-retro :deep([data-streamdown='code-body']) {
    padding: 1rem;
    overflow-x: auto;
}

.prose-retro :deep([data-streamdown='code-body'] pre) {
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
}

.prose-retro :deep([data-streamdown='copy-button']) {
    padding: 0.25rem 0.5rem;
    background: var(--md-primary);
    color: white;
    border: 1px solid var(--md-inverse-surface);
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.75rem;
    transition: background 0.2s;
}

.prose-retro :deep([data-streamdown='copy-button']:hover) {
    background: var(--md-primary-variant);
}

.prose-retro :deep([data-streamdown='table-wrapper']) {
    overflow-x: auto;
    margin: 1rem 0;
    border: 2px solid var(--md-inverse-surface);
    border-radius: 3px;
}

.prose-retro :deep(blockquote) {
    border-left: 4px solid var(--md-primary);
    padding-left: 1rem;
    margin: 1rem 0;
    font-style: italic;
}

.prose-retro :deep(ul),
.prose-retro :deep(ol) {
    margin: 1rem 0;
    padding-left: 2rem;
}

.prose-retro :deep(li) {
    margin: 0.5rem 0;
}

.prose-retro :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
}

.prose-retro :deep(th),
.prose-retro :deep(td) {
    border: 2px solid var(--md-inverse-surface);
    padding: 0.5rem;
    text-align: left;
}

.prose-retro :deep(th) {
    background: var(--md-surface-variant);
    font-weight: bold;
}
</style>
