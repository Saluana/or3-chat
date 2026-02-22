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
            results.value = options?.mapResult
                ? fetched.map(options.mapResult)
                : fetched;
        } catch (error) {
            options?.onError?.(error);
        } finally {
            isSearching.value = false;
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
