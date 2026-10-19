<template>
    <div class="space-y-6">
            <div>
                <h1 class="text-2xl font-semibold">Administrators</h1>
                <p class="text-sm opacity-70">Manage who has administrator access.</p>
            </div>

            <!-- Grant Admin Form -->
            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <h2 class="text-lg font-medium mb-1">Grant Admin Access</h2>
                <UAlert
                    v-if="grantsEnforced === false"
                    color="warning"
                    variant="soft"
                    class="mb-4"
                    title="Grants aren't used on this deployment"
                    description="You can record administrators here, but this deployment doesn't use them to give anyone access. Sign in to this panel with the server's admin username and password."
                />
                <p v-else-if="grantsEnforced" class="mb-4 text-sm opacity-70">
                    People you add can open <strong>Plugins</strong> and <strong>File settings</strong> in this panel once they're signed in to OR3 with their own account.
                    Everything else here, including this page, needs the server's admin username and password.
                </p>

                <div class="flex gap-4">
                    <label for="admin-user-search" class="sr-only">Search users by email</label>
                    <UInput
                        v-model="searchQuery"
                        id="admin-user-search"
                        name="admin-user-search"
                        placeholder="Search by email…"
                        icon="i-heroicons-magnifying-glass"
                        :loading="isSearching"
                        class="flex-1"
                    />
                </div>

                <!-- Search Results -->
                <div v-if="searchResults.length > 0" class="mt-4 space-y-2">
                    <div
                        v-for="user in searchResults"
                        :key="user.userId"
                        class="flex flex-col gap-3 p-3 rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)] sm:flex-row sm:items-center sm:justify-between"
                    >
                        <div class="min-w-0 flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center">
                                <span class="text-xs font-medium text-[var(--md-on-primary-container)]">
                                    {{ (user.email || user.userId).substring(0, 2).toUpperCase() }}
                                </span>
                            </div>
                            <div class="min-w-0">
                                <div class="break-all font-medium">{{ user.email || user.userId }}</div>
                                <div v-if="user.displayName" class="text-xs opacity-50">{{ user.displayName }}</div>
                            </div>
                        </div>
                        
                        <UButton
                            v-if="!user.isAdmin"
                            @click="() => grantAdmin(user.userId, user.email)"
                            :loading="grantingUserId === user.userId"
                            color="primary"
                            size="sm"
                        >
                            Grant Access
                        </UButton>
                        <UBadge v-else color="success" variant="soft">Already Admin</UBadge>
                    </div>
                </div>
                <div v-else-if="hasSearched && !isSearching" class="mt-4 text-center py-4 text-sm opacity-50">
                    No users found matching "{{ searchQuery }}"
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

                <div v-if="showSkeleton" class="space-y-2">
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
                        class="flex flex-col gap-3 p-3 rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)] sm:flex-row sm:items-center sm:justify-between"
                    >
                        <div class="min-w-0 flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center">
                                <span class="text-xs font-medium text-[var(--md-on-primary-container)]">
                                    {{ (admin.email || admin.userId).substring(0, 2).toUpperCase() }}
                                </span>
                            </div>
                            <div class="min-w-0">
                                <div class="break-all font-medium">{{ admin.email || admin.userId }}</div>
                                <div class="text-xs opacity-50">Granted {{ formatDate(admin.createdAt) }}</div>
                            </div>
                        </div>
                        
                        <UButton
                            @click="() => revokeAdmin(admin.userId, admin.email)"
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
                    No accounts have been granted administrator access. The server's own admin sign-in isn't listed here.
                </div>
            </div>
        </div>
</template>

<script setup lang="ts">
import { formatDate } from '~/utils/date';
import { refDebounced } from '@vueuse/core';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import {
    useAdminUserLookup,
    type AdminLookupUser,
} from '~/composables/admin/useAdminUserLookup';

interface User extends AdminLookupUser {
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
const {
    results: lookupResults,
    isSearching,
    hasSearched,
    searchUsers,
    clearResults,
} = useAdminUserLookup();
const grantingUserId = ref<string | null>(null);
const revokingUserId = ref<string | null>(null);

const admins = ref<Admin[]>([]);
// Unknown until the first load; some deployments store grants without using them.
const grantsEnforced = ref<boolean | null>(null);
const pending = ref(true);
const error = ref<Error | null>(null);
const hasLoadedAdmins = ref(false);

const showSkeleton = computed(() =>
    pending.value || (!hasLoadedAdmins.value && !error.value)
);

async function refreshAdmins() {
    pending.value = true;
    error.value = null;
    try {
        const response = await $fetch<{ admins: Admin[]; grantsEnforced?: boolean }>('/api/admin/admin-users', {
            credentials: 'include',
        });
        admins.value = response.admins ?? [];
        grantsEnforced.value = response.grantsEnforced ?? null;
    } catch (err: unknown) {
        admins.value = [];
        error.value =
            new Error(getMessage(err, 'Unable to load admins'));
    } finally {
        hasLoadedAdmins.value = true;
        pending.value = false;
    }
}

onMounted(() => {
    void refreshAdmins();
});

// Derived from the current admin list so a grant or revoke updates the badges.
const searchResults = computed<User[]>(() =>
    lookupResults.value.map((user) => ({
        ...user,
        isAdmin: admins.value.some((a) => a.userId === user.userId),
    }))
);

// Issue 30: Debounce search query
const debouncedQuery = refDebounced(searchQuery, 300);

// Watch debounced query and trigger search
watch(debouncedQuery, (query) => {
    if (query.trim()) {
        void searchUsers(query, {
            onError: (err) => {
                toast.add({
                    title: 'Search failed',
                    description: getMessage(err, 'Unable to search users'),
                    color: 'error',
                });
            },
        });
    } else {
        clearResults();
    }
});

async function grantAdmin(userId: string, email?: string) {
    const confirmed = await confirm({
        title: 'Grant Admin Access',
        message: grantsEnforced.value === false
            ? `Record ${email || userId} as an administrator? This deployment doesn't use grants, so it won't give them access.`
            : `Grant administrator access to ${email || userId}? They'll be able to open Plugins and File settings in this panel. Other admin pages still need the server's admin sign-in.`,
        confirmText: 'Grant',
    });
    
    if (!confirmed) return;
    
    grantingUserId.value = userId;
    try {
        await $fetch('/api/admin/admin-users/grant', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: { userId },
        });
        toast.add({
            title: 'Admin access granted',
            color: 'success',
        });
        await refreshAdmins();
        clearResults();
        searchQuery.value = '';
        hasSearched.value = false;
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to grant access',
            description: getMessage(err, 'Unable to grant admin access'),
            color: 'error',
        });
    } finally {
        grantingUserId.value = null;
    }
}

async function revokeAdmin(userId: string, email?: string) {
    // Issue 26: Use accessible ConfirmDialog instead of native confirm()
    const confirmed = await confirm({
        title: 'Revoke Admin Access',
        message: `Are you sure you want to revoke admin access for ${email || 'this user'}?`,
        confirmText: 'Revoke',
        danger: true,
    });
    
    if (!confirmed) return;

    revokingUserId.value = userId;
    try {
        await $fetch('/api/admin/admin-users/revoke', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: { userId },
        });
        toast.add({
            title: 'Admin access revoked',
            color: 'success',
        });
        await refreshAdmins();
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to revoke access',
            description: getMessage(err, 'Unable to revoke admin access'),
            color: 'error',
        });
    } finally {
        revokingUserId.value = null;
    }
}
</script>
