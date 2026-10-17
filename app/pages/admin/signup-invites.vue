<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-semibold">Signup invites</h1>
            <p class="text-sm opacity-70">Each recipient gets their own private workspace.</p>
        </div>
        <UAlert
            v-if="registrationMode === 'open'"
            color="neutral"
            variant="soft"
            role="status"
            title="Invites are optional"
            description="Registration is open. New users can sign up without an invitation."
        />
        <UCard>
            <UForm :state="form" class="space-y-4" @submit="createInvite">
                <div>
                    <label for="signup-email" class="block text-sm mb-1">Recipient email</label>
                    <UInput id="signup-email" v-model="form.email" type="email" required maxlength="320" class="w-full" />
                </div>
                <div>
                    <label for="signup-expiry" class="block text-sm mb-1">Expires in hours</label>
                    <UInput id="signup-expiry" v-model="form.hours" type="number" min="1" max="720" required />
                </div>
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
                <p class="text-sm">Copy this invitation now. It cannot be retrieved again.</p>
                <label for="signup-link" class="block text-sm">Invite link ({{ linkOrigin }})</label>
                <UTextarea id="signup-link" :model-value="created.link" readonly :rows="3" class="w-full" />
                <UButton color="neutral" variant="soft" @click="copy(created.link)">Copy link</UButton>
                <details>
                    <summary class="cursor-pointer text-sm">Invite token for a separately hosted Chat</summary>
                    <UTextarea aria-label="Signup invite token" :model-value="created.token" readonly :rows="3" class="mt-2 w-full" />
                    <UButton color="neutral" variant="soft" class="mt-2" @click="copy(created.token)">Copy token</UButton>
                </details>
            </div>
        </UCard>
        <UCard>
            <div class="flex justify-between items-center gap-3 mb-3">
                <h2 class="text-lg font-medium">Invitation history</h2>
                <UButton color="neutral" variant="soft" :loading="loading" @click="refreshHistory">Refresh</UButton>
            </div>
            <p v-if="listError" role="alert" class="text-sm">{{ listError }}</p>
            <p v-else-if="!invites.length && !loading" class="text-sm opacity-70">No invitations.</p>
            <ul class="space-y-3">
                <li v-for="invite in invites" :key="invite.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--md-outline-variant)] pb-3">
                    <div class="min-w-0 text-sm">
                        <p class="break-all font-medium">{{ invite.email }}</p>
                        <p>{{ invite.status }} · Expires {{ new Date(invite.expires_at).toLocaleString() }}</p>
                        <p class="opacity-70">Created by {{ invite.created_by_admin }}</p>
                    </div>
                    <UButton v-if="invite.status === 'pending'" color="error" variant="soft" :loading="revoking === invite.id" :disabled="!!revoking" @click="revoke(invite.id)">Revoke</UButton>
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

definePageMeta({ layout: 'admin', middleware: ['admin-auth'] });
const form = reactive({ email: '', hours: 72 });
const creating = ref(false);
const created = ref<{ id: string; link: string; token: string } | null>(null);
const message = ref('');
const inviteSetupRequired = ref(false);
const registrationMode = ref<RegistrationMode | null>(null);
const invites = ref<SignupInviteSummary[]>([]);
const loading = ref(false);
const listError = ref('');
const cursor = ref<string | undefined>();
const nextCursor = ref<string | null>(null);
const revoking = ref<string | null>(null);
const linkOrigin = computed(() => created.value ? new URL(created.value.link).origin : '');

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
    finally { loading.value = false; }
}
function refreshHistory() { return load(); }
async function createInvite() {
    if (creating.value) return;
    creating.value = true;
    message.value = '';
    inviteSetupRequired.value = false;
    created.value = null;
    try {
        const result = await $fetch<{ invite: { id: string; token: string; inviteUrl: string } }>('/api/admin/signup-invites/create', {
            method: 'POST', headers: ADMIN_HEADERS, body: { email: form.email.trim(), expiresInSeconds: Number(form.hours) * 3600 },
        });
        created.value = { id: result.invite.id, link: new URL(result.invite.inviteUrl, window.location.origin).href, token: result.invite.token };
        await load();
    } catch (error) {
        if (errorContains(error, 'Invite token secret not configured')) {
            inviteSetupRequired.value = true;
        } else {
            message.value = parseErrorMessage(error, 'Unable to create invitation.') + ' If the response was lost, refresh history and revoke the pending invitation before creating a replacement.';
        }
    } finally { creating.value = false; }
}
async function revoke(id: string) {
    revoking.value = id;
    message.value = '';
    inviteSetupRequired.value = false;
    try {
        await $fetch('/api/admin/signup-invites/revoke', { method: 'POST', headers: ADMIN_HEADERS, body: { id } });
        if (created.value?.id === id) created.value = null;
        await load(cursor.value);
    } catch (error) { message.value = parseErrorMessage(error, 'Unable to revoke invitation.'); }
    finally { revoking.value = null; }
}
async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); message.value = 'Copied.'; }
    catch { message.value = 'Clipboard unavailable. Select and copy the text above.'; }
}
onMounted(() => { void load(); });
</script>
