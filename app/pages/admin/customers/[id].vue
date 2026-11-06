<template>
    <div class="space-y-6">
        <nav aria-label="Breadcrumb" class="text-sm opacity-70">
            <NuxtLink to="/admin/customers" class="hover:underline">Customers</NuxtLink>
            <span aria-hidden="true"> › </span>
            <span>{{ customer?.email || userId }}</span>
        </nav>

        <UAlert v-if="loadError" color="error" title="Account could not be loaded" :description="loadError">
            <template #actions><UButton color="neutral" variant="soft" @click="load">Try again</UButton></template>
        </UAlert>
        <div v-else-if="!customer" class="h-24 animate-pulse rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-highest)]" role="status" aria-label="Loading account" />

        <template v-if="customer">
            <header class="space-y-1">
                <h1 class="text-2xl font-semibold break-all">{{ customer.email || customer.userId }}</h1>
                <p class="text-sm opacity-70 break-all">
                    <span v-if="customer.displayName">{{ customer.displayName }} · </span>
                    Account ID <code class="font-mono">{{ customer.userId }}</code>
                    · Created {{ formatTime(customer.createdAt) }}
                </p>
            </header>

            <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>
            <UAlert v-if="notice" :color="notice.tone" :title="notice.title" :description="notice.description" />

                        <div class="card">
                            <h3 class="card-title">Sync</h3>
                            <dl class="facts">
                                <dt>Last server contact</dt><dd>{{ customer.lastContactAt ? formatTime(customer.lastContactAt) : 'Not observed' }}</dd>
                                <dt>Last completed server operation</dt><dd>{{ lastSyncSuccess ? `${formatTime(lastSyncSuccess.lastSuccessAt)} (${lastSyncSuccess.lastSuccessOperation})` : 'Not observed' }}</dd>
                                <dt>Latest recorded failure</dt><dd>{{ lastSyncFailure ? `${formatTime(lastSyncFailure.lastFailureAt)} (${lastSyncFailure.lastFailureCode})` : 'Not observed' }}</dd>
                                <dt>Observation coverage</dt><dd>{{ sync?.status === 'available' ? 'Gateway requests; up to 500 workspaces' : 'Unavailable' }}</dd>
                                <dt v-if="billing">Transport</dt><dd v-if="billing">{{ billing.access.allowed ? 'Allowed' : 'Paused (no Cloud access)' }}</dd>
                            </dl>
                            <p class="mt-2 text-xs opacity-70">Contact is the latest sync cursor write. Completion records a successful server request, including no-op requests; it does not prove every device is up to date or describe offline edits.</p>
                        </div>

            <!-- Hosted billing projection -->
            <template v-if="billingEnabled">
                <UAlert v-if="billingError" color="error" title="Billing details unavailable" :description="billingError" />
                <section v-else-if="billing" aria-labelledby="access-heading" class="space-y-4">
                    <div class="flex flex-col gap-3 rounded-[var(--md-border-radius)] border p-4 sm:flex-row sm:items-center sm:justify-between"
                        :class="billing.access.allowed ? 'border-[var(--md-outline-variant)]' : 'border-[var(--md-error)] bg-[var(--md-error-container)]/30'">
                        <div>
                            <h2 id="access-heading" class="font-semibold">{{ billing.access.allowed ? 'Cloud access: allowed' : 'Cloud access: blocked' }}</h2>
                            <ul v-if="billing.access.blockers.length" class="mt-1 list-disc pl-5 text-sm">
                                <li v-for="blocker in billing.access.blockers" :key="blocker">{{ blockerLabels[blocker] }}</li>
                            </ul>
                            <p v-else class="text-sm opacity-80">{{ sourceLabels[billing.access.source] }}<template v-if="billing.access.expiresAt"> until {{ formatTime(billing.access.expiresAt) }}</template></p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UBadge :color="paymentTone" variant="soft" size="lg">Payment: {{ paymentLabel }}</UBadge>
                            <UBadge :color="billing.access.allowed ? 'success' : 'error'" variant="soft" size="lg">Access: {{ billing.access.allowed ? 'allowed' : 'blocked' }}</UBadge>
                        </div>
                    </div>

                    <div class="grid gap-4 md:grid-cols-3">
                        <div class="card">
                            <h3 class="card-title">Entitlement</h3>
                            <dl class="facts">
                                <dt>Source</dt><dd>{{ billing.account ? sourceLabels[billing.access.source] : 'Cloud not started' }}</dd>
                                <dt>Ends</dt><dd>{{ formatTime(billing.access.expiresAt) }}</dd>
                                <dt>Trial</dt><dd>{{ trialLabel }}</dd>
                                <dt>Trial deadline</dt><dd>{{ formatTime(billing.trial.endsAt) }}</dd>
                            </dl>
                        </div>
                        <div class="card">
                            <h3 class="card-title">Subscription</h3>
                            <dl v-if="billing.account" class="facts">
                                <dt>Stripe status</dt><dd>{{ billing.account.subscriptionStatus || 'None' }}</dd>
                                <dt>Paid through</dt><dd>{{ formatTime(billing.account.paidUntil) }}</dd>
                                <dt>Renewal grace</dt><dd>{{ formatTime(billing.account.renewalGraceUntil) }}</dd>
                                <dt>Cancels at period end</dt><dd>{{ billing.account.cancelAtPeriodEnd ? 'Yes' : 'No' }}</dd>
                                <dt>Last refresh</dt><dd>{{ billing.account.lastReconciledAt ? `${formatTime(billing.account.lastReconciledAt)} (${billing.account.lastReconcileOutcome})` : 'Never' }}</dd>
                            </dl>
                            <p v-else class="text-sm">Cloud not started. No billing record exists, and viewing this page does not create one.</p>
                            <UButton v-if="billing.account" class="mt-3" block color="neutral" variant="soft" :loading="refreshing" :disabled="refreshing" @click="refresh">Refresh from Stripe</UButton>
                        </div>
                        <div class="card">
                            <h3 class="card-title">Storage</h3>
                            <template v-if="billing.storage.status === 'available'">
                                <p class="text-lg font-semibold">{{ formatBytes(billing.storage.value.usedBytes) }}</p>
                                <p class="text-sm opacity-80">{{ billing.access.nominalStorageLimitBytes ? `charged of ${formatBytes(billing.access.nominalStorageLimitBytes)} allowance` : 'charged · no allowance without an entitlement' }}</p>
                                <p v-if="billing.access.bonusBytes" class="text-xs opacity-70">Includes {{ formatBytes(billing.access.bonusBytes) }} support bonus</p>
                                <p v-if="!billing.access.allowed && billing.account" class="text-xs opacity-70">New uploads are refused while access is blocked. Existing files stay available.</p>
                            </template>
                            <p v-else class="text-sm">Storage accounting unavailable. Usage is unknown, not zero.</p>
                        </div>

                    </div>

                    <div v-if="openReviews.length" class="card space-y-3">
                        <h3 class="card-title">Open payment reviews</h3>
                        <ul class="space-y-1 text-sm">
                            <li v-for="review in openReviews" :key="review.id">
                                <span class="font-medium">{{ reviewLabels[review.kind] ?? review.kind }}</span>
                                <span v-if="review.openedAt" class="opacity-70"> · opened {{ formatTime(review.openedAt) }}</span>
                            </li>
                        </ul>
                        <UButton color="primary" @click="openReviewDialog">Resolve review</UButton>
                    </div>

                    <div class="card space-y-2">
                        <h3 class="card-title">Support actions</h3>
                        <p class="text-xs opacity-70">Exceptions are recorded with your reason. They never change Stripe payment facts or the original trial decision, and they never override a review hold.</p>
                        <div class="flex flex-wrap gap-2">
                            <UButton v-for="action in availableActions" :key="action.kind" color="neutral" variant="soft" @click="openAction(action.kind)">{{ action.label }}</UButton>
                        </div>
                        <ul v-if="activeExceptions.length" class="mt-2 list-disc pl-5 text-sm">
                            <li v-for="item in activeExceptions" :key="item">{{ item }}</li>
                        </ul>
                    </div>

                    <div v-if="billing.account" class="card space-y-3">
                        <h3 class="card-title">Storage accounting</h3>
                        <UAlert v-if="storageError" color="error" title="Storage accounting unavailable" :description="`${storageError} Usage is unknown, not zero.`" />
                        <template v-else-if="storage">
                            <dl class="facts max-w-xl">
                                <dt>Charged (admission total)</dt><dd>{{ formatBytes(storage.breakdown.chargedBytes) }}</dd>
                                <dt>Retained files</dt><dd>{{ formatBytes(storage.breakdown.retainedBytes) }}</dd>
                                <dt>Reserved uploads in progress</dt><dd>{{ formatBytes(storage.breakdown.activeReservedBytes) }}</dd>
                                <dt>Reserved by expired upload links</dt><dd>{{ formatBytes(storage.breakdown.expiredReservedBytes) }}</dd>
                                <dt>In deleted workspaces</dt><dd>{{ formatBytes(storage.breakdown.deletedWorkspaceBytes) }}</dd>
                                <dt>Allowance</dt><dd>{{ formatBytes(billing.access.nominalStorageLimitBytes) }}</dd>
                                <dt>Workspace cap</dt><dd>{{ storage.workspaceCapBytes ? formatBytes(storage.workspaceCapBytes) : 'None' }}</dd>
                            </dl>
                            <p class="text-xs opacity-70">Observed {{ formatTime(storage.breakdown.observedAt) }}. Files in Trash are included in retained files. Uploads by members to these workspaces are charged here; each uploader also needs their own Cloud access.</p>
                            <div class="overflow-x-auto">
                                <table class="w-full min-w-[520px] text-sm">
                                    <thead class="text-left"><tr><th scope="col" class="p-2 font-medium">Owned workspace</th><th scope="col" class="p-2 font-medium">Retained</th><th scope="col" class="p-2 font-medium">Reserved</th><th scope="col" class="p-2 font-medium">Charged</th></tr></thead>
                                    <tbody>
                                        <tr v-for="workspace in storage.breakdown.workspaces" :key="workspace.workspaceId" class="border-t border-[var(--md-outline-variant)]">
                                            <td class="p-2">{{ workspace.name }} <UBadge v-if="workspace.deleted" color="warning" variant="soft" size="sm">Deleted</UBadge></td>
                                            <td class="p-2">{{ formatBytes(workspace.retainedBytes) }}</td>
                                            <td class="p-2">{{ formatBytes(workspace.reservedBytes) }}</td>
                                            <td class="p-2">{{ formatBytes(workspace.chargedBytes) }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <form class="flex flex-col gap-2 sm:flex-row sm:items-end" @submit.prevent="diagnose">
                                <UFormField label="Diagnose an upload to">
                                    <USelect v-model="diagnoseWorkspace" :items="storage.breakdown.workspaces.filter(item => !item.deleted).map(item => ({ label: item.name, value: item.workspaceId }))" class="w-56" />
                                </UFormField>
                                <UFormField label="File size (MB)">
                                    <UInput v-model.number="diagnoseMb" type="number" :min="0" :step="1" class="w-32" />
                                </UFormField>
                                <UButton type="submit" color="neutral" variant="soft" :disabled="!diagnoseWorkspace">Check</UButton>
                            </form>
                            <div v-if="explanation" role="status" class="text-sm">
                                <p class="font-medium">{{ explanation.controlling ? `Controlling restriction: ${checkLabels[explanation.controlling]}` : 'No accounting restriction blocks this upload.' }}</p>
                                <ul class="list-disc pl-5">
                                    <li v-for="check in explanation.checks" :key="check.check">{{ checkLabels[check.check] }}: {{ check.status }}<template v-if="check.limitBytes !== undefined"> ({{ formatBytes(check.projectedBytes) }} of {{ formatBytes(check.limitBytes) }})</template></li>
                                </ul>
                                <p class="text-xs opacity-70">The uploader's own access, membership role, file type and size limits and pauses are checked separately when the upload is requested. This preview does not authorize an upload.</p>
                            </div>
                        </template>
                    </div>
                </section>
            </template>
            <UAlert v-else color="neutral" variant="soft" title="Hosted billing is not installed" description="Payment, trial and storage allowance details are not part of this deployment." />

            <section aria-labelledby="workspaces-heading" class="space-y-3">
                <h2 id="workspaces-heading" class="text-lg font-semibold">Workspaces</h2>
                <UAlert v-if="workspaces?.status === 'unavailable'" color="neutral" variant="soft" title="Workspace inspection unavailable" description="The sync provider does not support this read." />
                <UAlert v-else-if="workspaces?.status === 'error'" color="error" title="Workspaces could not be read" description="Identity and billing details above remain accurate." />
                <div v-else-if="workspaces?.status === 'available'" class="overflow-x-auto rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)]">
                    <table class="w-full min-w-[640px] text-sm">
                        <thead class="bg-[var(--md-surface-container-low)] text-left">
                            <tr>
                                <th scope="col" class="p-3 font-medium">Workspace</th>
                                <th scope="col" class="p-3 font-medium">Role</th>
                                <th scope="col" class="p-3 font-medium">Members</th>
                                <th scope="col" class="p-3 font-medium">State</th>
                                <th scope="col" class="p-3 font-medium">Last server contact</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="workspace in workspaces.value" :key="workspace.id" class="border-t border-[var(--md-outline-variant)]">
                                <td class="p-3">
                                    <NuxtLink :to="`/admin/workspaces/${encodeURIComponent(workspace.id)}`" class="font-medium hover:underline">{{ workspace.name }}</NuxtLink>
                                    <div class="font-mono text-xs opacity-60 break-all">{{ workspace.id }}</div>
                                </td>
                                <td class="p-3 capitalize">{{ workspace.role }}</td>
                                <td class="p-3">{{ workspace.memberCount }}</td>
                                <td class="p-3">
                                    <UBadge v-if="workspace.deleted" color="warning" variant="soft">Deleted · retained</UBadge>
                                    <span v-else>Active</span>
                                </td>
                                <td class="p-3">{{ workspace.lastContactAt ? formatTime(workspace.lastContactAt) : 'Not observed' }}</td>
                            </tr>
                            <tr v-if="!workspaces.value.length"><td colspan="5" class="p-3 opacity-70">No workspaces or memberships.</td></tr>
                        </tbody>
                    </table>
                    <p class="p-3 text-xs opacity-70">Owned workspaces, including deleted ones, count toward the owner's storage. Workspace content is never shown here.</p>
                </div>
            </section>

            <section v-if="billingEnabled && billing" aria-labelledby="history-heading" class="space-y-3">
                <h2 id="history-heading" class="text-lg font-semibold">Support history</h2>
                <ul v-if="history.length" class="divide-y divide-[var(--md-outline-variant)] rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)]">
                    <li v-for="item in history" :key="item.key" class="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:justify-between">
                        <div>
                            <div class="font-medium">{{ item.title }}</div>
                            <div v-if="item.detail" class="opacity-80">{{ item.detail }}</div>
                        </div>
                        <time class="shrink-0 opacity-70">{{ formatTime(item.at) }}</time>
                    </li>
                </ul>
                <p v-else class="text-sm opacity-70">No recorded support history. Records began when this version was installed.</p>
            </section>
        </template>

        <AppModal v-model:open="reviewOpen" title="Resolve payment review" :description="`Account ${userId}`">
            <div class="space-y-3 text-sm">
                <p>OR3 refreshes this account from Stripe first. If the refresh fails, the facts changed, or more than one live subscription exists, the hold stays in place.</p>
                <ul class="list-disc pl-5">
                    <li v-for="review in openReviews" :key="review.id">{{ reviewLabels[review.kind] ?? review.kind }}</li>
                </ul>
                <p>Effect: only these review holds are removed. Access is then recomputed from payment, trial and support facts. Paid dates are not changed.</p>
                <UFormField label="Reason" required :hint="`${reviewReason.trim().length}/500`">
                    <UTextarea v-model="reviewReason" :maxlength="500" :rows="3" autoresize class="w-full" :disabled="submitting" />
                </UFormField>
                <UAlert v-if="dialogError" color="error" :title="dialogError.title" :description="dialogError.description" />
                <p v-if="pendingOperation" class="text-xs opacity-70">Operation {{ pendingOperation }}. Submitting again checks this same operation and cannot apply it twice.</p>
            </div>
            <template #footer>
                <UButton color="neutral" variant="ghost" :disabled="submitting" @click="reviewOpen = false">Cancel</UButton>
                <UButton v-if="dialogError?.stale" color="neutral" variant="soft" @click="reloadAndCloseDialog">Reload account</UButton>
                <UButton color="primary" :loading="submitting" :disabled="submitting || !reviewReason.trim() || reviewReason.trim().length > 500 || dialogError?.stale" @click="resolveReview">Resolve review</UButton>
            </template>
        </AppModal>

        <AppModal v-model:open="actionOpen" :title="actionTitle" :description="`Account ${userId}`">
            <div class="space-y-3 text-sm">
                <p v-if="billing">Current: {{ billing.access.allowed ? 'Cloud access allowed' : 'Cloud access blocked' }} · {{ sourceLabels[billing.access.source] }}<template v-if="billing.access.expiresAt"> until {{ formatTime(billing.access.expiresAt) }}</template> · allowance {{ formatBytes(billing.access.nominalStorageLimitBytes) }}</p>
                <UFormField v-if="actionKind === 'grant'" label="Storage allowance (GB)" required>
                    <UInput v-model.number="actionGb" type="number" :min="1" :step="1" class="w-40" :disabled="submitting" />
                </UFormField>
                <UFormField v-if="actionKind === 'storage_bonus'" label="Additional storage (GB, 0 removes it)" required>
                    <UInput v-model.number="actionGb" type="number" :min="0" :step="1" class="w-40" :disabled="submitting" />
                </UFormField>
                <template v-if="needsExpiry">
                    <UCheckbox v-if="expiryOptional" v-model="actionIndefinite" label="No expiry" :disabled="submitting" />
                    <UFormField v-if="!actionIndefinite || !expiryOptional" label="Ends" required>
                        <UInput v-model="actionExpires" type="datetime-local" :disabled="submitting" />
                    </UFormField>
                </template>
                <p class="rounded border border-[var(--md-outline-variant)] p-2"><strong>Expected effect:</strong> {{ actionEffect }}</p>
                <UFormField label="Reason" required :hint="`${actionReason.trim().length}/500`">
                    <UTextarea v-model="actionReason" :maxlength="500" :rows="3" autoresize class="w-full" :disabled="submitting" />
                </UFormField>
                <UAlert v-if="dialogError" color="error" :title="dialogError.title" :description="dialogError.description" />
                <p v-if="pendingOperation" class="text-xs opacity-70">Operation {{ pendingOperation }}. Submitting again checks this same operation and cannot apply it twice.</p>
            </div>
            <template #footer>
                <UButton color="neutral" variant="ghost" :disabled="submitting" @click="actionOpen = false">Cancel</UButton>
                <UButton v-if="dialogError?.stale" color="neutral" variant="soft" @click="reloadAndCloseAction">Reload account</UButton>
                <UButton color="primary" :loading="submitting" :disabled="submitting || !actionValid || dialogError?.stale" @click="submitAction">Confirm</UButton>
            </template>
        </AppModal>
    </div>
</template>

<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
import { actionLabels, blockerLabels, formatBytes, formatTime, newOperationId, reviewLabels, sourceLabels } from '~/utils/admin/customer-display';

definePageMeta({ layout: 'admin', middleware: ['admin-auth'] });

interface Customer { userId: string; email?: string; displayName?: string; createdAt: number; lastContactAt: number | null }
interface Workspace { id: string; name: string; role: string; deleted: boolean; memberCount: number; lastContactAt: number | null }
type Section<T> = { status: 'available'; value: T; observedAt: number } | { status: 'unavailable' | 'error'; code: string };
interface Review { id: string; kind: string; openedAt: number; resolvedAt: number | null; resolvedBy: string | null; resolutionReason: string | null }
interface Action { operationId: string; actor: string; kind: string; reason: string | null; createdAt: number; outcome: string; code: string | null }
interface Billing {
    revision: number;
    access: { allowed: boolean; source: string; blockers: string[]; expiresAt: number | null; nominalStorageLimitBytes: number; bonusBytes: number };
    account: null | { subscriptionStatus: string; paidUntil: number; renewalGraceUntil: number; cancelAtPeriodEnd: boolean; lastReconciledAt: number | null; lastReconcileOutcome: string | null };
    trial: { decision: 'granted' | 'denied' | 'none'; endsAt: number | null };
    reviews: Review[];
    openReviewIds: string[];
    actions: Action[];
    storage: Section<{ usedBytes: number }>;
}

const route = useRoute();
const userId = computed(() => String(route.params.id));
const billingEnabled = useRuntimeConfig().public.hostedBillingEnabled === true;
const adminHeaders = { 'x-or3-admin-intent': 'admin' };
const { getMessage } = useApiError();

const customer = ref<Customer | null>(null);
const workspaces = ref<Section<Workspace[]> | null>(null);
const billing = ref<Billing | null>(null);
const loadError = ref('');
const billingError = ref('');
type Notice = { tone: 'success' | 'warning' | 'error'; title: string; description?: string };
const notice = ref<Notice | null>(null);
const announcement = ref('');
const refreshing = ref(false);
const reviewOpen = ref(false);
const reviewReason = ref('');
const submitting = ref(false);
const pendingOperation = ref<string | null>(null);
const dialogError = ref<{ title: string; description?: string; stale?: boolean } | null>(null);

const openReviews = computed(() => billing.value?.reviews.filter(review => billing.value!.openReviewIds.includes(review.id)) ?? []);
const paymentLabel = computed(() => {
    const account = billing.value?.account;
    if (!account) return 'none';
    if (account.paidUntil > Date.now()) return 'current';
    if (account.subscriptionStatus === 'past_due') return 'past due';
    return account.subscriptionStatus ? account.subscriptionStatus.replace(/_/g, ' ') : 'none';
});
const paymentTone = computed(() => paymentLabel.value === 'current' ? 'success' : paymentLabel.value === 'past due' ? 'warning' : 'neutral');
const trialLabel = computed(() => ({ granted: 'Trial granted', denied: 'Trial denied', none: 'No trial decision' })[billing.value?.trial.decision ?? 'none']);
const history = computed(() => {
    const items: Array<{ key: string; title: string; detail: string | null; at: number }> = [];
    for (const review of billing.value?.reviews ?? []) {
        if (review.openedAt) items.push({ key: `open-${review.id}`, title: `Review opened: ${reviewLabels[review.kind] ?? review.kind}`, detail: null, at: review.openedAt });
    }
    for (const action of billing.value?.actions ?? []) {
        const failed = action.outcome === 'failed';
        items.push({
            key: action.operationId,
            title: `${actionLabels[action.kind] ?? action.kind}${failed ? ' — failed' : action.kind === 'refresh' ? ` — ${action.outcome.replace(/_/g, ' ')}` : ''}`,
            detail: [action.reason, `by ${action.actor}`].filter(Boolean).join(' · '),
            at: action.createdAt,
        });
    }
    return items.sort((a, b) => b.at - a.at);
});

type SyncObservation = { workspaceId: string; lastSuccessAt: number | null; lastSuccessOperation: string | null; lastFailureAt: number | null; lastFailureCode: string | null };
const sync = ref<Section<SyncObservation[]> | null>(null);
const lastSyncSuccess = computed(() => sync.value?.status === 'available' ? sync.value.value.filter(row => row.lastSuccessAt).sort((a, b) => b.lastSuccessAt! - a.lastSuccessAt!)[0] : null);
const lastSyncFailure = computed(() => sync.value?.status === 'available' ? sync.value.value.filter(row => row.lastFailureAt).sort((a, b) => b.lastFailureAt! - a.lastFailureAt!)[0] : null);

async function loadBilling() {
    if (!billingEnabled) return;
    try {
        billing.value = await $fetch<Billing>(`/api/admin/hosted-billing/accounts/${encodeURIComponent(userId.value)}`, { credentials: 'include' });
        billingError.value = '';
    } catch (error) {
        billingError.value = getMessage(error) || 'Try again.';
    }
}

async function load() {
    loadError.value = '';
    try {
        const result = await $fetch<{ customer: Customer; workspaces: Section<Workspace[]>; sync: Section<SyncObservation[]> }>(`/api/admin/customers/${encodeURIComponent(userId.value)}`, { credentials: 'include' });
        customer.value = result.customer;
        workspaces.value = result.workspaces;
        sync.value = result.sync;
    } catch (error) {
        loadError.value = getMessage(error) || 'Try again.';
        return;
    }
    await loadBilling();
}

async function refresh() {
    refreshing.value = true;
    notice.value = null;
    try {
        const result = await $fetch<{ outcome: string }>(`/api/admin/hosted-billing/accounts/${encodeURIComponent(userId.value)}/refresh`, {
            method: 'POST', headers: adminHeaders, credentials: 'include', body: { operationId: newOperationId() },
        });
        const messages: Record<string, Notice> = {
            refreshed: { tone: 'success', title: 'Refreshed from Stripe.' },
            failed: { tone: 'error', title: 'Stripe refresh failed.', description: 'The last confirmed facts and any hold were kept.' },
            no_customer: { tone: 'warning', title: 'Nothing to refresh.', description: 'This account has no Stripe customer.' },
            cloud_not_started: { tone: 'warning', title: 'Cloud not started.' },
        };
        notice.value = messages[result.outcome] ?? { tone: 'warning', title: result.outcome };
    } catch (error) {
        notice.value = { tone: 'error', title: 'Refresh failed.', description: getMessage(error) };
    } finally {
        refreshing.value = false;
        announcement.value = notice.value?.title ?? '';
        await loadBilling();
    }
}

function openReviewDialog() {
    dialogError.value = null;
    pendingOperation.value = null;
    reviewOpen.value = true;
}

async function reloadAndCloseDialog() {
    reviewOpen.value = false;
    await loadBilling();
}

async function resolveReview() {
    if (!billing.value) return;
    submitting.value = true;
    dialogError.value = null;
    // Reuse the operation ID after an ambiguous failure so a retry cannot apply twice.
    const operationId = pendingOperation.value ?? newOperationId();
    pendingOperation.value = operationId;
    try {
        await $fetch(`/api/admin/hosted-billing/accounts/${encodeURIComponent(userId.value)}/review`, {
            method: 'POST', headers: adminHeaders, credentials: 'include', timeout: 30_000,
            body: { operationId, reason: reviewReason.value.trim(), expectedRevision: billing.value.revision, reviewIds: billing.value.openReviewIds },
        });
        reviewOpen.value = false;
        reviewReason.value = '';
        pendingOperation.value = null;
        notice.value = { tone: 'success', title: 'Review resolved.', description: 'Access was recomputed from the remaining facts.' };
        announcement.value = 'Review resolved.';
        await loadBilling();
    } catch (error) {
        const status = (error as { statusCode?: number; response?: { status?: number } }).statusCode ?? (error as { response?: { status?: number } }).response?.status;
        if (status === 409) {
            pendingOperation.value = null;
            dialogError.value = { title: 'The account changed', description: `${getMessage(error)} Your reason is kept.`, stale: true };
        } else if (status === 400 || status === 404 || status === 403) {
            pendingOperation.value = null;
            dialogError.value = { title: 'Decision refused', description: getMessage(error) };
        } else {
            dialogError.value = { title: 'The result is not confirmed', description: `${getMessage(error) || 'The request did not finish.'} Submit again to check the same operation.` };
        }
        announcement.value = dialogError.value.title;
    } finally {
        submitting.value = false;
    }
}

type ActionKind = 'grant' | 'revoke_grant' | 'extend_trial' | 'storage_bonus' | 'pause_account' | 'resume_account' | 'pause_uploads' | 'resume_uploads' | 'pause_jobs' | 'resume_jobs';
const checkLabels: Record<string, string> = { owner_entitlement: "Owner's Cloud access", account_allowance: 'Account allowance', workspace_cap: 'Workspace cap' };
const actionTitles: Record<ActionKind, string> = {
    grant: 'Grant temporary access', revoke_grant: 'Revoke temporary access', extend_trial: 'Extend trial', storage_bonus: 'Additional storage',
    pause_account: 'Pause hosted access', resume_account: 'Resume hosted access', pause_uploads: 'Pause new uploads for this account',
    resume_uploads: 'Resume uploads for this account', pause_jobs: 'Pause new background jobs for this account', resume_jobs: 'Resume background jobs for this account',
};
const actionOpen = ref(false);
const actionKind = ref<ActionKind>('grant');
const actionGb = ref<number>(1);
const actionExpires = ref('');
const actionIndefinite = ref(true);
const actionReason = ref('');
const storage = ref<null | { breakdown: { chargedBytes: number; retainedBytes: number; activeReservedBytes: number; expiredReservedBytes: number; deletedWorkspaceBytes: number; observedAt: number; workspaces: Array<{ workspaceId: string; name: string; deleted: boolean; retainedBytes: number; reservedBytes: number; chargedBytes: number }> }; workspaceCapBytes: number | null }>(null);
const storageError = ref('');
const diagnoseWorkspace = ref('');
const diagnoseMb = ref(0);
const explanation = ref<null | { controlling: string | null; checks: Array<{ check: string; status: string; limitBytes?: number; projectedBytes?: number }> }>(null);

const support = computed(() => (billing.value as (Billing & { support: null | { grantUntil: number; grantStorageBytes: number; trialExtensionUntil: number; bonusBytes: number; bonusUntil: number | null; hostedPause: null | { expiresAt: number | null }; uploadPause: null | { expiresAt: number | null }; jobPause: null | { expiresAt: number | null } } }) | null)?.support ?? null);
const pauseActive = (pause: null | { expiresAt: number | null } | undefined) => Boolean(pause && (pause.expiresAt === null || pause.expiresAt > Date.now()));
const paidSubscription = computed(() => ['active', 'past_due', 'trialing', 'unpaid', 'paused'].includes(billing.value?.account?.subscriptionStatus ?? ''));
const availableActions = computed(() => {
    const value = support.value;
    const actions: Array<{ kind: ActionKind; label: string }> = [{ kind: 'grant', label: value && value.grantUntil > Date.now() ? 'Change temporary access' : 'Grant temporary access' }];
    if (value && value.grantUntil > Date.now()) actions.push({ kind: 'revoke_grant', label: 'Revoke temporary access' });
    if (!paidSubscription.value) actions.push({ kind: 'extend_trial', label: 'Extend trial' });
    actions.push({ kind: 'storage_bonus', label: 'Additional storage' });
    actions.push(pauseActive(value?.hostedPause) ? { kind: 'resume_account', label: 'Resume hosted access' } : { kind: 'pause_account', label: 'Pause hosted access' });
    actions.push(pauseActive(value?.uploadPause) ? { kind: 'resume_uploads', label: 'Resume uploads' } : { kind: 'pause_uploads', label: 'Pause uploads' });
    actions.push(pauseActive(value?.jobPause) ? { kind: 'resume_jobs', label: 'Resume background jobs' } : { kind: 'pause_jobs', label: 'Pause background jobs' });
    return actions;
});
const activeExceptions = computed(() => {
    const value = support.value;
    if (!value) return [];
    const now = Date.now();
    const until = (time: number | null) => time === null ? 'no expiry' : `until ${formatTime(time)}`;
    return [
        value.grantUntil > now && `Temporary access with ${formatBytes(value.grantStorageBytes)} until ${formatTime(value.grantUntil)}`,
        value.trialExtensionUntil > now && `Trial extended until ${formatTime(value.trialExtensionUntil)} (original trial record unchanged)`,
        value.bonusBytes > 0 && (value.bonusUntil === null || value.bonusUntil > now) && `Additional storage ${formatBytes(value.bonusBytes)}, ${until(value.bonusUntil)}`,
        pauseActive(value.hostedPause) && `Hosted access paused, ${until(value.hostedPause!.expiresAt)}`,
        pauseActive(value.uploadPause) && `New uploads paused, ${until(value.uploadPause!.expiresAt)}`,
        pauseActive(value.jobPause) && `New background jobs paused, ${until(value.jobPause!.expiresAt)}`,
    ].filter((item): item is string => Boolean(item));
});
const actionTitle = computed(() => actionTitles[actionKind.value]);
const needsExpiry = computed(() => ['grant', 'extend_trial', 'storage_bonus', 'pause_account', 'pause_uploads', 'pause_jobs'].includes(actionKind.value));
const expiryOptional = computed(() => ['storage_bonus', 'pause_account', 'pause_uploads', 'pause_jobs'].includes(actionKind.value));
const expiresAt = computed(() => {
    if (expiryOptional.value && actionIndefinite.value) return null;
    const time = actionExpires.value ? new Date(actionExpires.value).getTime() : NaN;
    return Number.isFinite(time) ? time : NaN;
});
const actionValid = computed(() => {
    const reason = actionReason.value.trim();
    if (!reason || reason.length > 500) return false;
    if (needsExpiry.value && expiresAt.value !== null && !(Number(expiresAt.value) > Date.now())) return false;
    if (actionKind.value === 'grant') return Number.isFinite(actionGb.value) && actionGb.value >= 1;
    if (actionKind.value === 'storage_bonus') return Number.isFinite(actionGb.value) && actionGb.value >= 0;
    return true;
});
const actionEffect = computed(() => ({
    grant: `Cloud access with a ${actionGb.value || 0} GB allowance when no paid plan or trial applies. A review hold or pause still blocks it. Payment records are unchanged.`,
    revoke_grant: 'Complimentary access ends now. Paid or trial access is unaffected. Files are kept.',
    extend_trial: 'Trial access until the chosen time. The original trial decision and deadline stay on record.',
    storage_bonus: `${actionGb.value || 0} GB is added to the current plan, trial or grant allowance. On its own it does not grant Cloud access.`,
    pause_account: 'Sync, uploads and new background jobs stop. Sign-in, Free Local, foreground chat with the customer’s own key, downloads, export and billing stay available.',
    resume_account: 'The support pause is removed. Access is recomputed from payment, trial and grant facts.',
    pause_uploads: 'New uploads to workspaces this account owns are refused. Downloads and already issued upload links continue until they expire.',
    resume_uploads: 'New uploads are admitted again under the normal checks.',
    pause_jobs: 'New background jobs for this account are refused. Running jobs continue.',
    resume_jobs: 'New background jobs are admitted again under the normal checks.',
})[actionKind.value]);

function openAction(kind: ActionKind) {
    actionKind.value = kind;
    actionGb.value = kind === 'grant' ? Math.max(1, Math.round((billing.value?.access.nominalStorageLimitBytes || 50e9) / 1e9)) : kind === 'storage_bonus' ? Math.round((support.value?.bonusBytes ?? 0) / 1e9) : 0;
    const week = new Date(Date.now() + 7 * 86_400_000);
    actionExpires.value = new Date(week.getTime() - week.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    actionIndefinite.value = kind !== 'storage_bonus';
    dialogError.value = null;
    pendingOperation.value = null;
    actionOpen.value = true;
}

async function reloadAndCloseAction() {
    actionOpen.value = false;
    await loadBilling();
}

function buildCommand() {
    const kind = actionKind.value;
    if (kind === 'grant') return { kind, expiresAt: expiresAt.value, storageBytes: Math.round(actionGb.value * 1e9) };
    if (kind === 'extend_trial') return { kind, expiresAt: expiresAt.value };
    if (kind === 'storage_bonus') return { kind, bytes: Math.round(actionGb.value * 1e9), expiresAt: expiresAt.value };
    if (kind === 'pause_account' || kind === 'pause_uploads' || kind === 'pause_jobs') return { kind, expiresAt: expiresAt.value };
    return { kind };
}

async function submitAction() {
    if (!billing.value) return;
    submitting.value = true;
    dialogError.value = null;
    const operationId = pendingOperation.value ?? newOperationId();
    pendingOperation.value = operationId;
    try {
        await $fetch(`/api/admin/hosted-billing/accounts/${encodeURIComponent(userId.value)}/support`, {
            method: 'POST', headers: adminHeaders, credentials: 'include', timeout: 30_000,
            body: { operationId, reason: actionReason.value.trim(), expectedRevision: billing.value.revision, command: buildCommand() },
        });
        actionOpen.value = false;
        actionReason.value = '';
        pendingOperation.value = null;
        await loadBilling();
        notice.value = { tone: 'success', title: `${actionTitle.value}: applied.`, description: billing.value ? `Now: ${billing.value.access.allowed ? 'Cloud access allowed' : 'Cloud access blocked'} · ${sourceLabels[billing.value.access.source]}` : undefined };
        announcement.value = notice.value.title;
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode ?? (error as { response?: { status?: number } }).response?.status;
        if (status === 409) {
            pendingOperation.value = null;
            dialogError.value = { title: 'Not applied', description: `${getMessage(error)} Your reason is kept.`, stale: (error as { data?: { data?: { code?: string } } }).data?.data?.code === 'stale_revision' };
        } else if (status && status < 500) {
            pendingOperation.value = null;
            dialogError.value = { title: 'Not applied', description: getMessage(error) };
        } else {
            dialogError.value = { title: 'The result is not confirmed', description: `${getMessage(error) || 'The request did not finish.'} Submit again to check the same operation.` };
        }
        announcement.value = dialogError.value.title;
    } finally {
        submitting.value = false;
    }
}

async function loadStorage() {
    if (!billingEnabled || !billing.value?.account) return;
    try {
        storage.value = await $fetch<NonNullable<typeof storage.value>>(`/api/admin/hosted-billing/accounts/${encodeURIComponent(userId.value)}/storage`, { credentials: 'include' });
        storageError.value = '';
        diagnoseWorkspace.value ||= storage.value?.breakdown.workspaces.find(item => !item.deleted)?.workspaceId ?? '';
    } catch (error) { storageError.value = getMessage(error) || 'Try again.'; }
}

async function diagnose() {
    try {
        const result = await $fetch<{ explanation: typeof explanation.value }>(`/api/admin/hosted-billing/accounts/${encodeURIComponent(userId.value)}/storage`, {
            credentials: 'include', query: { workspaceId: diagnoseWorkspace.value, sizeBytes: Math.max(0, Math.round((diagnoseMb.value || 0) * 1e6)) || undefined },
        });
        explanation.value = result.explanation;
    } catch (error) { storageError.value = getMessage(error) || 'Try again.'; }
}

watch(() => billing.value?.revision, () => { void loadStorage(); });
onMounted(load);
</script>

<style scoped>
.card {
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--md-border-radius);
    background: var(--md-surface);
    padding: 1rem;
}
.card-title { font-weight: 600; margin-bottom: 0.5rem; }
.facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.25rem 0.75rem; font-size: 0.875rem; }
.facts dt { opacity: 0.7; }
.facts dd { text-align: right; overflow-wrap: break-word; }
</style>
