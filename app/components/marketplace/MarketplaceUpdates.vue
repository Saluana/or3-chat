<script setup lang="ts">
/**
 * Dashboard > Marketplace > Updates.
 *
 * Updates are recorded candidates on the same package lifecycle the installer
 * uses: each one is health-checked (including the hidden browser canary for
 * contained client packages) and only then promoted by exact digest. A newer
 * authority revision needs fresh workspace consent before the check can pass.
 */
import { computed, onMounted, ref } from 'vue';
import { useToast } from '#imports';
import MarketplaceFailure from './MarketplaceFailure.vue';
import { acquisitionDiagnosticReport, acquisitionFailureHelp } from '~~/shared/plugins/acquisition/failure-presentation';
import { ACTIVATION_NOT_CONFIRMED_COPY } from '~~/shared/plugins/lifecycle/lifecycle-view';
import {
    useMarketplaceInstall,
    useMarketplaceInstalled,
    useMarketplaceConsent,
    useMarketplaceUpdateCheck,
    type AcquisitionStatusView,
    type MarketplaceInstallTarget,
    type MarketplaceUpdateCheckPlugin,
    marketplaceTargetKey,
    sameMarketplaceTarget,
} from '~/composables/marketplace/useMarketplace';
import { reportCandidateClientCanary } from '~/composables/plugins/portable-canary';
import {
    browserEngineQualified,
    detectBrowserEngine,
    QUALIFIED_BROWSER_ENGINES,
} from '~~/shared/plugins/isolation/portable-bootstrap';

const toast = useToast();
const installed = useMarketplaceInstalled();
const install = useMarketplaceInstall();
const consent = useMarketplaceConsent();
const updateCheck = useMarketplaceUpdateCheck();
const busyPluginId = ref<string | null>(null);
const canaryNote = ref<Record<string, string>>({});
/** Per-plugin outcome after a resume attempt, so a stuck update offers the next step. */
const updateNote = ref<Record<string, { readonly message: string; readonly retryable: boolean }>>(
    {}
);
const browserEngine = ref<string>('unknown');
const approvedUpdates = ref<Record<string, string>>({});
/** Last confirmation target per plugin, so a timeout can retry observation only. */
const confirmationTargets = ref<Record<string, { pluginId: string; packageTreeSha256: string; workspaceId: string }>>({});
const confirmationBusy = ref<Record<string, boolean>>({});
/**
 * Per-plugin confirmation outcome, derived from the confirmation result —
 * never from a global flag. Recovery actions render whenever the installed
 * update is not confirmed running, whether the observation timed out or the
 * activation itself failed.
 */
const confirmationFailed = ref<Record<string, boolean>>({});
const confirmationTimedOut = ref<Record<string, boolean>>({});
const confirmationFailureCode = ref<Record<string, string | null>>({});

/** Record one confirmation outcome: status text follows the result, not the attempt. */
function settleConfirmation(
    pluginId: string,
    confirmation: { readonly confirmed: boolean; readonly reason?: string; readonly code?: string } | null
): boolean {
    if (confirmation?.confirmed === true) {
        canaryNote.value = { ...canaryNote.value, [pluginId]: 'running' };
        confirmationFailed.value = { ...confirmationFailed.value, [pluginId]: false };
        confirmationTimedOut.value = { ...confirmationTimedOut.value, [pluginId]: false };
        confirmationFailureCode.value = { ...confirmationFailureCode.value, [pluginId]: null };
        const { [pluginId]: _cleared, ...rest } = updateNote.value;
        updateNote.value = rest;
        const { [pluginId]: _target, ...targets } = confirmationTargets.value;
        confirmationTargets.value = targets;
        return true;
    }
    const timedOut = confirmation?.reason === 'timeout';
    canaryNote.value = {
        ...canaryNote.value,
        [pluginId]: timedOut ? 'activation not confirmed' : `activation failed (${confirmation?.code ?? confirmation?.reason ?? 'not observed'})`,
    };
    confirmationFailed.value = { ...confirmationFailed.value, [pluginId]: true };
    confirmationTimedOut.value = { ...confirmationTimedOut.value, [pluginId]: timedOut };
    confirmationFailureCode.value = {
        ...confirmationFailureCode.value,
        [pluginId]: timedOut ? null : (confirmation?.code ?? confirmation?.reason ?? null),
    };
    return false;
}

function updateTarget(entry: MarketplaceUpdateCheckPlugin): MarketplaceInstallTarget | null {
    if (!entry.latestVersion || !entry.release || entry.release.version !== entry.latestVersion) {
        return null;
    }
    return {
        pluginId: entry.pluginId,
        releaseId: entry.release.releaseId,
        version: entry.release.version,
        archiveSha256: entry.release.archiveSha256,
        packageTreeSha256: entry.release.packageTreeSha256,
        authoritySha256: entry.release.authoritySha256,
        requestedGrants: entry.release.requestedGrants,
        authority: entry.release.authority,
    };
}

function updateTargetKey(entry: MarketplaceUpdateCheckPlugin): string {
    const target = updateTarget(entry);
    return target ? marketplaceTargetKey(target) : '';
}

async function refreshUpdates(): Promise<void> {
    approvedUpdates.value = {};
    await updateCheck.check();
}

onMounted(() => {
    browserEngine.value = detectBrowserEngine();
    installed.load();
});

const candidates = computed(() =>
    installed.packages.value.filter((entry) => Boolean(entry.pointer?.candidate))
);

/** Newer published releases that nobody has staged yet. */
const availableUpdates = computed(() =>
    (updateCheck.result.value?.plugins ?? []).filter(
        (entry) => entry.status === 'update-available' && entry.latestVersion !== null
    )
);

/** Releases the registry itself refuses (quarantine, revocation, no metadata). */
const problemChecks = computed(() =>
    (updateCheck.result.value?.plugins ?? []).filter(
        (entry) => entry.status === 'blocked' || entry.status === 'unknown'
    )
);

async function reviewUpdate(entry: MarketplaceUpdateCheckPlugin): Promise<void> {
    const target = updateTarget(entry);
    if (!target) return;
    if (
        entry.release?.profile === 'or3-portable-client-v1' &&
        !browserEngineQualified(browserEngine.value, QUALIFIED_BROWSER_ENGINES)
    ) {
        updateNote.value = {
            ...updateNote.value,
            [entry.pluginId]: {
                message: `This update needs a qualified browser (${QUALIFIED_BROWSER_ENGINES.join(', ')}); the current browser is ${browserEngine.value}.`,
                retryable: false,
            },
        };
        toast.add({
            title: 'This browser cannot run the update',
            description: 'Open the update in a qualified browser before staging it.',
            color: 'warning',
        });
        return;
    }
    const grants = target.requestedGrants;
    const authorityReviewRequired = grants.length > 0 || target.authority !== undefined;
    if (grants.length > 0 && !target.authority) {
        updateNote.value = {
            ...updateNote.value,
            [entry.pluginId]: {
                message: 'The complete signed authority descriptor is unavailable, so this update cannot be approved safely.',
                retryable: false,
            },
        };
        toast.add({
            title: 'Complete authority review unavailable',
            description: 'Ask the publisher to republish the release with its signed authority descriptor.',
            color: 'warning',
        });
        return;
    }
    if (authorityReviewRequired && approvedUpdates.value[entry.pluginId] !== marketplaceTargetKey(target)) {
        updateNote.value = {
            ...updateNote.value,
            [entry.pluginId]: {
                message: 'Review and approve the requested permissions before staging this update.',
                retryable: false,
            },
        };
        toast.add({
            title: 'Permission review required',
            description: 'Approve the displayed permissions, then review the update again.',
            color: 'warning',
        });
        return;
    }
    if (authorityReviewRequired) {
        const recorded = await consent.approve({
            pluginId: target.pluginId,
            approvedGrants: grants,
            expectedPackageDigest: target.packageTreeSha256,
            expectedAuthoritySha256: target.authoritySha256,
            version: target.version,
        });
        if (!recorded) {
            toast.add({
                title: 'The update permissions were not recorded',
                description: consent.error.value ?? 'Reload and review the release again.',
                color: 'error',
            });
            return;
        }
    }
    const currentEntry = updateCheck.result.value?.plugins.find(
        (candidate) => candidate.pluginId === entry.pluginId
    );
    if (!currentEntry || !sameMarketplaceTarget(updateTarget(currentEntry), target)) {
        delete approvedUpdates.value[entry.pluginId];
        toast.add({
            title: 'The reviewed release changed',
            description: 'Refresh the update list and review the new release before staging it.',
            color: 'warning',
        });
        return;
    }
    busyPluginId.value = entry.pluginId;
    canaryNote.value = { ...canaryNote.value, [entry.pluginId]: 'staging review' };
    try {
        // Reviewing starts the ordinary acquisition operation for the selected
        // release: compatibility, advisories, grants, setup and the canary all
        // still run before anything is selected.
        const finished = await install.start({
            pluginId: entry.pluginId,
            version: target.version,
        });
        reportOutcome(entry.pluginId, finished);
            await Promise.all([installed.load(), refreshUpdates()]);
    } finally {
        busyPluginId.value = null;
    }
}

function reportOutcome(pluginId: string, view: AcquisitionStatusView | null): void {
    if (view?.status === 'completed') {
        // Acquisition completion selects the package; it does not prove this
        // browser runs it. Confirmation follows before any "running" claim.
        canaryNote.value = { ...canaryNote.value, [pluginId]: 'installed, confirming activation' };
        const { [pluginId]: _cleared, ...rest } = updateNote.value;
        updateNote.value = rest;
        void confirmUpdateRunning(pluginId, view);
        return;
    }
    const status = view?.status ?? 'pending';
    canaryNote.value = { ...canaryNote.value, [pluginId]: status };
    const message =
        (view?.failure ? acquisitionFailureHelp(view).message : null) ??
        (status === 'paused'
            ? 'Finish the required setup, then continue.'
            : 'Resume when the blocker is cleared.');
    updateNote.value = {
        ...updateNote.value,
        [pluginId]: { message, retryable: view?.retryable === true },
    };
    toast.add({
        title:
            status === 'paused'
                ? 'Setup required'
                : view?.retryable === true
                  ? 'The update needs another attempt'
                  : 'The update is still pending',
        description: message,
        color: 'warning',
    });
}

/**
 * Observe the newly selected package running here. A timeout leaves the
 * installed update in place and offers confirmation retry plus diagnostics;
 * it never reinstalls blindly.
 */
async function confirmUpdateRunning(pluginId: string, view: AcquisitionStatusView): Promise<void> {
    const workspaceId = installed.workspaceId.value ?? view.workspaceId;
    const target = {
        pluginId,
        packageTreeSha256: view.release.packageTreeSha256,
        workspaceId,
    };
    confirmationTargets.value = { ...confirmationTargets.value, [pluginId]: target };
    confirmationBusy.value = { ...confirmationBusy.value, [pluginId]: true };
    try {
        const confirmation = await install.confirmActivation(target);
        if (settleConfirmation(pluginId, confirmation)) {
            toast.add({
                title: 'Updated and running',
                description: `Version ${view.version} is running in this workspace.`,
                color: 'success',
            });
            return;
        }
        updateNote.value = {
            ...updateNote.value,
            [pluginId]: {
                message: `${ACTIVATION_NOT_CONFIRMED_COPY}: version ${view.version} is installed. Retry confirmation or copy diagnostics; the update stays selected.`,
                retryable: false,
            },
        };
        toast.add({
            title: ACTIVATION_NOT_CONFIRMED_COPY,
            description: `Version ${view.version} is installed but not confirmed running here yet.`,
            color: 'warning',
        });
    } finally {
        confirmationBusy.value = { ...confirmationBusy.value, [pluginId]: false };
    }
}

async function retryUpdateConfirmation(pluginId: string): Promise<void> {
    const target = confirmationTargets.value[pluginId];
    if (!target) return;
    confirmationBusy.value = { ...confirmationBusy.value, [pluginId]: true };
    try {
        const confirmation = await install.retryActivationConfirmation(target);
        if (settleConfirmation(pluginId, confirmation)) {
            toast.add({ title: 'Running', description: 'The installed update was observed in this workspace.', color: 'success' });
        }
    } finally {
        confirmationBusy.value = { ...confirmationBusy.value, [pluginId]: false };
    }
}

/** Confirm a directly promoted candidate runs here; selection stands on timeout. */
async function confirmPromotedCandidate(
    pluginId: string,
    candidateDigest: string,
    candidateVersion: string
): Promise<void> {
    const workspaceId = installed.workspaceId.value;
    if (!workspaceId) {
        toast.add({
            title: 'Updated',
            description: 'The reviewed version is now the selected one.',
            color: 'success',
        });
        return;
    }
    const target = { pluginId, packageTreeSha256: candidateDigest, workspaceId };
    confirmationTargets.value = { ...confirmationTargets.value, [pluginId]: target };
    confirmationBusy.value = { ...confirmationBusy.value, [pluginId]: true };
    try {
        const confirmation = await install.confirmActivation(target);
        if (settleConfirmation(pluginId, confirmation)) {
            toast.add({
                title: 'Updated and running',
                description: `Version ${candidateVersion} is running in this workspace.`,
                color: 'success',
            });
            return;
        }
        updateNote.value = {
            ...updateNote.value,
            [pluginId]: {
                message: `${ACTIVATION_NOT_CONFIRMED_COPY}: version ${candidateVersion} is installed. Retry confirmation below; the update stays selected.`,
                retryable: false,
            },
        };
        toast.add({
            title: ACTIVATION_NOT_CONFIRMED_COPY,
            description: `Version ${candidateVersion} is installed but not confirmed running here yet.`,
            color: 'warning',
        });
    } finally {
        confirmationBusy.value = { ...confirmationBusy.value, [pluginId]: false };
    }
}

async function copyUpdateDiagnostics(pluginId: string): Promise<void> {    const operation = install.status.value;
    if (!operation || operation.pluginId !== pluginId) return;
    try {
        await navigator.clipboard.writeText(
            acquisitionDiagnosticReport(operation, {
                activationTimedOut: confirmationTimedOut.value[pluginId] === true,
            })
        );
        toast.add({ title: 'Diagnostics copied', description: 'Only operation and release identities are included.', color: 'success' });
    } catch {
        toast.add({ title: 'Could not copy diagnostics', color: 'warning' });
    }
}

async function apiPost<T>(
    url: string,
    options: { readonly body?: unknown } = {}
): Promise<T> {
    return (await (
        $fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>
    )(url, {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
        ...(options.body === undefined ? {} : { body: options.body }),
    })) as T;
}

async function activate(entry: {
    readonly pluginId: string;
    readonly display?: {
        readonly candidateDigest: string | null;
        readonly candidateVersion: string | null;
    };
    readonly pointer: {
        readonly candidate?: { readonly packageDigest?: string } | null;
    } | null;
}): Promise<void> {
    const candidateDigest = entry.display?.candidateDigest ?? entry.pointer?.candidate?.packageDigest;
    if (!candidateDigest) return;
    const candidateVersion = entry.display?.candidateVersion ?? '';
    busyPluginId.value = entry.pluginId;
    canaryNote.value = { ...canaryNote.value, [entry.pluginId]: 'checking' };
    try {
        // A candidate the acquisition pipeline staged belongs to that operation:
        // resume it, so preflight, setup readiness and the browser canary all
        // still apply. Promoting it here would be a side door around them.
        const resumable = await install.restore(entry.pluginId, {
            version: candidateVersion,
            ...(installed.workspaceId.value === null
                ? {}
                : { workspaceId: installed.workspaceId.value }),
        });
        // Only resume the operation that staged *this* candidate; an unrelated
        // unfinished install must not be adopted to activate a different version.
        if (resumable && resumable.version === candidateVersion && resumable.status !== 'completed') {
            canaryNote.value = { ...canaryNote.value, [entry.pluginId]: 'resuming install' };
            const finished = await install.adopt(entry.pluginId, resumable.operationId);
            reportOutcome(entry.pluginId, finished);
            await installed.load();
            return;
        }
        const runCanary = () =>
            apiPost<{
                ok?: boolean;
                status?: string;
                clientCanary?: {
                    status: string;
                    ticket: Parameters<typeof reportCandidateClientCanary>[0];
                };
            }>(`/api/admin/plugins/packages/${entry.pluginId}/canary`, { body: {} });

        const canary = await runCanary();
        if (canary.clientCanary?.status === 'awaiting-client') {
            const outcome = await reportCandidateClientCanary(canary.clientCanary.ticket);
            canaryNote.value = { ...canaryNote.value, [entry.pluginId]: outcome.status };
            if (outcome.status !== 'passed') {
                toast.add({
                    title: 'This browser could not run the update',
                    description: `${outcome.code ?? 'blocked'} — the update stays pending.`,
                    color: 'warning',
                });
                return;
            }
            const rerun = await runCanary();
            if (!rerun.ok) {
                canaryNote.value = { ...canaryNote.value, [entry.pluginId]: rerun.status ?? 'blocked' };
                toast.add({ title: 'The update did not pass its health check', color: 'error' });
                return;
            }
        } else if (!canary.ok) {
            canaryNote.value = { ...canaryNote.value, [entry.pluginId]: canary.status ?? 'blocked' };
            toast.add({
                title: 'The update did not pass its health check',
                description: 'Check the workspace grant review, then try again.',
                color: 'error',
            });
            return;
        }

        try {
            await apiPost(`/api/admin/plugins/packages/${entry.pluginId}/promote`, {
                body: { candidateDigest },
            });
            installed.reconcile('manifest-revision-change');
        } catch (promotionError) {            // The promotion boundary refuses a candidate that an install
            // operation owns; resume that operation instead of reporting failure.
            const data = (promotionError as { data?: { code?: string; operationId?: string } }).data;
            if (data?.code === 'acquisition-required' && data.operationId) {
                canaryNote.value = {
                    ...canaryNote.value,
                    [entry.pluginId]: 'resuming install',
                };
                const finished = await install.adopt(entry.pluginId, data.operationId);
                reportOutcome(entry.pluginId, finished);
                await installed.load();
                return;
            }
            throw promotionError;
        }
        // Promotion selects the candidate; confirm it runs here before any
        // "running" claim. A timeout keeps the selection and offers retry.
        await installed.load();
        await confirmPromotedCandidate(entry.pluginId, candidateDigest, candidateVersion);
    } catch (error) {
        toast.add({
            title: 'The update could not be activated',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}
</script>

<template>
    <div class="flex flex-col gap-4" data-testid="marketplace-updates">
        <MarketplaceFailure v-if="install.status.value?.failure" :operation="install.status.value" />
        <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs text-(--ui-text-muted)">
                Checking reads the catalog. Nothing is staged until you review a release.
            </p>
            <UButton
                size="sm"
                color="neutral"
                variant="soft"
                icon="i-lucide-refresh-cw"
                :loading="updateCheck.loading.value"
                data-testid="marketplace-update-check"
                @click="refreshUpdates()"
            >
                Check for updates
            </UButton>
        </div>
        <p v-if="updateCheck.error.value" class="text-xs text-(--ui-text-error)">
            {{ updateCheck.error.value }}
        </p>
        <ul
            v-if="availableUpdates.length > 0"
            class="flex flex-col gap-3"
            data-testid="marketplace-update-available"
        >
            <li
                v-for="entry in availableUpdates"
                :key="entry.pluginId"
                class="flex flex-col gap-2 rounded-lg border border-(--ui-border) p-3"
            >
                <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium">{{ entry.pluginId }}</span>
                    <UBadge color="info" variant="subtle">v{{ entry.latestVersion }}</UBadge>
                    <span class="text-xs text-(--ui-text-muted)">
                        installed {{ entry.installedVersion }}
                    </span>
                </div>
                <p class="text-xs text-(--ui-text-muted)">
                    Requested authority:
                    {{ entry.release?.requestedGrants.join(', ') || 'none' }}
                </p>
                <details v-if="entry.release?.authority" class="rounded border border-(--ui-border) p-2 text-xs">
                    <summary class="cursor-pointer font-medium">Review complete authority</summary>
                    <div class="mt-2 flex flex-col gap-2">
                        <p><strong>Trust:</strong> {{ entry.release.authority.trust }}</p>
                        <p><strong>Features:</strong> {{ entry.release.authority.features.join(', ') || 'none' }}</p>
                        <p><strong>Engines:</strong> {{ entry.release.authority.engines.join(', ') || 'none' }}</p>
                        <div>
                            <strong>Destinations</strong>
                            <ul class="list-disc pl-5">
                                <li v-for="destination in entry.release.authority.destinations" :key="`${destination.host}:${destination.connection ?? ''}`">
                                    {{ destination.host }} — {{ destination.methods.join(', ') || 'no methods' }}
                                    ({{ destination.pathPrefixes.join(', ') || 'all paths' }})
                                    <span v-if="destination.connection">via {{ destination.connection }}</span>
                                </li>
                            </ul>
                        </div>
                        <p><strong>Connection scopes:</strong> {{ entry.release.authority.connectionScopes.join(', ') || 'none' }}</p>
                        <p><strong>Data scopes:</strong> {{ entry.release.authority.dataScopes.join(', ') || 'none' }}</p>
                        <p><strong>Writes:</strong> {{ entry.release.authority.writes.join(', ') || 'none' }}</p>
                        <p><strong>Setup hooks:</strong> {{ entry.release.authority.setupHooks.join(', ') || 'none' }}</p>
                        <p><strong>Dependencies:</strong> {{ entry.release.authority.dependencies.join(', ') || 'none' }}</p>
                    </div>
                </details>
                <p v-else-if="entry.release?.requestedGrants.length" class="text-xs text-(--ui-text-error)">
                    The complete signed authority descriptor is unavailable; this update cannot be approved safely.
                </p>
                <label
                    v-if="entry.release?.requestedGrants.length || entry.release?.authority"
                    class="flex items-center gap-2 text-xs text-(--ui-text-muted)"
                >
                    <input
                        v-model="approvedUpdates[entry.pluginId]"
                        type="checkbox"
                        :true-value="updateTargetKey(entry)"
                        :false-value="''"
                        data-testid="marketplace-update-grant-approve"
                    />
                    I approve these permissions for this workspace.
                </label>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        size="sm"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-eye"
                        :loading="busyPluginId === entry.pluginId"
                        data-testid="marketplace-update-review"
                        @click="reviewUpdate(entry)"
                    >
                        Review update
                    </UButton>
                </div>
            </li>
        </ul>
        <div v-if="problemChecks.length > 0" class="flex flex-col gap-1">
            <p
                v-for="entry in problemChecks"
                :key="entry.pluginId"
                class="text-xs text-(--ui-text-muted)"
            >
                {{ entry.pluginId }}: {{ entry.reason ?? 'no update information available' }}
            </p>
        </div>
        <h3 class="text-sm font-medium">Staged candidates</h3>
        <div v-if="installed.loading.value" class="text-sm text-(--ui-text-muted)">Loading…</div>
        <div v-else-if="candidates.length === 0" class="text-sm text-(--ui-text-muted)">
            No reviewed release is staged right now. Use “Check for updates” to look for a newer
            version.
        </div>
        <ul v-else class="flex flex-col gap-3">
            <li
                v-for="entry in candidates"
                :key="entry.pluginId"
                class="flex flex-col gap-2 rounded-lg border border-(--ui-border) p-3"
            >
                <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium">{{ entry.pluginId }}</span>
                    <UBadge color="info" variant="subtle">
                        candidate {{ entry.display?.candidateVersion ?? entry.display?.candidateDigest }}
                    </UBadge>
                    <span class="text-xs text-(--ui-text-muted)">
                        current {{ entry.display?.version ?? 'none' }}
                    </span>
                </div>
                <p class="text-xs text-(--ui-text-muted)">
                    The update activates only after a health check of the exact reviewed bytes; expanded
                    authority needs fresh consent first.
                </p>
                <p v-if="canaryNote[entry.pluginId]" class="text-xs text-(--ui-text-muted)">
                    Update check: {{ canaryNote[entry.pluginId] }}
                </p>
                <p
                    v-if="updateNote[entry.pluginId]"
                    class="text-xs"
                    data-testid="marketplace-update-note"
                >
                    {{ updateNote[entry.pluginId]?.message }}
                </p>
                <div
                    v-if="confirmationBusy[entry.pluginId] || confirmationTargets[entry.pluginId]"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    class="flex flex-col gap-2 rounded border border-(--ui-border) p-2 text-xs"
                    data-testid="marketplace-update-confirmation"
                >
                    <p v-if="confirmationBusy[entry.pluginId]" class="text-(--ui-text-muted)">
                        Confirming the installed update runs in this workspace…
                    </p>
                    <template v-else>
                        <p v-if="confirmationTimedOut[entry.pluginId]" class="text-(--ui-text-muted)">
                            {{ ACTIVATION_NOT_CONFIRMED_COPY }}. The installation stands.
                        </p>
                        <p v-else-if="confirmationFailed[entry.pluginId]" class="text-(--ui-text-muted)">
                            Activation did not complete{{
                                confirmationFailureCode[entry.pluginId]
                                    ? ` (${confirmationFailureCode[entry.pluginId]})`
                                    : ''
                            }}. The installation stands.
                        </p>
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                size="sm"
                                color="neutral"
                                variant="soft"
                                icon="i-lucide-rotate-ccw"
                                data-testid="marketplace-update-retry-confirmation"
                                @click="retryUpdateConfirmation(entry.pluginId)"
                            >
                                Retry confirmation
                            </UButton>
                            <UButton
                                size="sm"
                                color="neutral"
                                variant="ghost"
                                icon="i-lucide-clipboard-list"
                                data-testid="marketplace-update-copy-diagnostics"
                                @click="copyUpdateDiagnostics(entry.pluginId)"
                            >
                                Copy diagnostics
                            </UButton>
                        </div>
                    </template>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        size="sm"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-check"
                        :loading="busyPluginId === entry.pluginId"
                        data-testid="marketplace-update-activate"
                        @click="activate(entry)"
                    >
                        {{ updateNote[entry.pluginId]?.retryable ? 'Continue' : 'Check and activate' }}
                    </UButton>
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        :to="`/plugins/${entry.pluginId}/setup`"
                    >
                        Review setup
                    </UButton>
                </div>
            </li>
        </ul>
    </div>
</template>
