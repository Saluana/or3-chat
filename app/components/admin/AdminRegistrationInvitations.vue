<template>
    <div class="space-y-6">
        <div>
            <h2 class="text-lg font-semibold">Invitations</h2>
            <p class="text-sm opacity-70">Invite someone to create a new account. Each recipient gets their own private workspace.</p>
            <p class="text-sm opacity-70">To add someone to an existing workspace, use <strong>Team invites</strong> on that workspace instead. <NuxtLink to="/admin/workspaces" class="underline">Open Workspaces</NuxtLink></p>
        </div>
        <UAlert
            v-if="registrationMode === 'open'"
            color="neutral"
            variant="soft"
            role="status"
            title="Invites are optional"
            description="Registration is open. New users can sign up without an invitation."
        />
        <UAlert
            v-if="registrationMode === 'disabled'"
            color="neutral"
            variant="soft"
            title="Registration is closed"
            description="New accounts cannot be created, even with an invitation. Existing users can still sign in."
        />
        <UCard>
            <UForm :state="form" class="space-y-4" @submit="createInvite">
                <div>
                    <label for="signup-email" class="block text-sm mb-1">Recipient email</label>
                    <UInput id="signup-email" v-model="form.email" type="email" required maxlength="320" class="w-full" />
                </div>
                <div>
                    <label for="signup-expiry" class="block text-sm mb-1">Expires after</label>
                    <USelect id="signup-expiry" v-model="form.hours" :items="expiryOptions" class="w-48" />
                </div>
                <p class="text-sm opacity-70">OR3 doesn't send emails. After you create the invite, copy the link or code and send it to the recipient yourself. It only works with the email address above.</p>
                <UButton type="submit" :loading="creating" :disabled="creating">Create invite</UButton>
            </UForm>
            <UAlert v-if="inviteSetupRequired" role="alert" color="warning" variant="soft" title="Invitations need one-time setup" class="mt-3">
                <template #description>
                    <p>No invitation was created. Complete these steps on the server:</p>
                    <ol class="mt-2 list-decimal space-y-1 pl-5">
                        <li>Set <code class="break-all">OR3_AUTH_INVITE_TOKEN_SECRET</code> to a long, random secret in the server environment. For local development, add it to <code>.env</code>.</li>
                        <li>Restart OR3, then select <strong>Create invite</strong> again.</li>
                    </ol>
                    <NuxtLink to="/documentation/cloud/environment-reference#invite-signing-setup" target="_blank" rel="noopener noreferrer" class="mt-3 inline-block underline">View invite setup instructions</NuxtLink>
                </template>
            </UAlert>
            <p v-else-if="message" role="alert" class="mt-3 text-sm">{{ message }}</p>
            <div v-if="created" class="mt-4 space-y-3">
                <p class="text-sm">Send this to <strong class="break-all">{{ created.email }}</strong>. It only works with that email address and expires {{ formatDateTime(created.expiresAt) }}. Copy it now; it cannot be shown again.</p>
                <div class="flex flex-wrap items-end gap-3">
                    <div>
                        <label for="signup-code" class="mb-1 block text-sm">Invite code</label>
                        <UInput id="signup-code" :model-value="created.code" readonly class="w-40" :ui="{ base: 'font-mono text-lg tracking-widest' }" />
                    </div>
                    <UButton color="neutral" variant="soft" :icon="copied === 'code' ? 'i-lucide-check' : 'i-lucide-copy'" @click="copy('code', created.code)">{{ copied === 'code' ? 'Code copied' : 'Copy code' }}</UButton>
                </div>
                <label for="signup-link" class="block text-sm">Invite link</label>
                <UTextarea id="signup-link" :model-value="created.link" readonly :rows="2" class="w-full" />
                <UButton color="neutral" variant="soft" :icon="copied === 'link' ? 'i-lucide-check' : 'i-lucide-copy'" @click="copy('link', created.link)">{{ copied === 'link' ? 'Link copied' : 'Copy link' }}</UButton>
                <p v-if="copyError" class="text-sm text-[var(--md-error)]">{{ copyError }}</p>
                <span class="sr-only" role="status" aria-live="polite">{{ copied ? `${copied === 'code' ? 'Invite code' : 'Invite link'} copied to clipboard.` : '' }}</span>
            </div>
        </UCard>
        <UCard>
            <div class="flex justify-between items-center gap-3 mb-3">
                <h2 class="text-lg font-medium">Invitation history</h2>
                <UButton color="neutral" variant="soft" :loading="loading" @click="refreshHistory">Refresh</UButton>
            </div>
            <p v-if="listError" role="alert" class="text-sm">{{ listError }}</p>
            <p v-else-if="!hasLoaded" class="text-sm opacity-70">Loading invitations…</p>
            <p v-else-if="!invites.length" class="text-sm opacity-70">No invitations yet.</p>
            <ul class="space-y-3">
                <li v-for="invite in invites" :key="invite.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--md-outline-variant)] pb-3">
                    <div class="min-w-0 text-sm">
                        <p class="flex flex-wrap items-center gap-2">
                            <span class="break-all font-medium">{{ invite.email }}</span>
                            <UBadge :color="statusColor(invite.status)" variant="soft" size="sm">{{ statusLabel(invite.status) }}</UBadge>
                        </p>
                        <p>{{ statusDetail(invite) }}</p>
                        <p class="opacity-70">Invited {{ formatDateTime(invite.created_at) }} by {{ invite.created_by_admin }}</p>
                    </div>
                    <UButton v-if="invite.status === 'pending'" color="error" variant="soft" :loading="revoking === invite.id" :disabled="!!revoking" @click="revoke(invite)">Revoke</UButton>
                </li>
            </ul>
            <div class="mt-3 flex gap-2">
                <UButton v-if="cursor" color="neutral" variant="soft" :disabled="loading" @click="refreshHistory">Newest</UButton>
                <UButton v-if="nextCursor" color="neutral" variant="soft" :disabled="loading" @click="load(nextCursor)">Older</UButton>
            </div>
        </UCard>
    </div>
</template>

<script setup lang="ts">
import type { SignupInviteSummary } from '~~/server/auth/store/types';
import type { RegistrationMode } from '~~/server/auth/registration';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { errorContains, parseErrorMessage } from '~/utils/admin/parse-error';

const toast = useToast();
const { confirm } = useConfirmDialog();

const expiryOptions = [
    { label: '1 day', value: 24 },
    { label: '3 days', value: 72 },
    { label: '7 days', value: 168 },
    { label: '30 days', value: 720 },
];

const form = reactive({ email: '', hours: 72 });
const creating = ref(false);
const created = ref<{ id: string; email: string; expiresAt: number; link: string; code: string } | null>(null);
const message = ref('');
const copied = ref<'code' | 'link' | null>(null);
const copyError = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const inviteSetupRequired = ref(false);
const registrationMode = ref<RegistrationMode | null>(null);
const invites = ref<SignupInviteSummary[]>([]);
const loading = ref(false);
const hasLoaded = ref(false);
const listError = ref('');
const cursor = ref<string | undefined>();
const nextCursor = ref<string | null>(null);
const revoking = ref<string | null>(null);

function formatDateTime(value: number | null | undefined) {
    return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
function statusLabel(status: SignupInviteSummary['status']) {
    return status.charAt(0).toUpperCase() + status.slice(1);
}
function statusColor(status: SignupInviteSummary['status']) {
    return status === 'accepted' ? 'success' : status === 'pending' ? 'info' : 'neutral';
}
function statusDetail(invite: SignupInviteSummary) {
    if (invite.status === 'accepted') return `Accepted ${formatDateTime(invite.accepted_at)}`;
    if (invite.status === 'revoked') return `Revoked ${formatDateTime(invite.revoked_at)}`;
    if (invite.status === 'expired') return `Expired ${formatDateTime(invite.expires_at)}`;
    return `Expires ${formatDateTime(invite.expires_at)}`;
}

async function load(target?: string) {
    loading.value = true;
    listError.value = '';
    registrationMode.value = null;
    try {
        const result = await $fetch<{ invites: SignupInviteSummary[]; next_cursor: string | null; registrationMode: RegistrationMode }>('/api/admin/signup-invites/list', { query: { limit: 50, cursor: target } });
        registrationMode.value = result.registrationMode;
        invites.value = result.invites;
        nextCursor.value = result.next_cursor;
        cursor.value = target;
    } catch (error) { listError.value = parseErrorMessage(error, 'Unable to load invitations.'); }
    finally { loading.value = false; hasLoaded.value = true; }
}
function refreshHistory() { return load(); }
async function createInvite() {
    if (creating.value) return;
    creating.value = true;
    message.value = '';
    copyError.value = '';
    copied.value = null;
    inviteSetupRequired.value = false;
    created.value = null;
    try {
        const result = await $fetch<{ invite: { id: string; email: string; expires_at: number; token: string; inviteUrl: string } }>('/api/admin/signup-invites/create', {
            method: 'POST', headers: ADMIN_HEADERS, body: { email: form.email.trim(), expiresInSeconds: Number(form.hours) * 3600 },
        });
        created.value = {
            id: result.invite.id,
            email: result.invite.email,
            expiresAt: result.invite.expires_at,
            link: new URL(result.invite.inviteUrl, window.location.origin).href,
            code: result.invite.token.replace(/^(.{4})(.{4})$/, '$1-$2'),
        };
        form.email = '';
        await load();
    } catch (error) {
        if (errorContains(error, 'Invite token secret not configured')) {
            inviteSetupRequired.value = true;
        } else {
            message.value = parseErrorMessage(error, 'Unable to create invitation.') + ' If the response was lost, refresh history and revoke the pending invitation before creating a replacement.';
        }
    } finally { creating.value = false; }
}
async function revoke(invite: SignupInviteSummary) {
    const confirmed = await confirm({
        title: 'Revoke invitation',
        message: `The invitation for ${invite.email} will stop working. This can't be undone.`,
        confirmText: 'Revoke',
        danger: true,
    });
    if (!confirmed) return;
    revoking.value = invite.id;
    message.value = '';
    inviteSetupRequired.value = false;
    try {
        await $fetch('/api/admin/signup-invites/revoke', { method: 'POST', headers: ADMIN_HEADERS, body: { id: invite.id } });
        if (created.value?.id === invite.id) created.value = null;
        toast.add({ title: 'Invitation revoked', description: invite.email, color: 'success' });
        await load(cursor.value);
    } catch (error) { message.value = parseErrorMessage(error, 'Unable to revoke invitation.'); }
    finally { revoking.value = null; }
}
async function copy(kind: 'code' | 'link', value: string) {
    copyError.value = '';
    clearTimeout(copiedTimer);
    try {
        await navigator.clipboard.writeText(value);
        copied.value = kind;
        copiedTimer = setTimeout(() => { copied.value = null; }, 2500);
    } catch {
        copied.value = null;
        copyError.value = 'Clipboard unavailable. Select the text above and copy it manually.';
    }
}
onBeforeUnmount(() => clearTimeout(copiedTimer));
onMounted(() => { void load(); });
</script>
