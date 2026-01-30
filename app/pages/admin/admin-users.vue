<template>
    <div class="space-y-6">
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-2xl font-semibold">Admin Users</h1>
                    <p class="text-sm opacity-70">Manage deployment admin access</p>
                </div>
                <UButton
                    to="/admin/workspaces"
                    variant="soft"
                    color="neutral"
                    icon="i-heroicons-arrow-left"
                >
                    Back to Workspaces
                </UButton>
            </div>

            <!-- Grant Admin Form -->
            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <h2 class="text-lg font-medium mb-4">Grant Admin Access</h2>
                
                <div class="flex gap-4">
                    <UInput
                        v-model="searchQuery"
                        placeholder="Search by email..."
                        icon="i-heroicons-magnifying-glass"
                        class="flex-1"
                    />
                </div>

                <!-- Search Results -->
                <div v-if="searchResults.length > 0" class="mt-4 space-y-2">
                    <div
                        v-for="user in searchResults"
                        :key="user.userId"
                        class="flex items-center justify-between p-3 rounded-lg bg-[var(--md-surface-container-low)]"
                    >
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center">
                                <span class="text-xs font-medium text-[var(--md-on-primary-container)]">
                                    {{ (user.email || user.userId).substring(0, 2).toUpperCase() }}
                                </span>
                            </div>
                            <div>
                                <div class="font-medium">{{ user.email || user.userId }}</div>
                                <div v-if="user.displayName" class="text-xs opacity-50">{{ user.displayName }}</div>
                            </div>
                        </div>
                        
                        <UButton
                            v-if="!user.isAdmin"
                            @click="() => grantAdmin(user.userId)"
                            :loading="grantingUserId === user.userId"
                            color="primary"
                            size="sm"
                        >
                            Grant Access
                        </UButton>
                        <UBadge v-else color="success" variant="soft">Already Admin</UBadge>
                    </div>
                </div>
            </div>

            <!-- Current Admins -->
            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-lg font-medium">Current Admins</h2>
                    <UButton
                        @click="() => refreshAdmins()"
                        variant="ghost"
                        color="neutral"
                        icon="i-heroicons-arrow-path"
                        :loading="pending"
                    >
                        Refresh
                    </UButton>
                </div>

                <div v-if="pending" class="space-y-2">
                    <div v-for="i in 3" :key="i" class="h-12 bg-[var(--md-surface-container-highest)] rounded animate-pulse" />
                </div>

                <UAlert
                    v-else-if="error"
                    color="error"
                    title="Failed to load admins"
                    :description="error.message"
                />

                <div v-else-if="admins.length > 0" class="space-y-2">
                    <div
                        v-for="admin in admins"
                        :key="admin.userId"
                        class="flex items-center justify-between p-3 rounded-lg bg-[var(--md-surface-container-low)]"
                    >
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center">
                                <span class="text-xs font-medium text-[var(--md-on-primary-container)]">
                                    {{ (admin.email || admin.userId).substring(0, 2).toUpperCase() }}
                                </span>
                            </div>
                            <div>
                                <div class="font-medium">{{ admin.email || admin.userId }}</div>
                                <div class="text-xs opacity-50">Granted {{ formatDate(admin.createdAt) }}</div>
                            </div>
                        </div>
                        
                        <UButton
                            @click="() => revokeAdmin(admin.userId)"
                            :loading="revokingUserId === admin.userId"
                            color="error"
                            variant="soft"
                            size="sm"
                        >
                            Revoke
                        </UButton>
                    </div>
                </div>

                <div v-else class="text-center py-8 text-sm opacity-50">
                    No admin users configured
                </div>
            </div>
        </div>
</template>

<script setup lang="ts">
interface User {
    userId: string;
    email?: string;
    displayName?: string;
    isAdmin?: boolean;
}

interface Admin {
    userId: string;
    email?: string;
    displayName?: string;
    createdAt: number;
}

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const toast = useToast();
const { getMessage } = useApiError();
const { confirm } = useConfirmDialog();

const searchQuery = ref('');
const searchResults = ref<User[]>([]);
const isSearching = ref(false);
const grantingUserId = ref<string | null>(null);
const revokingUserId = ref<string | null>(null);

const { data: adminsData, pending, error, refresh: refreshAdmins } = await useFetch<{ admins: Admin[] }>(
    '/api/admin/admin-users',
    {
        server: false,
        credentials: 'include',
    }
);

const admins = computed(() => adminsData.value?.admins ?? []);

// Issue 30: Debounce search query
const { refDebounced } = await import('@vueuse/core');
const debouncedQuery = refDebounced(searchQuery, 300);

// Watch debounced query and trigger search
watch(debouncedQuery, (query) => {
    if (query.trim()) {
        searchUsers(query);
    } else {
        searchResults.value = [];
    }
});

async function searchUsers(query: string) {
    isSearching.value = true;
    try {
        const results = await $fetch<User[]>('/api/admin/search-users', {
            query: { q: query },
            credentials: 'include',
        });
        
        // Mark admins in results
        searchResults.value = results.map((user) => ({
            ...user,
            isAdmin: admins.value.some((a) => a.userId === user.userId),
        }));
    } catch (err: any) {
        toast.add({
            title: 'Search failed',
            description: getMessage(err, 'Unable to search users'),
            color: 'error',
        });
    } finally {
        isSearching.value = false;
    }
}

async function grantAdmin(userId: string) {
    grantingUserId.value = userId;
    try {
        await $fetch('/api/admin/admin-users/grant', {
            method: 'POST',
            credentials: 'include',
            body: { userId },
        });
        toast.add({
            title: 'Admin access granted',
            color: 'success',
        });
        refreshAdmins();
        searchResults.value = [];
        searchQuery.value = '';
    } catch (err: any) {
        toast.add({
            title: 'Failed to grant access',
            description: getMessage(err, 'Unable to grant admin access'),
            color: 'error',
        });
    } finally {
        grantingUserId.value = null;
    }
}

async function revokeAdmin(userId: string) {
    // Issue 26: Use accessible ConfirmDialog instead of native confirm()
    const confirmed = await confirm({
        title: 'Revoke Admin Access',
        message: 'Are you sure you want to revoke admin access for this user?',
        confirmText: 'Revoke',
        danger: true,
    });
    
    if (!confirmed) return;

    revokingUserId.value = userId;
    try {
        await $fetch('/api/admin/admin-users/revoke', {
            method: 'POST',
            credentials: 'include',
            body: { userId },
        });
        toast.add({
            title: 'Admin access revoked',
            color: 'success',
        });
        refreshAdmins();
    } catch (err: any) {
        toast.add({
            title: 'Failed to revoke access',
            description: getMessage(err, 'Unable to revoke admin access'),
            color: 'error',
        });
    } finally {
        revokingUserId.value = null;
    }
}

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
}
</script>
