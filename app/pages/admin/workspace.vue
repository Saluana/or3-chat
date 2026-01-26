<template>
    <div class="space-y-4">
        <UCard v-if="workspace">
            <template #header>
                <h2 class="text-lg font-semibold">Workspace</h2>
            </template>
            <div class="text-sm space-y-1">
                <div>ID: <span class="font-medium">{{ workspace.id }}</span></div>
                <div>Name: <span class="font-medium">{{ workspace.name }}</span></div>
                <div>Role: <span class="font-medium">{{ role }}</span></div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <h3 class="text-base font-semibold">Members</h3>
            </template>
            <div v-if="isOwner" class="mb-4 space-y-2 text-sm">
                <div class="font-medium">Add Member</div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <UInput
                        v-model="newMemberId"
                        size="sm"
                        placeholder="email or provider id"
                    />
                    <USelectMenu
                        v-model="newMemberRole"
                        size="sm"
                        :options="roleOptions"
                    />
                    <UInput
                        v-model="newMemberProvider"
                        size="sm"
                        placeholder="provider (optional)"
                    />
                </div>
                <UButton size="xs" @click="addMember">Add Member</UButton>
            </div>
            <div v-if="members.length === 0" class="text-sm opacity-70">
                No members found.
            </div>
            <div v-else class="space-y-2 text-sm">
                <div
                    v-for="member in members"
                    :key="member.userId"
                    class="flex items-center justify-between border-b border-[var(--md-outline-variant)] pb-2"
                >
                    <div>
                        <div class="font-medium">{{ member.email || member.userId }}</div>
                        <div class="opacity-70">{{ member.userId }}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <USelectMenu
                            v-if="isOwner"
                            v-model="memberRoles[member.userId]"
                            size="sm"
                            :options="roleOptions"
                        />
                        <div v-else class="font-medium capitalize">{{ member.role }}</div>
                        <UButton
                            v-if="isOwner"
                            size="xs"
                            @click="updateRole(member.userId)"
                        >
                            Update
                        </UButton>
                        <UButton
                            v-if="isOwner"
                            size="xs"
                            color="error"
                            variant="soft"
                            @click="removeMember(member.userId)"
                        >
                            Remove
                        </UButton>
                    </div>
                </div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <h3 class="text-base font-semibold">Guest Access</h3>
            </template>
            <div class="text-sm flex items-center gap-2">
                <div>
                    Guests are
                    <span class="font-medium">
                        {{ guestAccessEnabled ? 'enabled' : 'disabled' }}
                    </span>
                </div>
                <UButton
                    size="xs"
                    :disabled="!isOwner"
                    @click="toggleGuestAccess"
                >
                    {{ guestAccessEnabled ? 'Disable' : 'Enable' }}
                </UButton>
            </div>
        </UCard>
    </div>
</template>

<script setup lang="ts">
definePageMeta({
    layout: 'admin',
});

type WorkspaceResponse = {
    workspace: { id: string; name: string };
    role: string;
    members: Array<{ userId: string; email?: string; role: string }>;
    guestAccessEnabled: boolean;
};

const { data, refresh } = await useFetch<WorkspaceResponse>('/api/admin/workspace');

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
        headers: { 'x-or3-admin-intent': 'admin' },
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
        headers: { 'x-or3-admin-intent': 'admin' },
        body: { userId, role: roleValue },
    });
    await refresh();
}

async function removeMember(userId: string) {
    if (!isOwner.value) return;
    if (!confirm('Remove member from workspace?')) return;
    await $fetch('/api/admin/workspace/members/remove', {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
        body: { userId },
    });
    await refresh();
}

async function toggleGuestAccess() {
    if (!isOwner.value) return;
    const next = !guestAccessEnabled.value;
    await $fetch('/api/admin/workspace/guest-access/set', {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
        body: { enabled: next },
    });
    await refresh();
}
</script>
