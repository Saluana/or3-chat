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
                <h3 class="font-bold text-[14px] text-[var(--md-on-surface)]">
                    {{ result.title }}
                </h3>
                <p class="text-sm text-[var(--md-on-surface-variant)] mt-1">
                    {{ result.excerpt }}
                </p>
            </UCard>
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
                        description: file.category || '',
                    });
                }
            }
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
            excerpt: `${hit.document.category} - ${hit.document.description}`,
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
