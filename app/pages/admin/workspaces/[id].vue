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
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-3">
                        <h1 class="min-w-0 break-words text-2xl font-semibold">{{ workspace.name }}</h1>
                        <UBadge v-if="workspace.deleted" color="error" variant="soft">Deleted</UBadge>
                    </div>
                    <p v-if="workspace.description" class="text-sm opacity-70 mt-1">
                        {{ workspace.description }}
                    </p>
                </div>
                
                <div class="flex flex-wrap gap-2">
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
                <div class="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    <div class="min-w-0">
                        <div class="opacity-50">ID</div>
                        <div class="break-all font-mono">{{ workspace.id }}</div>
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

            <div class="flex flex-col gap-4 p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 class="text-lg font-medium">Guest access</h2>
                    <p class="text-sm opacity-70">
                        Allow people without a workspace account to open explicitly shared resources.
                    </p>
                </div>
                <USwitch
                    :model-value="workspace.guestAccessEnabled"
                    :disabled="isUpdatingGuestAccess || workspace.deleted"
                    :loading="isUpdatingGuestAccess"
                    :aria-label="workspace.guestAccessEnabled ? 'Disable guest access' : 'Enable guest access'"
                    @update:model-value="setGuestAccess"
                />
            </div>

            <!-- Members Card -->
            <div class="p-6 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <div class="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 class="text-lg font-medium">Members</h2>
                        <p class="text-sm opacity-70">{{ workspace.members?.length || 0 }} total</p>
                    </div>
                    <div class="flex flex-col gap-2 sm:flex-row">
                        <UInput
                            v-model="newMemberIdentifier"
                            aria-label="Member email or user ID"
                            placeholder="Email or user ID"
                            class="min-w-0 sm:w-64"
                        />
                        <USelect
                            v-model="newMemberRole"
                            aria-label="New member role"
                            :items="memberRoleItems"
                            class="sm:w-32"
                        />
                        <UButton
                            :loading="isAddingMember"
                            :disabled="!newMemberIdentifier.trim()"
                            @click="addMember"
                        >
                            Add member
                        </UButton>
                    </div>
                </div>

                <div v-if="(workspace.members?.length ?? 0) > 0" class="space-y-2">
                    <div
                        v-for="member in workspace.members"
                        :key="member.userId"
                        class="flex flex-col gap-3 p-3 rounded-lg bg-[var(--md-surface-container-low)] sm:flex-row sm:items-center sm:justify-between"
                    >
                        <div class="min-w-0 flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] flex items-center justify-center">
                                <span class="text-xs font-medium text-[var(--md-on-primary-container)]">
                                    {{ (member.email || member.userId).substring(0, 2).toUpperCase() }}
                                </span>
                            </div>
                            <div class="min-w-0">
                                <div class="break-all font-medium">{{ member.email || member.userId }}</div>
                                <div class="text-xs opacity-50">{{ member.role }}</div>
                            </div>
                        </div>
                        <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                            <USelect
                                :model-value="member.role"
                                :items="memberRoleItems"
                                :aria-label="`Role for ${member.email || member.userId}`"
                                class="min-w-32 flex-1 sm:flex-none"
                                :disabled="memberActionUserId === member.userId"
                                @update:model-value="updateMemberRole(member, $event)"
                            />
                            <UButton
                                color="error"
                                variant="soft"
                                :loading="memberActionUserId === member.userId"
                                @click="removeMember(member)"
                            >
                                Remove
                            </UButton>
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
                    <div>
                        <h2 class="text-lg font-medium">Invites</h2>
                        <p class="text-sm opacity-70">Invite people to {{ workspace.name }}.</p>
                    </div>
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
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import type { WorkspaceSummary, WorkspaceMemberInfo } from '~/types/global';

interface Workspace extends WorkspaceSummary {
    members?: WorkspaceMemberInfo[];
    guestAccessEnabled: boolean;
}

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const route = useRoute();
const toast = useToast();
const { getMessage } = useApiError();
const { confirm } = useConfirmDialog();
const workspaceId = computed(() => String(route.params.id ?? ''));

const isDeleting = ref(false);
const isRestoring = ref(false);
const isLoadingInvites = ref(false);
const isCreatingInvite = ref(false);
const isAddingMember = ref(false);
const isUpdatingGuestAccess = ref(false);
const memberActionUserId = ref<string | null>(null);
const newMemberIdentifier = ref('');
const newMemberRole = ref<'owner' | 'editor' | 'viewer'>('viewer');
const inviteEmail = ref('');
const inviteRole = ref<'owner' | 'editor' | 'viewer'>('viewer');
const inviteTtlHours = ref(72);
const inviteRoleItems = [
    { label: 'Viewer', value: 'viewer' },
    { label: 'Editor', value: 'editor' },
    { label: 'Owner', value: 'owner' },
];
const memberRoleItems = [
    { label: 'Owner', value: 'owner' },
    { label: 'Editor', value: 'editor' },
    { label: 'Viewer', value: 'viewer' },
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
            `/api/admin/workspaces/${workspaceId.value}`,
            {
                credentials: 'include',
                query: { workspaceId: workspaceId.value },
            }
        );
    } catch (err: unknown) {
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
        await $fetch(`/api/admin/workspaces/${workspaceId.value}/soft-delete`, {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
        });
        toast.add({
            title: 'Workspace deleted',
            color: 'success',
        });
        await refreshWorkspace();
    } catch (err: unknown) {
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
        await $fetch(`/api/admin/workspaces/${workspaceId.value}/restore`, {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
        });
        toast.add({
            title: 'Workspace restored',
            color: 'success',
        });
        await refreshWorkspace();
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to restore workspace',
            description: getMessage(err, 'Unable to restore workspace'),
            color: 'error',
        });
    } finally {
        isRestoring.value = false;
    }
}

async function addMember() {
    const identifier = newMemberIdentifier.value.trim();
    if (!identifier) return;
    isAddingMember.value = true;
    try {
        await $fetch('/api/admin/workspace/members/upsert', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: {
                workspaceId: workspaceId.value,
                emailOrProviderId: identifier,
                role: newMemberRole.value,
            },
        });
        newMemberIdentifier.value = '';
        toast.add({ title: 'Member added', color: 'success' });
        await refreshWorkspace();
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to add member',
            description: getMessage(err, 'Unable to add member'),
            color: 'error',
        });
    } finally {
        isAddingMember.value = false;
    }
}

async function setGuestAccess(enabled: boolean) {
    isUpdatingGuestAccess.value = true;
    try {
        await $fetch('/api/admin/workspace/guest-access/set', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: {
                workspaceId: workspaceId.value,
                enabled,
            },
        });
        if (workspace.value) {
            workspace.value.guestAccessEnabled = enabled;
        }
        toast.add({
            title: enabled ? 'Guest access enabled' : 'Guest access disabled',
            description: `${workspace.value?.name || 'Workspace'} was updated.`,
            color: 'success',
        });
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to update guest access',
            description: getMessage(err, 'Unable to update guest access'),
            color: 'error',
        });
    } finally {
        isUpdatingGuestAccess.value = false;
    }
}

async function updateMemberRole(member: WorkspaceMemberInfo, role: unknown) {
    if (
        role !== 'owner' &&
        role !== 'editor' &&
        role !== 'viewer'
    ) {
        return;
    }
    if (role === member.role || memberActionUserId.value) return;

    if (member.role === 'owner' && role !== 'owner') {
        const confirmed = await confirm({
            title: 'Change owner role?',
            message: `Change ${member.email || member.userId} from owner to ${role}? At least one owner must remain.`,
            confirmText: 'Change role',
            danger: true,
        });
        if (!confirmed) return;
    }

    memberActionUserId.value = member.userId;
    try {
        await $fetch('/api/admin/workspace/members/set-role', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: {
                workspaceId: workspaceId.value,
                userId: member.userId,
                role,
            },
        });
        toast.add({ title: 'Member role updated', color: 'success' });
        await refreshWorkspace();
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to update role',
            description: getMessage(err, 'Unable to update member role'),
            color: 'error',
        });
        await refreshWorkspace();
    } finally {
        memberActionUserId.value = null;
    }
}

async function removeMember(member: WorkspaceMemberInfo) {
    if (memberActionUserId.value) return;
    const label = member.email || member.userId;
    const confirmed = await confirm({
        title: 'Remove member?',
        message: `Remove ${label} from ${workspace.value?.name || 'this workspace'}? They will lose access immediately.`,
        confirmText: 'Remove member',
        danger: true,
    });
    if (!confirmed) return;

    memberActionUserId.value = member.userId;
    try {
        await $fetch('/api/admin/workspace/members/remove', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: {
                workspaceId: workspaceId.value,
                userId: member.userId,
            },
        });
        toast.add({ title: 'Member removed', color: 'success' });
        await refreshWorkspace();
    } catch (err: unknown) {
        toast.add({
            title: 'Failed to remove member',
            description: getMessage(err, 'Unable to remove member'),
            color: 'error',
        });
    } finally {
        memberActionUserId.value = null;
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
                query: { workspaceId: workspaceId.value },
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
    } catch (err: unknown) {
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
    const confirmed = await confirm({
        title: `Invite to ${workspace.value?.name || 'workspace'}?`,
        message: `Send ${inviteEmail.value.trim()} an invite as ${inviteRole.value}?`,
        confirmText: 'Create invite',
    });
    if (!confirmed) return;

    isCreatingInvite.value = true;
    try {
        const response = await $fetch<{ invite: { id: string; email: string; role: 'owner' | 'editor' | 'viewer'; expiresAt: number; inviteUrl: string; }; }>(
            '/api/admin/workspace/invites/create',
            {
                method: 'POST',
                credentials: 'include',
                headers: ADMIN_HEADERS,
                body: {
                    email: inviteEmail.value,
                    role: inviteRole.value,
                    expiresInSeconds: Math.max(1, inviteTtlHours.value) * 60 * 60,
                    workspaceId: workspaceId.value,
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
            description: `Invite for ${workspace.value?.name || 'workspace'} copied to clipboard.`,
            color: 'success',
        });
        await copyInviteUrl(response.invite.inviteUrl);
    } catch (err: unknown) {
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
    const invite = invites.value.find((item) => item.id === inviteId);
    const confirmed = await confirm({
        title: 'Revoke invite?',
        message: `Revoke the invite for ${invite?.email || 'this person'} to ${workspace.value?.name || 'this workspace'}?`,
        confirmText: 'Revoke invite',
        danger: true,
    });
    if (!confirmed) return;

    try {
        await $fetch('/api/admin/workspace/invites/revoke', {
            method: 'POST',
            credentials: 'include',
            headers: ADMIN_HEADERS,
            body: { inviteId, workspaceId: workspaceId.value },
        });
        invites.value = invites.value.map((invite) =>
            invite.id === inviteId
                ? { ...invite, status: 'revoked' }
                : invite
        );
    } catch (err: unknown) {
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

watch(
    workspaceId,
    () => {
        void refreshWorkspace();
        void loadInvites();
    },
    { immediate: true }
);
</script>
