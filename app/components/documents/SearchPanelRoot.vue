<template>
    <div class="search-results document-search-results">
        <!-- Search Results -->
        <div
            v-if="searchQuery && searchResults.length > 0"
            class="space-y-2 document-search-results-list"
        >
            <UCard
                v-for="result in searchResults"
                :key="result.id"
                v-bind="searchResultCardProps"
                @click="handleNavigate(result)"
            >
                <div
                    v-if="result.category"
                    class="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--md-primary)] mb-1"
                >
                    {{ result.category }}
                </div>
                <h3
                    class="font-semibold text-[14.5px] leading-snug text-[var(--md-on-surface)]"
                >
                    {{ result.title }}
                </h3>
                <p
                    v-if="result.excerpt"
                    class="text-[13px] leading-relaxed text-[var(--md-on-surface-variant)] mt-1 line-clamp-2"
                >
                    {{ result.excerpt }}
                </p>
            </UCard>
        </div>
        <div
            v-else-if="searchQuery && !searchIndex"
            class="text-sm text-[var(--md-on-surface-variant)] p-4 text-center document-search-loading-message"
        >
            Indexing docs&hellip;
        </div>
        <div
            v-else-if="searchQuery && !isSearching"
            class="text-sm text-[var(--md-on-surface-variant)] p-4 text-center document-search-empty-message"
        >
            No results found
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { useThemeOverrides } from '~/composables/useThemeResolver';

interface Props {
    docmap: any;
    searchQuery?: string;
}

interface SearchResult {
    id: string;
    title: string;
    category: string;
    excerpt: string;
    path: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
    search: [query: string];
    navigate: [path: string];
}>();

const searchQuery = ref(props.searchQuery || '');
const isSearching = ref(false);
const searchResults = ref<SearchResult[]>([]);
const searchIndex = ref<any | null>(null);

// Theme integration for search result cards
const searchResultCardProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'card',
        context: 'document',
        identifier: 'document.search-result',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
    const overrideClass = (overridesValue.class as string) || '';
    const { class: _omit, ...restOverrides } = overridesValue;
    return {
        class: [
            'document-search-result-card',
            'cursor-pointer hover:border-[var(--md-primary)] transition-colors',
            overrideClass,
        ]
            .filter(Boolean)
            .join(' '),
        ...restOverrides,
    };
});

// Initialize search index on mount
onMounted(async () => {
    await initializeSearch();
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

        // Index metadata from docmap
        if (props.docmap) {
            for (const section of props.docmap.sections) {
                for (const file of section.files) {
                    await insert(searchIndex.value, {
                        title: file.name.replace('.md', ''),
                        path: `/documentation${file.path}`,
                        category: section.title,
                        description: (file.summary || file.category || '').replace(/`/g, ''),
                    });
                }
            }
        }

        // Run any query that arrived while the index was still building
        const pendingQuery = props.searchQuery || searchQuery.value;
        if (pendingQuery && pendingQuery.length >= 2) {
            await performSearch(pendingQuery);
        }
    } catch (error) {
        console.error('[SearchPanelRoot] Failed to initialize:', error);
    }
}

// Debounced search
watchDebounced(
    () => props.searchQuery,
    async (query) => {
        searchQuery.value = query || '';

        if (!query || query.length < 2) {
            searchResults.value = [];
            return;
        }

        await performSearch(query);
    },
    { debounce: 120 }
);

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
            category: hit.document.category || '',
            excerpt: hit.document.description || '',
            path: hit.document.path,
        }));

        emit('search', query);
    } catch (error) {
        console.error('[SearchPanelRoot] Search failed:', error);
        searchResults.value = [];
    } finally {
        isSearching.value = false;
    }
}

function handleNavigate(result: SearchResult) {
    emit('navigate', result.path);
}

// Cleanup timeout on unmount
onBeforeUnmount(() => {
    // No manual timeout cleanup needed
});
</script>
