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

            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <form @submit.prevent="handleSubmit" class="space-y-6">
                    <div>
                        <label class="block text-sm font-medium mb-2">Workspace Name *</label>
                        <UInput
                            v-model="form.name"
                            placeholder="Enter workspace name"
                            :disabled="isSubmitting"
                        />
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-2">Description</label>
                        <UTextarea
                            v-model="form.description"
                            placeholder="Enter workspace description"
                            :disabled="isSubmitting"
                            :rows="3"
                        />
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-2">Owner *</label>
                        <div class="flex gap-2">
                            <UInput
                                v-model="ownerSearch"
                                placeholder="Search by email..."
                                icon="i-heroicons-magnifying-glass"
                                class="flex-1"
                                :disabled="isSubmitting"
                            />
                            <UButton
                                @click="searchOwner"
                                :loading="isSearching"
                                color="primary"
                                :disabled="isSubmitting"
                            >
                                Search
                            </UButton>
                        </div>

                        <!-- Owner Selection -->
                        <div v-if="ownerResults.length > 0" class="mt-2 space-y-1">
                            <div
                                v-for="user in ownerResults"
                                :key="user.userId"
                                @click="selectOwner(user)"
                                class="flex items-center gap-3 p-3 rounded-lg bg-[var(--md-surface-container-low)] cursor-pointer hover:bg-[var(--md-surface-container)]"
                                :class="{ 'ring-2 ring-[var(--md-primary)]': form.ownerUserId === user.userId }"
                            >
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
                        </div>

                        <div v-if="selectedOwner" class="mt-2 p-3 rounded-lg bg-[var(--md-primary-container)]">
                            <div class="flex items-center gap-2 text-sm">
                                <UIcon name="i-heroicons-check" class="text-[var(--md-on-primary-container)]" />
                                <span class="text-[var(--md-on-primary-container)]">
                                    Selected: {{ selectedOwner.email || selectedOwner.userId }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="flex justify-end gap-2">
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
interface User {
    userId: string;
    email?: string;
    displayName?: string;
}

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
const ownerResults = ref<User[]>([]);
const selectedOwner = ref<User | null>(null);
const isSearching = ref(false);
const isSubmitting = ref(false);

const isValid = computed(() => {
    return form.name.trim() && form.ownerUserId;
});

async function searchOwner() {
    if (!ownerSearch.value.trim()) return;

    isSearching.value = true;
    try {
        const results = await $fetch<User[]>('/api/admin/search-users', {
            query: { q: ownerSearch.value },
            credentials: 'include',
        });
        ownerResults.value = results;
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

function selectOwner(user: User) {
    form.ownerUserId = user.userId;
    selectedOwner.value = user;
    ownerResults.value = [];
}

async function handleSubmit() {
    if (!isValid.value) return;

    isSubmitting.value = true;
    try {
        const result = await $fetch<{ workspaceId: string }>('/api/admin/workspaces', {
            method: 'POST',
            credentials: 'include',
            body: {
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                ownerUserId: form.ownerUserId,
            },
        });

        toast.add({
            title: 'Workspace created',
            color: 'success',
        });

        router.push(`/admin/workspaces/${result.workspaceId}`);
    } catch (err: any) {
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
