/**
 * @module app/composables/sidebar/usePaginatedSidebarItems
 *
 * Purpose:
 * Provides a paginated, live-updating list of sidebar items from IndexedDB.
 *
 * Responsibilities:
 * - Queries threads and documents with filtering and pagination
 * - Keeps results updated via Dexie live queries
 *
 * Non-responsibilities:
 * - Does not implement rendering or infinite scroll UI
 * - Does not perform server-side pagination
 */
import { ref, shallowRef, type Ref, onMounted, onUnmounted } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import type { Thread, Post } from '~/db';
import { getDb } from '~/db/client';
import type { UnifiedSidebarItem } from '~/types/sidebar';

/**
 * `PAGE_SIZE`
 *
 * Purpose:
 * Defines the default page size for sidebar item pagination.
 *
 * Constraints:
 * - Used as the base increment for `loadMore`
 */
const PAGE_SIZE = 50;

/**
 * `threadToUnified`
 *
 * Purpose:
 * Converts a thread record into the unified sidebar item shape.
 *
 * Behavior:
 * Applies title fallbacks and uses the latest available timestamp.
 *
 * Constraints:
 * - Assumes thread timestamps are numeric and comparable
 *
 * Non-Goals:
 * - Does not perform localization or formatting
 */
export function threadToUnified(thread: Thread): UnifiedSidebarItem {
    return {
        id: thread.id,
        type: 'thread',
        title: thread.title || 'Untitled Chat',
        updatedAt: thread.last_message_at ?? thread.updated_at,
        forked: thread.forked,
    };
}

/**
 * `docToUnified`
 *
 * Purpose:
 * Converts a document post into the unified sidebar item shape.
 *
 * Behavior:
 * Applies title fallbacks and preserves post type metadata.
 *
 * Constraints:
 * - Expects document posts with `postType` and `updated_at`
 *
 * Non-Goals:
 * - Does not filter out deleted posts
 */
export function docToUnified(doc: Post): UnifiedSidebarItem {
    return {
        id: doc.id,
        type: 'document',
        title: doc.title || 'Untitled Document',
        updatedAt: doc.updated_at,
        postType: doc.postType,
    };
}

/**
 * `usePaginatedSidebarItems`
 *
 * Purpose:
 * Supplies a paginated, reactive list of sidebar items with live updates.
 *
 * Behavior:
 * Uses Dexie live queries to keep results fresh and supports incremental
 * pagination with `loadMore`.
 *
 * Constraints:
 * - Must run on the client where IndexedDB is available
 * - Pagination is local-only and based on in-memory target counts
 *
 * Non-Goals:
 * - Does not implement server-side pagination or caching
 */
export function usePaginatedSidebarItems(
    options: {
        type?: 'all' | 'thread' | 'document';
        query?: Ref<string>;
    } = {}
) {
    const items = shallowRef<UnifiedSidebarItem[]>([]);
    const hasMore = ref(true);
    const loading = ref(false);
    const targetCount = ref(PAGE_SIZE);
    let subscription: Subscription | null = null;
    let subscriptionToken = 0;

    const filterType = options.type || 'all';
    const searchQuery = options.query;

    /**
     * Fetch the latest items up to a target count.
     *
     * @param limit - Maximum number of items to return.
     * @returns Items plus a flag indicating if more items exist.
     */
    async function fetchItems(
        limit: number
    ): Promise<{ items: UnifiedSidebarItem[]; hasMore: boolean }> {
        const db = getDb();
        const query = searchQuery?.value.toLowerCase() || '';
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
                            !!p.title.toLowerCase().includes(query))
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
        const token = ++subscriptionToken;
        const shouldShowLoading = items.value.length === 0;
        if (shouldShowLoading) loading.value = true;
        subscription?.unsubscribe();
        subscription = liveQuery(() => fetchItems(targetCount.value)).subscribe({
            next: (result) => {
                if (token !== subscriptionToken) return;
                items.value = result.items;
                hasMore.value = result.hasMore;
                loading.value = false;
            },
            error: (error) => {
                if (token !== subscriptionToken) return;
                console.error(
                    '[usePaginatedSidebarItems] liveQuery error:',
                    error
                );
                loading.value = false;
            },
        });
    }

    /**
     * Load next page of items.
     */
    function loadMore() {
        if (loading.value || !hasMore.value) return;
        targetCount.value += PAGE_SIZE;
        startSubscription();
    }

    /**
     * Reset pagination state and reload from start.
     */
    function reset() {
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
