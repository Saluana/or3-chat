<template>
    <div v-if="showSkeleton" class="space-y-4">
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
            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-lg font-medium">Invites</h2>
                    <UButton size="sm" variant="soft" color="neutral" :loading="isLoadingInvites" @click="loadInvites">
                        Refresh
                    </UButton>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
                    <UInput v-model="inviteEmail" placeholder="invitee@example.com" type="email" />
                    <USelect v-model="inviteRole" :items="inviteRoleItems" />
                    <UInput v-model.number="inviteTtlHours" type="number" min="1" max="720" placeholder="TTL hours" />
                    <UButton :loading="isCreatingInvite" @click="createInvite">Create invite</UButton>
                </div>

                <div v-if="invites.length === 0" class="text-sm opacity-60 py-4">No invites yet.</div>

                <div v-else class="space-y-2">
                    <div
                        v-for="invite in invites"
                        :key="invite.id"
                        class="p-3 rounded-lg bg-[var(--md-surface-container-low)] flex items-center justify-between gap-3"
                    >
                        <div class="min-w-0">
                            <div class="font-medium truncate">{{ invite.email }}</div>
                            <div class="text-xs opacity-70">
                                {{ invite.role }} · {{ invite.status }} · expires {{ formatDate(invite.expiresAt * 1000, true) }}
                            </div>
                            <div v-if="invite.inviteUrl" class="text-xs opacity-70 truncate">{{ invite.inviteUrl }}</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <UButton
                                v-if="invite.inviteUrl"
                                size="xs"
                                variant="soft"
                                color="neutral"
                                @click="copyInviteUrl(invite.inviteUrl)"
                            >
                                Copy URL
                            </UButton>
                            <UButton
                                v-if="invite.status === 'pending'"
                                size="xs"
                                color="error"
                                variant="soft"
                                @click="revokeInvite(invite.id)"
                            >
                                Revoke
                            </UButton>
                        </div>
                    </div>
                </div>
            </div>

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
import type { WorkspaceSummary, WorkspaceMemberInfo } from '~/types/global';

interface Workspace extends WorkspaceSummary {
    members?: WorkspaceMemberInfo[];
}

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { getMessage } = useApiError();
const { confirm } = useConfirmDialog();
const workspaceId = route.params.id as string;

const isDeleting = ref(false);
const isRestoring = ref(false);
const isLoadingInvites = ref(false);
const isCreatingInvite = ref(false);
const inviteEmail = ref('');
const inviteRole = ref<'owner' | 'editor' | 'viewer'>('viewer');
const inviteTtlHours = ref(72);
const inviteRoleItems = [
    { label: 'Viewer', value: 'viewer' },
    { label: 'Editor', value: 'editor' },
    { label: 'Owner', value: 'owner' },
];
const invites = ref<Array<{ id: string; email: string; role: 'owner' | 'editor' | 'viewer'; status: 'pending' | 'accepted' | 'revoked' | 'expired'; expiresAt: number; inviteUrl?: string }>>([]);

const workspace = ref<Workspace | null>(null);
const pending = ref(true);
const error = ref<Error | null>(null);

async function refreshWorkspace() {
    pending.value = true;
    error.value = null;
    try {
        workspace.value = await $fetch<Workspace>(
            `/api/admin/workspaces/${workspaceId}`,
            {
                credentials: 'include',
            }
        );
    } catch (err: any) {
        workspace.value = null;
        error.value =
            err instanceof Error
                ? err
                : new Error(getMessage(err, 'Unable to load workspace'));
    } finally {
        pending.value = false;
    }
}

const showSkeleton = computed(() =>
    pending.value || (!workspace.value && !error.value)
);

async function handleSoftDelete() {
    // Issue 26: Use accessible ConfirmDialog instead of native confirm()
    const confirmed = await confirm({
        title: 'Delete Workspace',
        message: 'Are you sure you want to delete this workspace? You can restore it later from the deleted workspaces list.',
        confirmText: 'Delete',
        danger: true,
    });
    
    if (!confirmed) return;

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
        await refreshWorkspace();
    } catch (err: any) {
        toast.add({
            title: 'Failed to delete workspace',
            description: getMessage(err, 'Unable to delete workspace'),
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
        await refreshWorkspace();
    } catch (err: any) {
        toast.add({
            title: 'Failed to restore workspace',
            description: getMessage(err, 'Unable to restore workspace'),
            color: 'error',
        });
    } finally {
        isRestoring.value = false;
    }
}

async function loadInvites() {
    isLoadingInvites.value = true;
    try {
        const response = await $fetch<{
            invites: Array<{ id: string; email: string; role: 'owner' | 'editor' | 'viewer'; status: 'pending' | 'accepted' | 'revoked' | 'expired'; expiresAt: number }>;
            unavailable?: boolean;
            message?: string;
        }>(
            '/api/admin/workspace/invites/list',
            {
                credentials: 'include',
            }
        );
        invites.value = response.invites ?? [];

        if (response.unavailable) {
            toast.add({
                title: 'Invites unavailable',
                description:
                    response.message ||
                    'Convex invite functions are not deployed for this backend.',
                color: 'warning',
            });
        }
    } catch (err: any) {
        toast.add({
            title: 'Failed to load invites',
            description: getMessage(err, 'Unable to load invites'),
            color: 'error',
        });
    } finally {
        isLoadingInvites.value = false;
    }
}

async function createInvite() {
    if (!inviteEmail.value.trim()) return;
    isCreatingInvite.value = true;
    try {
        const response = await $fetch<{ invite: { id: string; email: string; role: 'owner' | 'editor' | 'viewer'; expiresAt: number; inviteUrl: string; }; }>(
            '/api/admin/workspace/invites/create',
            {
                method: 'POST',
                credentials: 'include',
                body: {
                    email: inviteEmail.value,
                    role: inviteRole.value,
                    expiresInSeconds: Math.max(1, inviteTtlHours.value) * 60 * 60,
                },
            }
        );

        invites.value.unshift({
            id: response.invite.id,
            email: response.invite.email,
            role: response.invite.role,
            status: 'pending',
            expiresAt: response.invite.expiresAt,
            inviteUrl: response.invite.inviteUrl,
        });
        inviteEmail.value = '';

        toast.add({
            title: 'Invite created',
            description: 'Invite link copied to clipboard.',
            color: 'success',
        });
        await copyInviteUrl(response.invite.inviteUrl);
    } catch (err: any) {
        toast.add({
            title: 'Failed to create invite',
            description: getMessage(err, 'Unable to create invite'),
            color: 'error',
        });
    } finally {
        isCreatingInvite.value = false;
    }
}

async function revokeInvite(inviteId: string) {
    try {
        await $fetch('/api/admin/workspace/invites/revoke', {
            method: 'POST',
            credentials: 'include',
            body: { inviteId },
        });
        invites.value = invites.value.map((invite) =>
            invite.id === inviteId
                ? { ...invite, status: 'revoked' }
                : invite
        );
    } catch (err: any) {
        toast.add({
            title: 'Failed to revoke invite',
            description: getMessage(err, 'Unable to revoke invite'),
            color: 'error',
        });
    }
}

async function copyInviteUrl(url: string) {
    try {
        await navigator.clipboard.writeText(url);
    } catch {
        // ignore clipboard errors
    }
}

onMounted(() => {
    void refreshWorkspace();
    void loadInvites();
});
</script>
