<template>
    <div class="space-y-6">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="text-2xl font-semibold">Workspaces</h1>
                    <p class="text-sm opacity-70">Manage all workspaces in the deployment</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        to="/admin/admin-users"
                        variant="soft"
                        color="neutral"
                        :icon="usersIcon"
                    >
                        Admin Users
                    </UButton>
                    <UButton
                        to="/admin/workspaces/create"
                        color="primary"
                        :icon="plusIcon"
                    >
                        Create Workspace
                    </UButton>
                </div>
            </div>

            <!-- Filters -->
            <div class="flex flex-wrap gap-4">
                <UInput
                    v-model="search"
                    aria-label="Search workspaces"
                    placeholder="Search workspaces..."
                    :icon="searchIcon"
                    class="flex-1 min-w-[200px]"
                />
                <USelectMenu
                    v-model="showDeleted"
                    aria-label="Workspace visibility filter"
                    :options="[
                        { label: 'Active Only', value: false },
                        { label: 'Show Deleted', value: true },
                    ]"
                    option-attribute="label"
                    value-attribute="value"
                    class="w-40"
                />
            </div>

            <!-- Loading State -->
            <div v-if="showSkeleton" class="space-y-4">
                <div v-for="i in perPage" :key="i" class="h-20 bg-[var(--md-surface-container-highest)] rounded-lg animate-pulse" />
            </div>

            <!-- Error State -->
            <UAlert
                v-else-if="error"
                color="error"
                title="Failed to load workspaces"
                :description="error.message"
            />

            <!-- Workspaces List -->
            <div v-else-if="workspaces?.length > 0" class="space-y-4">
                <div
                    v-for="workspace in workspaces"
                    :key="workspace.id"
                    class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] hover:bg-[var(--md-surface-container-low)] transition-colors"
                >
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div class="min-w-0 flex items-center gap-4">
                            <div class="w-10 h-10 rounded-lg bg-[var(--md-surface-container-high)] flex items-center justify-center">
                                <UIcon :name="workspaceIcon" class="w-5 h-5 text-[var(--md-primary)]" />
                            </div>
                            <div class="min-w-0">
                                <div class="font-medium flex flex-wrap items-center gap-2">
                                    {{ workspace.name }}
                                    <UBadge v-if="workspace.deleted" color="error" variant="soft">Deleted</UBadge>
                                </div>
                            <div class="break-words text-sm opacity-70">
                                {{ workspace.memberCount }} members · Owner: {{ workspace.ownerEmail || workspace.ownerUserId || 'Unknown' }}
                            </div>
                                <div class="text-xs opacity-50">
                                    Created {{ formatDate(workspace.createdAt) }}
                                </div>
                            </div>
                        </div>
                        
                        <UButton
                            @click="navigateToWorkspace(workspace.id)"
                            :loading="navigatingTo === workspace.id"
                            variant="ghost"
                            color="neutral"
                            :icon="arrowRightIcon"
                        >
                            View
                        </UButton>
                    </div>
                </div>

                <!-- Pagination -->
                <div class="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="text-sm opacity-70">
                        Showing {{ workspaces?.length ?? 0 }} of {{ total }} workspaces
                    </div>
                    <div class="flex gap-2">
                        <UButton
                            :disabled="page <= 1"
                            @click="page--"
                            variant="soft"
                            color="neutral"
                        >
                            Previous
                        </UButton>
                        <UButton
                            :disabled="page * perPage >= total"
                            @click="page++"
                            variant="soft"
                            color="neutral"
                        >
                            Next
                        </UButton>
                    </div>
                </div>
            </div>

            <!-- Empty State -->
            <div v-else class="text-center py-12">
                <UIcon :name="workspaceIcon" class="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p class="text-lg font-medium opacity-70">No workspaces found</p>
                <p class="text-sm opacity-50">Try adjusting your search or filters</p>
            </div>
        </div>
</template>

<script setup lang="ts">
import { formatDate } from '~/utils/date';
import { refDebounced } from '@vueuse/core';
import type { WorkspaceSummary } from '~/types/global';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

// Icons
const workspaceIcon = useIcon('admin.workspace');
const usersIcon = useIcon('sidebar.user');
const plusIcon = useIcon('ui.plus');
const searchIcon = useIcon('ui.search');
const arrowRightIcon = useIcon('ui.chevron.right');

const search = ref('');
const showDeleted = ref(false);
const page = ref(1);
const perPage = ref(20);
const navigatingTo = ref<string | null>(null);
const workspaces = ref<WorkspaceSummary[]>([]);
const total = ref(0);
const pending = ref(true);
const error = ref<Error | null>(null);
const hasLoaded = ref(false);

const { getMessage } = useApiError();

const showSkeleton = computed(() =>
    pending.value || (!hasLoaded.value && !error.value)
);

// Debounce search
const debouncedSearch = refDebounced(search, 300);

// Navigation handler with loading state
async function navigateToWorkspace(id: string) {
    navigatingTo.value = id;
    try {
        await navigateTo(`/admin/workspaces/${id}`);
    } finally {
        navigatingTo.value = null;
    }
}

async function refreshWorkspaces() {
    pending.value = true;
    error.value = null;
    try {
        const response = await $fetch<{ items: WorkspaceSummary[]; total: number }>(
            '/api/admin/workspaces',
            {
                credentials: 'include',
                query: {
                    search: debouncedSearch.value || undefined,
                    includeDeleted: showDeleted.value.toString(),
                    page: page.value.toString(),
                    perPage: perPage.value.toString(),
                },
            }
        );

        workspaces.value = response.items ?? [];
        total.value = response.total ?? 0;
    } catch (err: unknown) {
        workspaces.value = [];
        total.value = 0;
        error.value =
            err instanceof Error
                ? err
                : new Error(getMessage(err, 'Unable to load workspaces'));
    } finally {
        hasLoaded.value = true;
        pending.value = false;
    }
}

onMounted(() => {
    void refreshWorkspaces();
});

// Reset page when filters change
watch([debouncedSearch, showDeleted], () => {
    page.value = 1;
    if (!import.meta.client) return;
    void refreshWorkspaces();
});

watch([page, perPage], () => {
    if (!import.meta.client) return;
    void refreshWorkspaces();
});
</script>
