import { ref, shallowRef, type Ref } from 'vue';
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
    const cursor = ref<number | null>(null);

    const filterType = options.type || 'all';
    const searchQuery = options.query;

    /**
     * Fetch items older than the current cursor
     */
    async function fetchItemsBefore(timestamp: number | null, limit: number): Promise<UnifiedSidebarItem[]> {
        const ts = timestamp ?? Infinity;
        const query = searchQuery?.value?.toLowerCase() || '';
        
        let threadsBatch: Thread[] = [];
        let docsBatch: Post[] = [];

        // Fetch threads if requested
        if (filterType === 'all' || filterType === 'thread') {
            let threadCollection = db.threads
                .where('updated_at')
                .below(ts);
            
            threadsBatch = await threadCollection
                .reverse()
                .filter(t => !t.deleted && (query === '' || !!t.title?.toLowerCase().includes(query)))
                .limit(limit)
                .toArray();
        }

        // Fetch docs if requested
        if (filterType === 'all' || filterType === 'document') {
            let docCollection = db.posts
                .where('postType')
                .equals('doc');
            
            docsBatch = await docCollection
                .and(p => p.updated_at < ts && !p.deleted && (query === '' || !!p.title?.toLowerCase().includes(query)))
                .reverse()
                .limit(limit)
                .toArray();
        }

        // Merge and sort
        const unified: UnifiedSidebarItem[] = [
            ...threadsBatch.map(threadToUnified),
            ...docsBatch.map(docToUnified)
        ];

        unified.sort((a, b) => b.updatedAt - a.updatedAt);

        // Take top N
        return unified.slice(0, limit);
    }

    /**
     * Load next page of items
     */
    async function loadMore() {
        if (loading.value || !hasMore.value) return;

        loading.value = true;
        try {
            const nextBatch = await fetchItemsBefore(cursor.value, PAGE_SIZE);
            
            if (nextBatch.length < PAGE_SIZE) {
                hasMore.value = false;
            }

            if (nextBatch.length > 0) {
                items.value = [...items.value, ...nextBatch];
                const lastItem = nextBatch[nextBatch.length - 1];
                if (lastItem) cursor.value = lastItem.updatedAt;
            } else {
                hasMore.value = false;
            }
        } catch (error) {
            console.error('[usePaginatedSidebarItems] Error loading items:', error);
        } finally {
            loading.value = false;
        }
    }

    /**
     * Reset pagination state and reload from start
     */
    async function reset() {
        items.value = [];
        hasMore.value = true;
        cursor.value = null;
        await loadMore();
    }

    return {
        items,
        hasMore,
        loading,
        loadMore,
        reset
    };
}
