import { ref, computed, onScopeDispose, getCurrentScope } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getDb } from '~/db/client';
import type { Post } from '~/db/schema';

export interface UsePostsListOptions {
    /** Maximum number of posts to return */
    limit?: number;
    /** Sort order (default: updated_at descending) */
    sort?: 'updated_at' | 'created_at';
    /** Sort direction (default: 'desc') */
    sortDir?: 'asc' | 'desc';
}

export interface PostData extends Omit<Post, 'meta'> {
    meta?: unknown;
}

/**
 * Parse meta field from string to object/array when it contains JSON.
 * Returns parsed value or original if not parseable.
 */
function parseMeta(meta: unknown): unknown {
    if (typeof meta !== 'string') return meta;
    if (!meta) return meta;
    try {
        return JSON.parse(meta);
    } catch {
        return meta; // Return as-is if not valid JSON
    }
}

/**
 * Reactive composable for listing posts by type with live Dexie query.
 * Automatically filters soft-deleted posts and sorts by updated_at descending.
 */
export function usePostsList(
    postType: string,
    opts: UsePostsListOptions = {}
) {
    if (!process.client) {
        // SSR-safe no-op
        return {
            items: computed(() => [] as PostData[]),
            loading: ref(false),
            error: ref<Error | null>(null),
            refresh: () => Promise.resolve(),
        };
    }

    const { limit, sort = 'updated_at', sortDir = 'desc' } = opts;

    const items = ref<PostData[]>([]);
    const loading = ref(true);
    const error = ref<Error | null>(null);

    let subscription: Subscription | null = null;

    // Create live query
    const observable = liveQuery(async () => {
        try {
            const sortField = sort === 'created_at' ? 'created_at' : 'updated_at';
            
            // Query posts by postType, filter soft-deleted
            const query = getDb().posts
                .where('postType')
                .equals(postType)
                .and((p) => !p.deleted);

            // Apply sorting
            const results = await query.sortBy(sortField);
            
            // Apply sort direction
            const sorted = sortDir === 'asc' ? results : results.reverse();
            
            // Apply limit if specified
            const sliced = limit ? sorted.slice(0, limit) : sorted;

            // Parse meta for each post
            return sliced.map((p): PostData => ({
                ...p,
                meta: parseMeta(p.meta),
            }));
        } catch (e) {
            console.error('[usePostsList] Query failed:', e);
            throw e;
        }
    });

    // Subscribe to live query
    subscription = observable.subscribe({
        next: (result) => {
            items.value = result;
            loading.value = false;
            error.value = null;
        },
        error: (err) => {
            console.error('[usePostsList] Subscription error:', err);
            error.value = err instanceof Error ? err : new Error(String(err));
            loading.value = false;
        },
    });

    // Cleanup on component unmount
    if (getCurrentScope()) {
        onScopeDispose(() => {
            subscription?.unsubscribe();
            subscription = null;
        });
    }

    // Manual refresh (subscription will auto-update)
    const refresh = () => {
        loading.value = true;
        error.value = null;
        // Subscription will trigger next update automatically
    };

    return {
        items: computed(() => items.value),
        loading: computed(() => loading.value),
        error: computed(() => error.value),
        refresh,
    };
}
