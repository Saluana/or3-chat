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
                    <div class="space-y-2">
                        <!-- Categories -->
                        <div
                            v-for="category in navigation"
                            :key="category.label"
                            class="mb-6"
                        >
                            <h3
                                class="font-ps2 text-sm text-[var(--md-on-surface-variant)] mb-2 px-2"
                            >
                                {{ category.label }}
                            </h3>
                            <ul class="space-y-1">
                                <li
                                    v-for="item in category.items"
                                    :key="item.path"
                                >
                                    <NuxtLink
                                        :to="item.path"
                                        class="block px-3 py-2 rounded-[3px] text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 transition-colors"
                                        active-class="bg-[var(--md-primary)] text-white retro-shadow"
                                    >
                                        {{ item.label }}
                                    </NuxtLink>
                                </li>
                            </ul>
                        </div>
                    </div>
                </nav>
            </aside>

            <!-- Content Area -->
            <main class="flex-1 min-w-0 overflow-y-auto scrollbars">
                <div class="max-w-4xl mx-auto p-8">
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
                        <StreamMarkdown
                            :content="content"
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
import { ref, computed, watch, onMounted } from 'vue';
import type { AnyOrama } from '@orama/orama';
import { StreamMarkdown } from 'streamdown-vue';

interface NavItem {
    label: string;
    path: string;
}

interface NavCategory {
    label: string;
    items: NavItem[];
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

// Default navigation if none provided
const navigation = computed(
    () =>
        props.navigation || [
            {
                label: 'Getting Started',
                items: [
                    { label: 'Introduction', path: '/documentation' },
                    {
                        label: 'Installation',
                        path: '/documentation/installation',
                    },
                    {
                        label: 'Quick Start',
                        path: '/documentation/quick-start',
                    },
                ],
            },
            {
                label: 'Core Concepts',
                items: [
                    {
                        label: 'Architecture',
                        path: '/documentation/architecture',
                    },
                    { label: 'Hooks System', path: '/documentation/hooks' },
                    { label: 'State Management', path: '/documentation/state' },
                ],
            },
        ]
);

// Initialize search index only on /documentation route
const route = useRoute();
const isDocRoute = computed(() => route.path.startsWith('/documentation'));

watch(isDocRoute, async (isDocs) => {
    if (isDocs && !searchIndex.value) {
        await initializeSearch();
    }
});

onMounted(async () => {
    if (isDocRoute.value) {
        await initializeSearch();
    }
});

async function initializeSearch() {
    try {
        const { create, insert } = await import('@orama/orama');

        searchIndex.value = await create({
            schema: {
                title: 'string',
                content: 'string',
                path: 'string',
                category: 'string',
            },
        });

        // TODO: Insert actual documentation content
        // This would typically come from your markdown files
        const docs = [
            {
                title: 'Introduction',
                content: 'Welcome to OR3 documentation',
                path: '/documentation',
                category: 'Getting Started',
            },
        ];

        for (const doc of docs) {
            await insert(searchIndex.value, doc);
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

function navigateToResult(result: SearchResult) {
    navigateTo(result.path);
    searchQuery.value = '';
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
    color: var(--md-on-surface);
}

.prose-retro :deep(h1),
.prose-retro :deep(h2),
.prose-retro :deep(h3),
.prose-retro :deep(h4) {
    font-family: var(--font-heading);
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
