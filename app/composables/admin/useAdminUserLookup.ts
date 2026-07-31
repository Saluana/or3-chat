import { ref } from 'vue';

export interface AdminLookupUser {
    userId: string;
    email?: string;
    displayName?: string;
}

export function useAdminUserLookup() {
    const results = ref<AdminLookupUser[]>([]);
    const isSearching = ref(false);
    const hasSearched = ref(false);
    let requestSeq = 0;

    async function searchUsers(
        query: string,
        options?: {
            mapResult?: (user: AdminLookupUser) => AdminLookupUser;
            onError?: (error: unknown) => void;
        }
    ) {
        const trimmed = query.trim();
        if (!trimmed) {
            results.value = [];
            hasSearched.value = false;
            return;
        }

        const currentSeq = ++requestSeq;
        isSearching.value = true;
        hasSearched.value = true;
        try {
            const fetched = await $fetch<AdminLookupUser[]>(
                '/api/admin/search-users',
                {
                    query: { q: trimmed },
                    credentials: 'include',
                }
            );
            if (currentSeq !== requestSeq) return;
            results.value = options?.mapResult
                ? fetched.map(options.mapResult)
                : fetched;
        } catch (error) {
            if (currentSeq !== requestSeq) return;
            options?.onError?.(error);
        } finally {
            if (currentSeq === requestSeq) {
                isSearching.value = false;
            }
        }
    }

    function clearResults() {
        results.value = [];
    }

    return {
        results,
        isSearching,
        hasSearched,
        searchUsers,
        clearResults,
    };
}
