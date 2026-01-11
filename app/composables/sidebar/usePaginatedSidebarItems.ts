import { ref, shallowRef, type Ref, onMounted, onUnmounted } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { db, type Thread, type Post } from '~/db';
import type { UnifiedSidebarItem } from '~/types/sidebar';

const PAGE_SIZE = 50;

/**
 * Transforms a database thread to a unified sidebar item
 */
export function threadToUnified(t: Thread): UnifiedSidebarItem {
    return {
        id: t.id,
        type: 'thread',
        title: t.title || 'Untitled Chat',
        updatedAt: t.last_message_at ?? t.updated_at,
        forked: t.forked,
    };
}

/**
 * Transforms a database post (document) to a unified sidebar item
 */
export function docToUnified(d: Post): UnifiedSidebarItem {
    return {
        id: d.id,
        type: 'document',
        title: d.title || 'Untitled Document',
        updatedAt: d.updated_at,
        postType: d.postType,
    };
}

/**
 * Composable for managing paginated loading of sidebar items (threads & documents mixed)
 */
export function usePaginatedSidebarItems(options: { 
    type?: 'all' | 'thread' | 'document', 
    query?: Ref<string> 
} = {}) {
    const items = shallowRef<UnifiedSidebarItem[]>([]);
    const hasMore = ref(true);
    const loading = ref(false);
    const targetCount = ref(PAGE_SIZE);
    let subscription: Subscription | null = null;

    const filterType = options.type || 'all';
    const searchQuery = options.query;

    /**
     * Fetch the latest items up to a target count
     */
    async function fetchItems(
        limit: number
    ): Promise<{ items: UnifiedSidebarItem[]; hasMore: boolean }> {
        const query = searchQuery?.value?.toLowerCase() || '';
        const batchLimit = limit + 1;
        
        let threadsBatch: Thread[] = [];
        let docsBatch: Post[] = [];

        // Fetch threads if requested
        if (filterType === 'all' || filterType === 'thread') {
            threadsBatch = await db.threads
                .orderBy('updated_at')
                .reverse()
                .filter(
                    (t) =>
                        !t.deleted &&
                        (query === '' ||
                            !!t.title?.toLowerCase().includes(query))
                )
                .limit(batchLimit)
                .toArray();
        }

        // Fetch docs if requested
        if (filterType === 'all' || filterType === 'document') {
            docsBatch = await db.posts
                .orderBy('updated_at')
                .reverse()
                .filter(
                    (p) =>
                        p.postType === 'doc' &&
                        !p.deleted &&
                        (query === '' ||
                            !!p.title?.toLowerCase().includes(query))
                )
                .limit(batchLimit)
                .toArray();
        }

        // Merge and sort
        const unified: UnifiedSidebarItem[] = [
            ...threadsBatch.map(threadToUnified),
            ...docsBatch.map(docToUnified)
        ];

        unified.sort((a, b) => b.updatedAt - a.updatedAt);

        const hasMore = unified.length > limit;

        // Take top N
        return { items: unified.slice(0, limit), hasMore };
    }

    function startSubscription() {
        const shouldShowLoading = items.value.length === 0;
        if (shouldShowLoading) loading.value = true;
        subscription?.unsubscribe();
        subscription = liveQuery(() => fetchItems(targetCount.value)).subscribe({
            next: (result) => {
                items.value = result.items;
                hasMore.value = result.hasMore;
                loading.value = false;
            },
            error: (error) => {
                console.error(
                    '[usePaginatedSidebarItems] liveQuery error:',
                    error
                );
                loading.value = false;
            },
        });
    }

    /**
     * Load next page of items
     */
    async function loadMore() {
        if (loading.value || !hasMore.value) return;
        targetCount.value += PAGE_SIZE;
        startSubscription();
    }

    /**
     * Reset pagination state and reload from start
     */
    async function reset() {
        hasMore.value = true;
        targetCount.value = PAGE_SIZE;
        startSubscription();
    }

    onMounted(() => {
        startSubscription();
    });

    onUnmounted(() => {
        subscription?.unsubscribe();
    });

    return {
        items,
        hasMore,
        loading,
        loadMore,
        reset
    };
}
