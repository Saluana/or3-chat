<template>
    <div class="space-y-8">
        <div>
            <h2 class="text-2xl font-semibold mb-1">Workspace</h2>
            <p class="text-sm opacity-70">
                Manage your workspace and team members.
            </p>
        </div>

        <div v-if="pending" class="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
            <div class="lg:col-span-1 h-64 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
            <div class="lg:col-span-2 h-96 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
        </div>

        <div v-else-if="errorMessage" class="p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <div class="text-sm font-semibold">Failed to load workspace</div>
            <div class="text-sm opacity-70 mt-1">{{ errorMessage }}</div>
            <div class="mt-3">
                <UButton size="xs" icon="i-heroicons-arrow-path" @click="refresh">
                    Retry
                </UButton>
            </div>
        </div>

        <div v-else-if="workspace" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
             <!-- Info Card -->
            <div class="lg:col-span-1 p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] h-fit">
                <h3 class="text-lg font-medium mb-4">Details</h3>
                <div class="space-y-4 text-sm">
                    <div>
                        <div class="text-xs font-bold uppercase opacity-50 tracking-wider mb-1">Name</div>
                        <div class="font-medium text-lg">{{ workspace.name }}</div>
                    </div>
                    <div>
                        <div class="text-xs font-bold uppercase opacity-50 tracking-wider mb-1">ID</div>
                        <div class="font-mono text-xs p-1 bg-[var(--md-surface-container-highest)] rounded select-all">{{ workspace.id }}</div>
                    </div>
                    <div>
                        <div class="text-xs font-bold uppercase opacity-50 tracking-wider mb-1">Your Role</div>
                        <UBadge color="primary" variant="subtle">{{ role }}</UBadge>
                    </div>

                    <div class="pt-4 border-t border-[var(--md-outline-variant)]">
                        <div class="flex items-center justify-between mb-2">
                            <span class="font-medium">Guest Access</span>
                            <UBadge :color="guestAccessEnabled ? 'success' : 'neutral'" variant="subtle">
                                {{ guestAccessEnabled ? 'Enabled' : 'Disabled' }}
                            </UBadge>
                        </div>
                        <UButton
                            size="xs"
                            block
                            :color="guestAccessEnabled ? 'neutral' : 'primary'"
                            :variant="guestAccessEnabled ? 'soft' : 'solid'"
                            :disabled="!isOwner"
                            @click="toggleGuestAccess"
                        >
                            {{ guestAccessEnabled ? 'Disable Guest Access' : 'Enable Guest Access' }}
                        </UButton>
                    </div>
                </div>
            </div>

            <!-- Members Card -->
            <div class="lg:col-span-2 p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                 <div class="flex items-center justify-between mb-6">
                    <h3 class="text-lg font-medium">Team Members</h3>
                    <div class="text-sm opacity-60">{{ members.length }} active</div>
                 </div>

                 <div v-if="isOwner" class="mb-6 p-4 rounded bg-[var(--md-surface-container-low)] border border-[var(--md-outline-variant)]/50">
                    <div class="text-xs font-bold uppercase opacity-60 mb-3">Invite New Member</div>
                    <div class="flex flex-col md:flex-row gap-2">
                         <div class="flex-1">
                            <UInput
                                v-model="newMemberId"
                                size="sm"
                                placeholder="Email or Provider ID"
                                icon="i-heroicons-user-plus"
                            />
                        </div>
                        <div class="w-32">
                             <USelectMenu
                                v-model="newMemberRole"
                                size="sm"
                                :options="roleOptions"
                            />
                        </div>
                        <div class="md:w-40">
                             <UInput
                                v-model="newMemberProvider"
                                size="sm"
                                placeholder="Provider (Optional)"
                            />
                        </div>
                        <UButton size="sm" @click="addMember" color="primary">Add</UButton>
                    </div>
                 </div>

                <div v-if="members.length === 0" class="text-sm opacity-70 text-center py-8">
                    No members found.
                </div>

                <div v-else class="space-y-px bg-[var(--md-outline-variant)]/30 rounded overflow-hidden">
                    <div
                        v-for="member in members"
                        :key="member.userId"
                        class="flex flex-col md:flex-row md:items-center justify-between p-3 gap-3 bg-[var(--md-surface)] hover:bg-[var(--md-surface-container-lowest)] transition-colors"
                    >
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] flex items-center justify-center text-xs font-bold">
                                {{ (member.email || member.userId).substring(0, 2).toUpperCase() }}
                            </div>
                            <div>
                                 <div class="font-medium text-sm">{{ member.email || member.userId }}</div>
                                <div class="opacity-60 text-xs font-mono">{{ member.userId }}</div>
                            </div>
                        </div>

                         <div class="flex items-center gap-2 self-end md:self-auto">
                            <div v-if="!isOwner" class="text-sm font-medium px-2">{{ member.role }}</div>
                            <template v-else>
                                <USelectMenu
                                    v-model="memberRoles[member.userId]"
                                    size="xs"
                                    :options="roleOptions"
                                    class="w-24"
                                />
                                <UButton
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    @click="updateRole(member.userId)"
                                    :disabled="memberRoles[member.userId] === member.role"
                                >
                                    Save
                                </UButton>
                                <div class="w-px h-4 bg-[var(--md-outline-variant)] mx-1"></div>
                                <UButton
                                    size="xs"
                                    color="error"
                                    variant="ghost"
                                    icon="i-heroicons-trash"
                                    @click="removeMember(member.userId)"
                                />
                            </template>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { formatAdminError } from '~/composables/admin/formatAdminError';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useAdminWorkspace } from '~/composables/admin/useAdminData';

definePageMeta({
    layout: 'admin',
});

const { data, error, refresh, status } = useAdminWorkspace();

const errorMessage = computed(() =>
    error.value ? formatAdminError(error.value) : null
);
const hasWorkspace = computed(() => Boolean(data.value?.workspace?.id));
const pending = computed(() => !errorMessage.value && !hasWorkspace.value);
const workspace = computed(() => data.value?.workspace);
const role = computed(() => data.value?.role);
const members = computed(() => data.value?.members ?? []);
const guestAccessEnabled = computed(() => data.value?.guestAccessEnabled ?? false);
const isOwner = computed(() => role.value === 'owner');

const roleOptions = ['owner', 'editor', 'viewer'];
const memberRoles = reactive<Record<string, string>>({});
const newMemberId = ref('');
const newMemberRole = ref('editor');
const newMemberProvider = ref('');

watch(
    () => members.value,
    (next) => {
        for (const member of next) {
            memberRoles[member.userId] = member.role;
        }
    },
    { immediate: true }
);

async function addMember() {
    if (!isOwner.value || !newMemberId.value.trim()) return;
    await $fetch('/api/admin/workspace/members/upsert', {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: {
            emailOrProviderId: newMemberId.value.trim(),
            role: newMemberRole.value,
            provider: newMemberProvider.value.trim() || undefined,
        },
    });
    newMemberId.value = '';
    await refresh();
}

async function updateRole(userId: string) {
    if (!isOwner.value) return;
    const roleValue = memberRoles[userId];
    await $fetch('/api/admin/workspace/members/set-role', {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: { userId, role: roleValue },
    });
    await refresh();
}

async function removeMember(userId: string) {
    if (!isOwner.value) return;
    if (!confirm('Remove member from workspace?')) return;
    await $fetch('/api/admin/workspace/members/remove', {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: { userId },
    });
    await refresh();
}

async function toggleGuestAccess() {
    if (!isOwner.value) return;
    const next = !guestAccessEnabled.value;
    await $fetch('/api/admin/workspace/guest-access/set', {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: { enabled: next },
    });
    await refresh();
}
</script>
