<template>
    <div class="max-w-2xl mx-auto space-y-6">
            <div class="flex items-center gap-2">
                <UButton
                    to="/admin/workspaces"
                    variant="ghost"
                    color="neutral"
                    icon="i-heroicons-arrow-left"
                >
                    Back
                </UButton>
                <h1 class="text-2xl font-semibold">Create Workspace</h1>
            </div>
            <p class="text-sm opacity-70">Give a team its own space for chats, documents, and files. Choose an existing account to own it.</p>

            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <form @submit.prevent="handleSubmit" class="space-y-6">
                    <div>
                        <label for="workspace-name" class="block text-sm font-medium mb-2">Workspace name</label>
                        <UInput
                            v-model="form.name"
                            id="workspace-name"
                            name="workspace-name"
                            placeholder="Enter workspace name"
                            class="w-full"
                            required
                            :disabled="isSubmitting"
                        />
                    </div>

                    <div>
                        <label for="workspace-description" class="block text-sm font-medium mb-2">Description</label>
                        <UTextarea
                            v-model="form.description"
                            id="workspace-description"
                            name="workspace-description"
                            placeholder="Enter workspace description"
                            :disabled="isSubmitting"
                            :rows="3"
                            class="w-full"
                        />
                    </div>

                    <div>
                        <label for="workspace-owner-search" class="block text-sm font-medium mb-2">Owner</label>
                        <p class="mb-2 text-sm opacity-70">Search for the person who will manage this workspace. Name and owner are required.</p>
                        <div class="flex gap-2">
                            <UInput
                                v-model="ownerSearch"
                                id="workspace-owner-search"
                                name="workspace-owner-search"
                                placeholder="Search by email…"
                                icon="i-heroicons-magnifying-glass"
                                class="flex-1"
                                :disabled="isSubmitting"
                                @keydown.enter.prevent="searchOwner"
                            />
                            <UButton
                                @click="searchOwner"
                                type="button"
                                :loading="isSearching"
                                color="primary"
                                :disabled="isSubmitting || !ownerSearch.trim()"
                            >
                                Search
                            </UButton>
                        </div>
                        <p v-if="hasSearched && !isSearching && !ownerSearchFailed && !ownerResults.length && !selectedOwner" role="status" class="mt-2 text-sm opacity-70">
                            No matching accounts. The owner needs to create an account first.
                        </p>

                        <!-- Owner Selection -->
                        <div v-if="ownerResults.length > 0" class="mt-2 space-y-1">
                            <button
                                v-for="user in ownerResults"
                                :key="user.userId"
                                type="button"
                                @click="selectOwner(user)"
                                class="flex w-full items-center gap-3 p-3 text-left rounded-[var(--md-border-radius-small)] bg-[var(--md-surface-container-low)] cursor-pointer hover:bg-[var(--md-surface-container)] focus:outline-none focus:ring-2 focus:ring-[var(--md-primary)]"
                                :class="{ 'ring-2 ring-[var(--md-primary)]': form.ownerUserId === user.userId }"
                                :aria-pressed="form.ownerUserId === user.userId"
                            >
                                <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center">
                                    <span class="text-xs font-medium text-[var(--md-on-primary-container)]">
                                        {{ (user.email || user.userId).substring(0, 2).toUpperCase() }}
                                    </span>
                                </div>
                                <div class="min-w-0">
                                    <div class="break-all font-medium">{{ user.email || user.userId }}</div>
                                    <div v-if="user.displayName" class="text-xs opacity-50">{{ user.displayName }}</div>
                                </div>
                            </button>
                        </div>

                        <div v-if="selectedOwner" class="mt-2 p-3 rounded-[var(--md-border-radius)] bg-[var(--md-primary-container)]">
                            <div class="flex items-center gap-2 text-sm break-all">
                                <UIcon name="i-heroicons-check" class="text-[var(--md-on-primary-container)]" />
                                <span class="text-[var(--md-on-primary-container)]">
                                    Selected: {{ selectedOwner.email || selectedOwner.userId }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="flex flex-wrap justify-end gap-2">
                        <UButton
                            to="/admin/workspaces"
                            variant="soft"
                            color="neutral"
                            :disabled="isSubmitting"
                        >
                            Cancel
                        </UButton>
                        
                        <UButton
                            type="submit"
                            color="primary"
                            :loading="isSubmitting"
                            :disabled="!isValid"
                        >
                            Create Workspace
                        </UButton>
                    </div>
                </form>
            </div>
        </div>
</template>

<script setup lang="ts">
import {
    useAdminUserLookup,
    type AdminLookupUser,
} from '~/composables/admin/useAdminUserLookup';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';

type User = AdminLookupUser;

interface FormState {
    name: string;
    description: string;
    ownerUserId: string;
}

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const router = useRouter();
const toast = useToast();
const { getMessage } = useApiError();

const form = reactive<FormState>({
    name: '',
    description: '',
    ownerUserId: '',
});

const ownerSearch = ref('');
const {
    results: ownerResults,
    isSearching,
    hasSearched,
    searchUsers,
    clearResults,
} = useAdminUserLookup();
const selectedOwner = ref<User | null>(null);
const ownerSearchFailed = ref(false);
const isSubmitting = ref(false);

const isValid = computed(() => {
    return form.name.trim() && form.ownerUserId;
});

async function searchOwner() {
    if (!ownerSearch.value.trim()) return;
    ownerSearchFailed.value = false;
    await searchUsers(ownerSearch.value, {
        onError: (err) => {
            ownerSearchFailed.value = true;
            toast.add({
                title: 'Search failed',
                description: getMessage(err, 'Unable to search users'),
                color: 'error',
            });
        },
    });
}

function selectOwner(user: User) {
    form.ownerUserId = user.userId;
    selectedOwner.value = user;
    clearResults();
}

async function handleSubmit() {
    if (!isValid.value) return;

    isSubmitting.value = true;
    try {
        const result = await $fetch<{ workspaceId: string; provisioningWarning?: string }>('/api/admin/workspaces', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: {
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                ownerUserId: form.ownerUserId,
            },
        });

        toast.add({
            title: result.provisioningWarning ? 'Workspace created; plugin setup needs attention' : 'Workspace created',
            description: result.provisioningWarning,
            color: result.provisioningWarning ? 'warning' : 'success',
        });

        router.push(`/admin/workspaces/${result.workspaceId}`);
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to create workspace',
            description: getMessage(err, 'Unable to create workspace'),
            color: 'error',
        });
    } finally {
        isSubmitting.value = false;
    }
}
</script>
