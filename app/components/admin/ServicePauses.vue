<template>
    <section id="pauses" aria-labelledby="pauses-heading" class="space-y-3 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-4">
        <div>
            <h2 id="pauses-heading" class="text-lg font-semibold">Service pauses</h2>
            <p class="text-sm opacity-70">Stop accepting one kind of new work without taking the service offline. Each change needs a reason and is recorded in Activity.</p>
        </div>
        <UAlert v-if="loadError" color="error" title="Pause state unavailable" :description="loadError" />
        <UAlert v-else-if="state && !state.available" color="error" title="Pause policy unreadable"
            description="New uploads, background jobs, registrations and purchases are refused until it is replaced. Saving any pause rewrites it." />
        <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>
        <ul v-if="state" class="divide-y divide-[var(--md-outline-variant)]">
            <li v-for="kind in kinds" :key="kind.kind" class="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                    <div class="font-medium">{{ kind.label }}</div>
                    <div class="text-sm opacity-70">{{ kind.description }}</div>
                    <div v-if="current(kind.kind)?.active" class="mt-1 text-sm">
                        <UBadge color="warning" variant="soft">Paused</UBadge>
                        since {{ formatTime(current(kind.kind)!.startedAt) }} · {{ current(kind.kind)!.expiresAt ? `until ${formatTime(current(kind.kind)!.expiresAt)}` : 'no expiry' }}
                    </div>
                </div>
                <UButton :color="current(kind.kind)?.active ? 'primary' : 'neutral'" variant="soft" class="shrink-0" @click="open(kind.kind)">
                    {{ current(kind.kind)?.active ? 'Resume' : 'Pause' }}
                </UButton>
            </li>
        </ul>

        <AppModal v-model:open="dialogOpen" :title="dialogTitle" description="Deployment-wide">
            <div class="space-y-3 text-sm">
                <p>{{ effect }}</p>
                <template v-if="!resuming">
                    <UCheckbox v-model="indefinite" label="No expiry" :disabled="saving" />
                    <UFormField v-if="!indefinite" label="Ends" required>
                        <UInput v-model="expires" type="datetime-local" :disabled="saving" />
                    </UFormField>
                </template>
                <UFormField label="Reason" required :hint="`${reason.trim().length}/500`">
                    <UTextarea v-model="reason" :maxlength="500" :rows="3" autoresize class="w-full" :disabled="saving" />
                </UFormField>
                <UAlert v-if="saveError" color="error" :title="saveError" />
            </div>
            <template #footer>
                <UButton color="neutral" variant="ghost" :disabled="saving" @click="dialogOpen = false">Cancel</UButton>
                <UButton color="primary" :loading="saving" :disabled="saving || !valid" @click="save">{{ resuming ? 'Resume' : 'Pause' }}</UButton>
            </template>
        </AppModal>
    </section>
</template>

<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
import { formatTime, newOperationId } from '~/utils/admin/customer-display';

type Kind = 'uploads' | 'jobs' | 'registrations' | 'purchases';
interface PauseState { available: boolean; revision: string; pauses: Array<{ kind: Kind; active: boolean; startedAt: number; expiresAt: number | null }> }
const billingEnabled = useRuntimeConfig().public.hostedBillingEnabled === true;
const kinds = computed(() => [
    { kind: 'uploads' as const, label: 'New uploads', description: 'Refuse new file uploads. Downloads and uploads already admitted continue; issued upload links work until they expire.' },
    { kind: 'jobs' as const, label: 'New background jobs', description: 'Refuse new background jobs. Running jobs continue; foreground chat is unaffected.' },
    { kind: 'registrations' as const, label: 'New registrations', description: 'Refuse new accounts. Existing users still sign in; registration mode applies again after resuming.' },
    ...(billingEnabled ? [{ kind: 'purchases' as const, label: 'New purchases', description: 'Refuse new Checkout sessions. Sessions already opened can still complete at Stripe; billing management continues.' }] : []),
]);
const state = ref<PauseState | null>(null);
const loadError = ref('');
const dialogOpen = ref(false);
const selected = ref<Kind>('uploads');
const indefinite = ref(true);
const expires = ref('');
const reason = ref('');
const saving = ref(false);
const saveError = ref('');
const announcement = ref('');
let operationId: string | null = null;
const { getMessage } = useApiError();

const current = (kind: Kind) => state.value?.pauses.find(pause => pause.kind === kind);
const resuming = computed(() => Boolean(current(selected.value)?.active));
const label = computed(() => kinds.value.find(kind => kind.kind === selected.value)?.label ?? '');
const dialogTitle = computed(() => `${resuming.value ? 'Resume' : 'Pause'} ${label.value.toLowerCase()}`);
const effect = computed(() => kinds.value.find(kind => kind.kind === selected.value)?.description ?? '');
const expiresAt = computed(() => indefinite.value || resuming.value ? null : new Date(expires.value).getTime());
const valid = computed(() => reason.value.trim().length > 0 && reason.value.trim().length <= 500 && (expiresAt.value === null || expiresAt.value > Date.now()));

async function load() {
    try { state.value = await $fetch<PauseState>('/api/admin/system/pauses', { credentials: 'include' }); loadError.value = ''; }
    catch (error) { loadError.value = getMessage(error) || 'Try again.'; }
}
function open(kind: Kind) {
    selected.value = kind;
    indefinite.value = true;
    const hour = new Date(Date.now() + 3_600_000);
    expires.value = new Date(hour.getTime() - hour.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    saveError.value = '';
    operationId = null;
    dialogOpen.value = true;
}
async function save() {
    if (!state.value) return;
    saving.value = true;
    saveError.value = '';
    operationId ??= newOperationId();
    try {
        await $fetch('/api/admin/system/pauses', {
            method: 'POST', credentials: 'include', headers: { 'x-or3-admin-intent': 'admin' },
            body: { operationId, kind: selected.value, active: !resuming.value, expiresAt: expiresAt.value, reason: reason.value.trim(), expectedRevision: state.value.revision },
        });
        announcement.value = `${dialogTitle.value}: saved.`;
        dialogOpen.value = false;
        reason.value = '';
        await load();
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // A 409 means another administrator changed pauses (or this operation already started): reload before retrying.
        if (status === 409) { operationId = null; await load(); }
        saveError.value = getMessage(error) || 'Not saved.';
    } finally { saving.value = false; }
}
onMounted(load);
</script>
