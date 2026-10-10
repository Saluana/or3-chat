<script setup lang="ts">
/**
 * Dashboard > Marketplace > Installed and Updates.
 *
 * One lifecycle for both views: the installed list enables, disables, opens,
 * configures and removes during the acquisition-created packages, and the update
 * list filters the same entries down to those with a recorded candidate so a
 * release is reviewed, health-checked and activated through the same services.
 */
import { computed, inject, onMounted, ref, watch } from 'vue';
import ConfirmDialog from '~/components/admin/ConfirmDialog.vue';
import { useRoute, useRouter, useToast } from '#imports';
import { MarketplaceRefreshError, marketplacePluginDeepLink, useMarketplaceInstalled } from '~/composables/marketplace/useMarketplace';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { setMarketplaceSetupPlugin } from '~/composables/marketplace/useMarketplaceSetup';
import { isPortableActivationReady, usePortableActivations } from '~/composables/plugins/portable-client-runtime';
import {
    describePluginStatus,
} from '~~/shared/plugins/lifecycle/lifecycle-view';
import { pluginLifecycleView } from '~/composables/plugins/plugin-lifecycle-view';
import { openInstalledPluginPane } from '~/composables/plugins/portable-pane';
import { useTrustedV2Activations } from '~/composables/plugins/trusted-v2-manager';
import { requestWorkspacePluginReconcile } from '~/composables/plugins/bundled-v1-manager-runtime';


const toast = useToast();
const route = useRoute();
const router = useRouter();
const installed = useMarketplaceInstalled();
const sessionWorkspaceId = computed(() => getCachedSessionContext()?.workspace?.id ?? null);
const hasCurrentWorkspace = computed(() => !installed.stale.value &&
    (sessionWorkspaceId.value === null || sessionWorkspaceId.value === installed.workspaceId.value));

const pendingUninstall = ref<{ pluginId: string; version: string; digest: string; workspaceId: string | null } | null>(null);
const uninstallOpen = computed({ get: () => pendingUninstall.value !== null, set: (open: boolean) => { if (!open) pendingUninstall.value = null; } });
function requestUninstall(pluginId: string): void {
    if (!hasCurrentWorkspace.value) return;
    const entry = installed.packages.value.find((value) => value.pluginId === pluginId);
    const digest = entry?.pointer?.current?.packageDigest;
    if (digest) pendingUninstall.value = { pluginId, digest, version: entry?.display?.version ?? 'selected version', workspaceId: installed.workspaceId.value };
}
const activations = usePortableActivations();
const trustedActivations = useTrustedV2Activations();
const closeDashboard = inject<() => void>('or3:dashboard:close', () => {});
const busyPluginId = ref<string | null>(null);
type HealthResult = {
    workspaceId: string;
    digest: string;
    checkedAt: string;
    activation: 'confirmed' | 'failed' | 'not-observed' | 'not-applicable' | 'unavailable';
    observedAt: string | null;
    reason: string | null;
};
const healthResults = ref<Record<string, HealthResult>>({});
const checkingPluginId = ref<string | null>(null);
let healthGeneration = 0;
onMounted(() => installed.load(sessionWorkspaceId.value));
watch(sessionWorkspaceId, (next, previous) => {
    if (next === previous) return;
    pendingUninstall.value = null;
    healthGeneration += 1;
    healthResults.value = {};
    checkingPluginId.value = null;
    installed.invalidate();
    void installed.load(next);
}, { flush: 'sync' });

function openConfigure(pluginId: string): void {
    if (!hasCurrentWorkspace.value) return;
    setMarketplaceSetupPlugin(pluginId);
    void router.replace({ query: { ...route.query, dashboard: 'marketplace', page: 'configure',
        from: 'installed', setup: '1', plugin: pluginId, workspace: installed.workspaceId.value ?? undefined,
        acquisition: undefined, installRequest: undefined, rollout: undefined,
        version: installed.packages.value.find((entry) => entry.pluginId === pluginId)?.display?.version ?? undefined } });
}

async function openPlugin(pluginId: string): Promise<void> {
    if (!hasCurrentWorkspace.value) return;
    try {
        if (await openInstalledPluginPane(pluginId)) closeDashboard();
    } catch (error) {
        toast.add({title: 'Could not open plugin', description: error instanceof Error ? error.message : 'The workspace pane is unavailable.', color: 'warning'});
    }
}

function isEnabled(pluginId: string): boolean {
    return installed.enabled.value.includes(pluginId);
}

function activationFor(pluginId: string) {
    return activations.get(`portable:${pluginId}`) ?? activations.get(pluginId) ?? null;
}

function selectedActivationFor(entry: InstalledEntry) {
    const activation = activationFor(entry.pluginId);
    return activation?.workspaceId === installed.workspaceId.value &&
        activation.packageDigest === (entry.display?.selectedDigest ?? entry.startup.selectedDigest) ? activation : null;
}

function trustedActivationFor(pluginId: string) {
    const activation = trustedActivations.get(pluginId);
    return activation?.workspaceId === installed.workspaceId.value ? activation : null;
}

type InstalledEntry = (typeof installed.packages.value)[number];

function healthFor(entry: InstalledEntry): HealthResult | null {
    const result = healthResults.value[entry.pluginId];
    return result?.workspaceId === installed.workspaceId.value &&
        result.digest === (entry.display?.selectedDigest ?? entry.startup.selectedDigest) ? result : null;
}

/** Reconcile and observe this browser only; no package acquisition or workflow execution. */
async function runHealthCheck(entry: InstalledEntry): Promise<void> {
    const workspaceId = installed.workspaceId.value;
    const digest = entry.display?.selectedDigest ?? entry.startup.selectedDigest;
    if (!workspaceId || !digest || !hasCurrentWorkspace.value) return;
    const generation = ++healthGeneration;
    checkingPluginId.value = entry.pluginId;
    const finish = (activation: HealthResult['activation'], observedAt: string | null, reason: string | null) => {
        if (generation !== healthGeneration) return;
        healthResults.value = { ...healthResults.value, [entry.pluginId]: {
            workspaceId, digest, checkedAt: new Date().toISOString(), activation, observedAt, reason,
        } };
    };
    try {
        const refreshed = await installed.load(workspaceId);
        if (generation !== healthGeneration || installed.workspaceId.value !== workspaceId) return;
        if (!refreshed) {
            finish('unavailable', null, installed.error.value ?? 'Server status could not be refreshed.');
            return;
        }
        const currentEntry = installed.packages.value.find((item) => item.pluginId === entry.pluginId);
        const currentDigest = currentEntry?.display?.selectedDigest ?? currentEntry?.startup.selectedDigest;
        if (!currentEntry || currentDigest !== digest) {
            finish('not-applicable', null, 'The selected package changed. Run the check again.');
            return;
        }
        if (currentEntry.startup.status !== 'ready' || !isEnabled(entry.pluginId)) {
            finish('not-applicable', null, currentEntry.startup.status !== 'ready' ? 'The selected package is not ready.' : 'Enable this plugin in the workspace first.');
            return;
        }
        requestWorkspacePluginReconcile('manifest-revision-change');
        const deadline = Date.now() + 30_000;
        for (;;) {
            if (generation !== healthGeneration || installed.workspaceId.value !== workspaceId ||
                (installed.packages.value.find((item) => item.pluginId === entry.pluginId)?.display?.selectedDigest ?? entry.startup.selectedDigest) !== digest) return;
            const portable = activationFor(entry.pluginId);
            if (portable?.workspaceId === workspaceId && portable.packageDigest === digest) {
                if (portable.status === 'blocked' || portable.status === 'stopped') {
                    finish('failed', null, portable.blockCode ?? portable.status);
                    return;
                }
                const failedRequired = (['pane', 'sidebar'] as const).find(
                    (surface) => portable.contributionReadiness?.[surface] === 'failed'
                );
                if (failedRequired) {
                    finish('failed', null, `${failedRequired} contribution failed. Check the plugin diagnostics or configuration.`);
                    return;
                }
                if (portable.status === 'active' && isPortableActivationReady(portable)) {
                    finish('confirmed', portable.startedAt === null ? new Date().toISOString() : new Date(portable.startedAt).toISOString(),
                        portable.degradedContributions.length ? `Optional contributions: ${portable.degradedContributions.join(', ')}` : null);
                    return;
                }
            }
            const trusted = trustedActivationFor(entry.pluginId);
            if (trusted?.packageDigest === digest) {
                finish('confirmed', trusted.observedAt, null);
                return;
            }
            if (Date.now() >= deadline) {
                finish('not-observed', null, 'No matching activation was observed in this browser within 30 seconds.');
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    } finally {
        if (generation === healthGeneration) checkingPluginId.value = null;
    }
}

function lifecycleBadge(entry: InstalledEntry) {
    return describePluginStatus(
        pluginLifecycleView(entry, installed.workspaceId.value, activations, trustedActivations),
        {
            enabled: isEnabled(entry.pluginId),
            siteApproval: entry.siteApproval ?? 'unknown',
            grantReview: entry.grantReview ?? 'unknown',
            setup: entry.setup ?? 'unknown',
            packageReady: entry.startup.status === 'ready',
        }
    );
}

/**
 * Chip styling for one lifecycle state.
 *
 * `info` is a container color in every OR3 theme (near-white in light mode,
 * near-black in dark mode), so a Nuxt UI `color="info"` badge paints its label
 * in a color that disappears into the surface. Its paired `on-info` token is
 * the readable foreground, which is what the chip uses instead.
 */
function lifecycleBadgeClass(state: string): string {
    switch (state) {
        case 'active':
            return 'bg-success/10 text-success ring-success/25';
        case 'enabled-unconfirmed':
        case 'starting':
            return 'bg-info text-[var(--md-on-info)] ring-[var(--md-info)]/25';
        case 'needs-attention':
            return 'bg-warning/10 text-warning ring-warning/25';
        default:
            return 'bg-elevated text-[var(--ui-text-muted)] ring-[var(--ui-border)]';
    }
}

async function toggle(pluginId: string): Promise<void> {
    if (!hasCurrentWorkspace.value) return;
    busyPluginId.value = pluginId;
    try {
        await installed.setEnabled(pluginId, !isEnabled(pluginId));
    } catch (error) {
        toast.add({
            title: error instanceof MarketplaceRefreshError ? 'Change saved; refresh needed' : 'Could not change the workspace state',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}

async function uninstall(): Promise<void> {
    const confirmed = pendingUninstall.value;
    pendingUninstall.value = null;
    if (!confirmed) return;
    const { pluginId } = confirmed;
    busyPluginId.value = pluginId;
    try {
        if (!hasCurrentWorkspace.value || confirmed.workspaceId !== installed.workspaceId.value || installed.packages.value.find((entry) => entry.pluginId === pluginId)?.pointer?.current?.packageDigest !== confirmed.digest) {
            throw new Error('The selected package changed. Review it again before removing it.');
        }
        await installed.uninstall(pluginId, confirmed.digest);
        toast.add({
            title: 'Plugin removed',
            description: 'Its data is kept unless you delete it explicitly.',
            color: 'success',
        });
    } catch (error) {
        toast.add({
            title: error instanceof MarketplaceRefreshError ? 'Change saved; refresh needed' : 'Could not remove the plugin',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}

/** Redacted support report: no settings, secrets, content or signed URLs. */
async function copyDiagnostics(): Promise<void> {
    try {
        const report = (await apiGet<Record<string, unknown>>('/api/plugins/diagnostics')) as Record<
            string,
            unknown
        >;
        const browser = {
            activations: [...activations.entries()].map(([id, activation]) => ({
                pluginId: id,
                status: activation.status,
                packageDigest: activation.packageDigest ?? null,
                version: activation.version ?? null,
                workspaceId: activation.workspaceId ?? null,
                generation: activation.generation ?? null,
                blockCode: activation.blockCode ?? null,
                crashed: activation.crashed,
                logCount: activation.logs.length,
                contributionCount: activation.contributions.length,
                degradedContributions: [...activation.degradedContributions].slice(0, 16),
            })),
            trustedActivations: [...trustedActivations.values()],
            selected: installed.packages.value.map((entry) => ({
                pluginId: entry.pluginId,
                version: entry.display?.version ?? null,
                selectedDigest: entry.display?.selectedDigest ?? entry.startup.selectedDigest,
                candidateVersion: entry.display?.candidateVersion ?? null,
                candidateDigest: entry.display?.candidateDigest ?? null,
            })),
        };
        await navigator.clipboard.writeText(
            JSON.stringify({ ...report, browser }, null, 2)
        );
        toast.add({
            title: 'Diagnostics copied',
            description: 'Settings, secrets, message content and signed URLs are not included.',
            color: 'success',
        });
    } catch (error) {
        toast.add({
            title: 'Could not build the report',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    }
}

async function apiGet<T>(url: string): Promise<T> {
    return (await ($fetch as unknown as (input: string) => Promise<unknown>)(url)) as T;
}
</script>

<template>
    <div class="dashboard-page-frame">
        <section
            v-if="installed.error.value"
            class="flex flex-col gap-4 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated)/40 p-4 sm:p-5"
            role="alert"
            data-testid="marketplace-installed-error"
        >
            <div class="flex items-start gap-3">
                <UIcon name="i-lucide-circle-alert" class="mt-0.5 shrink-0 text-(--ui-error)" />
                <div class="min-w-0">
                    <h3 class="font-medium">Couldn't load installed plugins</h3>
                    <p class="mt-1 text-sm text-(--ui-text-muted)">{{ installed.error.value }}</p>
                </div>
            </div>
            <div class="pl-7">
                <UButton size="sm" :loading="installed.loading.value" @click="installed.load(sessionWorkspaceId)">Try again</UButton>
            </div>
        </section>

        <div v-if="installed.canManageSitePlugins.value" class="flex justify-end">
            <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-clipboard-list"
                data-testid="marketplace-copy-diagnostics"
                @click="copyDiagnostics"
            >
                Copy diagnostics
            </UButton>
        </div>

        <section v-if="!installed.error.value || installed.packages.value.length > 0" class="flex flex-col gap-4" data-testid="marketplace-installed">
            <h3 class="text-base font-medium">Installed</h3>
            <p class="text-sm text-(--ui-text-muted)">Packages are installed once for this OR3 site. Enable or disable each plugin for the current workspace.</p>
            <div v-if="installed.loading.value" class="text-sm text-(--ui-text-muted)">Loading…</div>
            <div v-else-if="!installed.error.value && installed.packages.value.length === 0" class="text-sm text-(--ui-text-muted)">
                No packages are installed yet. Browse the marketplace to add one.
            </div>
            <ul v-else class="flex flex-col gap-4">
                <li
                    v-for="entry in installed.packages.value"
                    :key="entry.pluginId"
                    class="flex flex-col gap-3 rounded-lg border border-(--ui-border) p-4"
                >
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium">{{ entry.pluginId }}</span>
                        <UBadge color="neutral" variant="subtle">
                            installed {{ entry.display?.version ?? 'no version selected' }}
                        </UBadge>
                        <span
                            class="font-medium inline-flex items-center text-xs px-2 py-1 gap-1 rounded-md ring ring-inset"
                            :class="lifecycleBadgeClass(lifecycleBadge(entry).state)"
                            :data-lifecycle-state="lifecycleBadge(entry).state"
                        >
                            {{ lifecycleBadge(entry).label }}
                        </span>
                        <UBadge
                            v-if="selectedActivationFor(entry)?.status === 'blocked'"
                            color="warning"
                            variant="subtle"
                        >
                            Blocked: {{ selectedActivationFor(entry)?.blockCode }}
                        </UBadge>
                    </div>
                    <p class="text-xs text-(--ui-text-muted) break-words">{{ lifecycleBadge(entry).reason }}</p>
                    <div v-if="healthFor(entry)" class="rounded-md border border-(--ui-border) p-3 text-xs space-y-1" role="status">
                        <p>Checked {{ healthFor(entry)?.checkedAt }} for workspace {{ healthFor(entry)?.workspaceId }}.</p>
                        <p>Selected package: {{ entry.startup.status === 'ready' ? 'ready' : 'blocked' }}</p>
                        <p>Workspace: {{ isEnabled(entry.pluginId) ? 'enabled' : 'disabled' }}; permissions: {{ entry.grantReview ?? 'unknown' }}; setup: {{ entry.setup ?? 'unknown' }}</p>
                        <p>Browser activation: {{ healthFor(entry)?.activation === 'not-observed' ? 'Enabled; browser check pending' : healthFor(entry)?.activation === 'unavailable' ? 'Check unavailable' : healthFor(entry)?.activation }}<span v-if="healthFor(entry)?.observedAt"> at {{ healthFor(entry)?.observedAt }}</span></p>
                        <p v-if="healthFor(entry)?.reason" class="break-words">{{ healthFor(entry)?.reason }}</p>
                    </div>
                    <UButton v-if="installed.canManageSitePlugins.value && (lifecycleBadge(entry).action === 'approve-site' || lifecycleBadge(entry).action === 'review-permissions')"
                        size="xs" color="neutral" variant="soft" :to="`/admin/plugins?plugin=${encodeURIComponent(entry.pluginId)}`">
                        {{ lifecycleBadge(entry).action === 'approve-site' ? 'Review site approval' : 'Review permissions' }}
                    </UButton>
                    <details class="text-xs text-(--ui-text-muted)">
                        <summary class="cursor-pointer">Package identities</summary>
                        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                            <dt>Selected version</dt>
                            <dd class="break-all">{{ entry.display?.version ?? 'none' }}</dd>
                            <dt>Selected digest</dt>
                            <dd class="break-all">{{ entry.display?.selectedDigest ?? entry.startup.selectedDigest ?? 'none' }}</dd>
                            <dt>Running version</dt>
                            <dd class="break-all">{{ activationFor(entry.pluginId)?.version ?? trustedActivationFor(entry.pluginId)?.version ?? 'not running here' }}</dd>
                            <dt>Running digest</dt>
                            <dd class="break-all">{{ activationFor(entry.pluginId)?.packageDigest ?? trustedActivationFor(entry.pluginId)?.packageDigest ?? 'not running here' }}</dd>
                        </dl>
                        <p class="mt-2">Running means this browser observed the exact selected package; a matching version with a different digest never counts.</p>
                    </details>
                    <div class="flex flex-wrap gap-2">
                        <UButton size="sm" color="neutral" variant="soft"
                            :to="marketplacePluginDeepLink('', entry.pluginId, undefined, undefined, installed.workspaceId.value ?? undefined)">
                            View details
                        </UButton>
                        <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-heart-pulse"
                            :loading="checkingPluginId === entry.pluginId"
                            :disabled="!hasCurrentWorkspace || !entry.display?.selectedDigest || checkingPluginId !== null"
                            @click="runHealthCheck(entry)">
                            Run check
                        </UButton>
                        <UButton
                            v-if="entry.display?.canOpen"
                            size="sm"
                            color="primary"
                            variant="soft"
                            icon="i-lucide-play"
                            :disabled="!hasCurrentWorkspace || !isEnabled(entry.pluginId)"
                            @click="openPlugin(entry.pluginId)"
                        >
                            Open
                        </UButton>
                        <UButton
                            v-if="installed.canManageWorkspacePlugins.value"
                            size="sm"
                            color="neutral"
                            variant="soft"
                            icon="i-lucide-settings"
                            :disabled="!hasCurrentWorkspace"
                            @click="openConfigure(entry.pluginId)"
                        >
                            Configure
                        </UButton>
                        <UButton
                            v-if="installed.canManageWorkspacePlugins.value"
                            size="sm"
                            color="neutral"
                            variant="soft"
                            :loading="busyPluginId === entry.pluginId"
                            :disabled="!hasCurrentWorkspace || installed.loading.value || installed.mutating.value"
                            @click="toggle(entry.pluginId)"
                        >
                            {{ isEnabled(entry.pluginId) ? 'Disable' : 'Enable' }}
                        </UButton>
                        <UButton
                            v-if="installed.canManageSitePlugins.value"
                            size="sm"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-trash-2"
                            :loading="busyPluginId === entry.pluginId"
                            :disabled="!hasCurrentWorkspace || installed.loading.value || installed.mutating.value"
                            @click="requestUninstall(entry.pluginId)"
                        >
                            Uninstall
                        </UButton>
                    </div>
                </li>
            </ul>
        </section>

        <p v-if="installed.role.value && installed.role.value !== 'owner'" class="text-xs text-(--ui-text-muted)">
            Advanced package operations and raw uploads remain on the admin plugins page.
        </p>
    </div>
    <ConfirmDialog v-model="uninstallOpen" title="Remove plugin from this instance?"
        :message="pendingUninstall ? pendingUninstall.pluginId + ' ' + pendingUninstall.version + ' will stop in every workspace. Its data is retained. To stop it only here, cancel and choose Disable.' : ''"
        confirm-text="Remove from every workspace" danger @confirm="uninstall" />
</template>
