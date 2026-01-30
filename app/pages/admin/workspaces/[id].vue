<template>
    <div v-if="pending" class="space-y-4">
            <div class="h-32 bg-[var(--md-surface-container-highest)] rounded-lg animate-pulse" />
            <div class="h-64 bg-[var(--md-surface-container-highest)] rounded-lg animate-pulse" />
        </div>

        <UAlert
            v-else-if="error"
            color="error"
            title="Failed to load workspace"
            :description="error.message"
        />

        <div v-else-if="workspace" class="space-y-6">
            <!-- Header -->
            <div class="flex items-start justify-between">
                <div>
                    <div class="flex items-center gap-3">
                        <h1 class="text-2xl font-semibold">{{ workspace.name }}</h1>
                        <UBadge v-if="workspace.deleted" color="error" variant="soft">Deleted</UBadge>
                    </div>
                    <p v-if="workspace.description" class="text-sm opacity-70 mt-1">
                        {{ workspace.description }}
                    </p>
                </div>
                
                <div class="flex gap-2">
                    <UButton
                        v-if="!workspace.deleted"
                        @click="handleSoftDelete"
                        color="error"
                        variant="soft"
                        icon="i-heroicons-trash"
                        :loading="isDeleting"
                    >
                        Delete
                    </UButton>
                    <UButton
                        v-else
                        @click="handleRestore"
                        color="success"
                        variant="soft"
                        icon="i-heroicons-arrow-uturn-left"
                        :loading="isRestoring"
                    >
                        Restore
                    </UButton>
                </div>
            </div>

            <!-- Info Card -->
            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <h2 class="text-lg font-medium mb-4">Workspace Information</h2>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <div class="opacity-50">ID</div>
                        <div class="font-mono">{{ workspace.id }}</div>
                    </div>
                    <div>
                        <div class="opacity-50">Owner</div>
                        <div>{{ workspace.ownerEmail || workspace.ownerUserId || 'Unknown' }}</div>
                    </div>
                    <div>
                        <div class="opacity-50">Created</div>
                        <div>{{ formatDate(workspace.createdAt, true) }}</div>
                    </div>
                    <div>
                        <div class="opacity-50">Members</div>
                        <div>{{ workspace.memberCount }}</div>
                    </div>
                    <div v-if="workspace.deleted">
                        <div class="opacity-50">Deleted</div>
                        <div>{{ formatDate(workspace.deletedAt!, true) }}</div>
                    </div>
                </div>
            </div>

            <!-- Members Card -->
            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-lg font-medium">Members</h2>
                    <div class="text-sm opacity-70">{{ workspace.members?.length || 0 }} total</div>
                </div>

                <div v-if="(workspace.members?.length ?? 0) > 0" class="space-y-2">
                    <div
                        v-for="member in workspace.members"
                        :key="member.userId"
                        class="flex items-center justify-between p-3 rounded-lg bg-[var(--md-surface-container-low)]"
                    >
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center">
                                <span class="text-xs font-medium text-[var(--md-on-primary-container)]">
                                    {{ (member.email || member.userId).substring(0, 2).toUpperCase() }}
                                </span>
                            </div>
                            <div>
                                <div class="font-medium">{{ member.email || member.userId }}</div>
                                <div class="text-xs opacity-50">{{ member.role }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div v-else class="text-center py-8 text-sm opacity-50">
                    No members found
                </div>
            </div>

            <!-- Actions -->
            <div class="flex gap-2">
                <UButton to="/admin/workspaces" variant="soft" color="neutral" icon="i-heroicons-arrow-left">
                    Back to Workspaces
                </UButton>
            </div>
        </div>
</template>

<script setup lang="ts">
import { formatDate } from '~/utils/date';
interface Member {
    userId: string;
    email?: string;
    role: 'owner' | 'editor' | 'viewer';
}

interface Workspace {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    deleted: boolean;
    deletedAt?: number;
    ownerUserId?: string;
    ownerEmail?: string;
    memberCount: number;
    members?: Member[];
}

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const route = useRoute();
const router = useRouter();
const toast = useToast();
const workspaceId = route.params.id as string;

const isDeleting = ref(false);
const isRestoring = ref(false);

const { data: workspace, pending, error, refresh } = await useFetch<Workspace>(
    () => `/api/admin/workspaces/${workspaceId}`,
    {
        server: false,
        credentials: 'include',
    }
);

async function handleSoftDelete() {
    if (!confirm('Are you sure you want to delete this workspace?')) return;

    isDeleting.value = true;
    try {
        await $fetch(`/api/admin/workspaces/${workspaceId}/soft-delete`, {
            method: 'POST',
            credentials: 'include',
        });
        toast.add({
            title: 'Workspace deleted',
            color: 'success',
        });
        refresh();
    } catch (err: any) {
        toast.add({
            title: 'Failed to delete workspace',
            description: err?.data?.statusMessage || 'Unknown error',
            color: 'error',
        });
    } finally {
        isDeleting.value = false;
    }
}

async function handleRestore() {
    isRestoring.value = true;
    try {
        await $fetch(`/api/admin/workspaces/${workspaceId}/restore`, {
            method: 'POST',
            credentials: 'include',
        });
        toast.add({
            title: 'Workspace restored',
            color: 'success',
        });
        refresh();
    } catch (err: any) {
        toast.add({
            title: 'Failed to restore workspace',
            description: err?.data?.statusMessage || 'Unknown error',
            color: 'error',
        });
    } finally {
        isRestoring.value = false;
    }
}
</script>
