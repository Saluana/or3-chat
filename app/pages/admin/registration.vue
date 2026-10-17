<template>
    <div class="space-y-6">
        <header>
            <h1 class="text-2xl font-semibold">Registration</h1>
            <p class="mt-1 text-sm opacity-70">Choose who can create an account and manage invitations.</p>
        </header>
        <UTabs v-model="activeTab" :items="tabs" :unmount-on-hide="false" color="neutral" variant="link" class="w-full" aria-label="Registration tabs">
            <template #settings>
                <div class="space-y-5 pt-4">
                    <p v-if="loading" role="status" class="text-sm">Loading registration settings…</p>
                    <UAlert v-else-if="loadError" color="error" variant="soft" role="alert" title="Unable to load registration settings" :description="loadError">
                        <template #actions><UButton color="neutral" variant="outline" @click="loadSettings">Try again</UButton></template>
                    </UAlert>
                    <template v-else-if="settings">
                        <UAlert v-if="settings.restartRequired" color="neutral" variant="soft" role="status" title="Restart required">
                            <template #description>
                                <p>Saved mode: {{ modeLabel(settings.savedMode) }}</p>
                                <p class="mt-1">Restart OR3 to apply this change. Until then, the current mode below stays active.</p>
                                <div class="mt-3 flex flex-wrap gap-3">
                                    <UButton color="neutral" icon="i-lucide-rotate-cw" :loading="restarting" :disabled="!canRestart || saving || restarting" @click="restart">Restart now</UButton>
                                    <UButton to="/admin/system" color="neutral" variant="outline">Go to Operations</UButton>
                                </div>
                                <p v-if="statusData && !canRestart" class="mt-2">Restart from the dashboard is unavailable. Ask the person managing your server to restart OR3.</p>
                            </template>
                        </UAlert>
                        <UCard>
                            <UForm :state="form" class="space-y-5" @submit="saveSettings">
                                <p class="text-sm font-medium">Current mode: {{ modeLabel(settings.currentMode) }}</p>
                                <URadioGroup v-model="form.mode" legend="Registration mode" :items="modes" :disabled="saving || restarting" color="neutral" variant="card" />
                                <p class="text-sm opacity-70">Existing users can still sign in in every mode.</p>
                                <UAlert v-if="saveError" role="alert" color="error" variant="soft" title="Unable to save registration settings" :description="saveError" />
                                <p v-if="needsInviteSetup" class="text-sm">Set up invitations before choosing Invite only.</p>
                                <div class="flex flex-wrap items-center gap-3">
                                    <UButton type="submit" :loading="saving" :disabled="saving || restarting || !hasChanges || needsInviteSetup">Save settings</UButton>
                                    <span v-if="hasChanges" class="text-sm opacity-70">Unsaved changes</span>
                                    <span v-else-if="saved && !settings.restartRequired" role="status" class="text-sm">Settings saved.</span>
                                </div>
                            </UForm>
                        </UCard>
                        <UAlert color="neutral" variant="soft" :title="settings.inviteSigningConfigured ? 'Invitation setup complete' : 'Invitations need one-time setup'">
                            <template #description>
                                <p v-if="settings.inviteSigningConfigured">You can create invitation links in the Invitations tab.</p>
                                <template v-else>
                                    <p>Ask the person managing your server to finish invitation setup, then restart OR3. Invite only becomes available once setup is complete.</p>
                                    <NuxtLink to="/documentation/cloud/environment-reference#invite-signing-setup" target="_blank" rel="noopener noreferrer" class="mt-2 inline-block underline">View invite setup instructions</NuxtLink>
                                </template>
                            </template>
                        </UAlert>
                    </template>
                </div>
            </template>
            <template #invitations><AdminRegistrationInvitations class="pt-4" /></template>
        </UTabs>
    </div>
</template>

<script setup lang="ts">
import type { RegistrationMode } from '~~/server/auth/registration';
import type { RegistrationSettings } from '~/composables/admin/useAdminTypes';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useAdminSystemStatus } from '~/composables/admin/useAdminData';
import { useServerRestart } from '~/composables/admin/useServerRestart';
import { parseErrorMessage } from '~/utils/admin/parse-error';

definePageMeta({ layout: 'admin', middleware: ['admin-auth'] });
const route = useRoute();
const router = useRouter();
const { data: statusData } = useAdminSystemStatus();
const isOwner = computed(() => statusData.value?.session?.role === 'owner');
const allowRestart = computed(() => statusData.value?.status.admin?.allowRestart === true);
const canRestart = computed(() => isOwner.value && allowRestart.value);
const serverRestart = useServerRestart(isOwner, allowRestart);
const restarting = ref(false);
const tabs = [{ label: 'Settings', value: 'settings', slot: 'settings' }, { label: 'Invitations', value: 'invitations', slot: 'invitations' }];
const activeTab = computed({
    get: () => route.query.tab === 'invitations' ? 'invitations' : 'settings',
    set: (value: string | number) => { void router.push({ query: { ...route.query, tab: String(value) } }); },
});
const modes: Array<{ label: string; value: RegistrationMode; description: string }> = [
    { label: 'Open registration', value: 'open', description: 'Anyone can create an account. Invitations are optional.' },
    { label: 'Invite only', value: 'invite_only', description: 'New users need a valid invitation to create an account.' },
    { label: 'Registration closed', value: 'disabled', description: 'No new accounts can be created, even with an invitation.' },
];
const settings = ref<RegistrationSettings | null>(null);
const form = reactive<{ mode: RegistrationMode }>({ mode: 'open' });
const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const loadError = ref('');
const saveError = ref('');
const hasChanges = computed(() => settings.value !== null && form.mode !== settings.value.savedMode);
const needsInviteSetup = computed(() => form.mode === 'invite_only' && settings.value?.inviteSigningConfigured === false);
function modeLabel(mode: RegistrationMode) { return modes.find(item => item.value === mode)!.label; }

async function loadSettings() {
    loading.value = true;
    loadError.value = '';
    try {
        settings.value = await $fetch<RegistrationSettings>('/api/admin/registration');
        form.mode = settings.value.savedMode;
    } catch (error) { loadError.value = parseErrorMessage(error, 'Please try again.'); }
    finally { loading.value = false; }
}
async function saveSettings() {
    if (saving.value || restarting.value || !hasChanges.value || needsInviteSetup.value) return;
    saving.value = true;
    saved.value = false;
    saveError.value = '';
    try {
        settings.value = await $fetch<RegistrationSettings>('/api/admin/registration', { method: 'POST', headers: ADMIN_HEADERS, body: { mode: form.mode } });
        saved.value = true;
    } catch (error) { saveError.value = parseErrorMessage(error, 'Please try again.'); }
    finally { saving.value = false; }
}
async function restart() {
    if (restarting.value || saving.value || !canRestart.value) return;
    restarting.value = true;
    try { await serverRestart.restart(); }
    finally { restarting.value = false; }
}
onMounted(() => { void loadSettings(); });
</script>
