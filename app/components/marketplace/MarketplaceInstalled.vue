<script setup lang="ts">
/**
 * Dashboard > Marketplace > Installed and Updates.
 *
 * One lifecycle for both views: the installed list enables, disables, opens,
 * configures and removes during the acquisition-created packages, and the update
 * list filters the same entries down to those with a recorded candidate so a
 * release is reviewed, health-checked and activated through the same services.
 */
import { inject, onMounted, ref } from 'vue';
import { useToast } from '#imports';
import { useMarketplaceInstalled } from '~/composables/marketplace/useMarketplace';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';
import { setMarketplaceSetupPlugin } from '~/composables/marketplace/useMarketplaceSetup';
import {
    getPortableClientSource,
    isPortableActivationReady,
    usePortableActivations,
} from '~/composables/plugins/portable-client-runtime';
import {
    describeLifecycleBadge,
    type PluginLifecycleView,
} from '~~/shared/plugins/lifecycle/lifecycle-view';
import { openPortablePane } from '~/composables/plugins/portable-pane';


const toast = useToast();
const installed = useMarketplaceInstalled();
const navigation = useDashboardNavigation();
const activations = usePortableActivations();
const closeDashboard = inject<() => void>('or3:dashboard:close', () => {});
const busyPluginId = ref<string | null>(null);
onMounted(() => installed.load());

function openConfigure(pluginId: string): void {
    setMarketplaceSetupPlugin(pluginId);
    void navigation.openPage('marketplace', 'configure');
}

async function openPlugin(pluginId: string): Promise<void> {
    if (!getPortableClientSource(pluginId)) {
        toast.add({ title: 'Plugin interface unavailable', description: 'The plugin runtime is not available in this workspace. Check runtime diagnostics in Admin → Plugins. Configure opens setup only.', color: 'warning' });
        return;
    }
    try {
        await openPortablePane(pluginId);
        closeDashboard();
    } catch (error) {
        toast.add({title: 'Could not open plugin', description: error instanceof Error ? error.message : 'The workspace pane is unavailable.', color: 'warning'});
    }
}

function isEnabled(pluginId: string): boolean {
    return installed.enabled.value.includes(pluginId);
}

function isPortable(pluginId: string): boolean {
    return activations.has(`portable:${pluginId}`) || activations.has(pluginId);
}

function activationFor(pluginId: string) {
    return activations.get(`portable:${pluginId}`) ?? activations.get(pluginId) ?? null;
}

type InstalledEntry = (typeof installed.packages.value)[number];

/**
 * The truthful lifecycle projection for one installed package: the
 * instance-selected identity comes from the server DTO, the observed identity
 * from the live activation in this browser/workspace. A matching version with
 * a different digest never counts as running.
 */
function lifecycleFor(entry: InstalledEntry): PluginLifecycleView {
    const selectedDigest =
        entry.display?.selectedDigest ?? entry.startup.selectedDigest ?? null;
    const selected =
        selectedDigest && entry.display?.version
            ? {
                  pluginId: entry.pluginId,
                  version: entry.display.version,
                  packageTreeSha256: selectedDigest,
                  manifestSha256: null,
                  source: 'instance-selection' as const,
              }
            : null;
    const activation = activationFor(entry.pluginId);
    if (!activation) {
        return {
            selected,
            acquisition: null,
            runtime: { state: 'not-observed' },
            activationTimedOut: false,
        };
    }
    if (activation.status === 'blocked' || activation.status === 'stopped') {
        return {
            selected,
            acquisition: null,
            runtime: {
                state: 'failed',
                code: activation.blockCode ?? activation.status,
            },
            activationTimedOut: false,
        };
    }
    const observed = {
        pluginId: activation.pluginId,
        version: activation.version,
        packageTreeSha256: activation.packageDigest,
        manifestSha256: null,
    };
    const matches =
        selected !== null &&
        activation.packageDigest === selected.packageTreeSha256 &&
        activation.workspaceId === installed.workspaceId.value;
    if (activation.status === 'active' && matches && isPortableActivationReady(activation)) {
        return {
            selected,
            acquisition: null,
            runtime: {
                state: 'running',
                identity: observed,
                observedAt: new Date().toISOString(),
                degradedContributions: [...activation.degradedContributions],
            },
            activationTimedOut: false,
        };
    }
    if (matches) {
        return {
            selected,
            acquisition: null,
            runtime: { state: 'starting', identity: observed },
            activationTimedOut: false,
        };
    }
    return { selected, acquisition: null, runtime: { state: 'not-observed' }, activationTimedOut: false };
}

/** Single status badge: installed (selected) versus actually running here. */
function lifecycleBadge(entry: InstalledEntry): { readonly state: string; readonly label: string } {
    return describeLifecycleBadge(lifecycleFor(entry), {
        enabled: isEnabled(entry.pluginId),
        isDevelopmentCandidate: entry.localAdmission?.provenance === 'local-development',
    });
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
        case 'running':
            return 'bg-success/10 text-success ring-success/25';
        case 'running-degraded':
        case 'starting':
            return 'bg-info text-[var(--md-on-info)] ring-[var(--md-info)]/25';
        case 'activation-not-confirmed':
        case 'failed':
            return 'bg-warning/10 text-warning ring-warning/25';
        default:
            return 'bg-elevated text-[var(--ui-text-muted)] ring-[var(--ui-border)]';
    }
}

/** Previous code selection exists, so recovery can be offered (data is kept, not migrated). */
function canRollback(entry: InstalledEntry): boolean {
    return Boolean(entry.pointer?.previous);
}

async function toggle(pluginId: string): Promise<void> {
    busyPluginId.value = pluginId;
    try {
        await installed.setEnabled(pluginId, !isEnabled(pluginId));
    } catch (error) {
        toast.add({
            title: 'Could not change the workspace state',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}

async function uninstall(pluginId: string): Promise<void> {
    busyPluginId.value = pluginId;
    try {
        await installed.uninstall(pluginId);
        toast.add({
            title: 'Plugin removed',
            description: 'Its data is kept unless you delete it explicitly.',
            color: 'success',
        });
    } catch (error) {
        toast.add({
            title: 'Could not remove the plugin',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}

async function rollback(pluginId: string): Promise<void> {
    busyPluginId.value = pluginId;
    try {
        await installed.rollback(pluginId);
        toast.add({ title: 'Rolled back to the previous version', color: 'success' });
    } catch (error) {
        toast.add({
            title: 'Rollback was refused',
            description: error instanceof Error ? error.message : 'State compatibility may block it.',
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
        <div v-if="installed.error.value" class="text-sm text-(--ui-text-muted)" data-testid="marketplace-installed-error">
            {{ installed.error.value }}
        </div>

        <div class="flex justify-end">
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

        <section class="flex flex-col gap-4" data-testid="marketplace-installed">
            <h3 class="text-base font-medium">Installed</h3>
            <div v-if="installed.loading.value" class="text-sm text-(--ui-text-muted)">Loading…</div>
            <div v-else-if="installed.packages.value.length === 0" class="text-sm text-(--ui-text-muted)">
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
                            v-if="activationFor(entry.pluginId)?.status === 'blocked'"
                            color="warning"
                            variant="subtle"
                        >
                            Blocked: {{ activationFor(entry.pluginId)?.blockCode }}
                        </UBadge>
                    </div>
                    <details class="text-xs text-(--ui-text-muted)">
                        <summary class="cursor-pointer">Package identities</summary>
                        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                            <dt>Selected version</dt>
                            <dd class="break-all">{{ entry.display?.version ?? 'none' }}</dd>
                            <dt>Selected digest</dt>
                            <dd class="break-all">{{ entry.display?.selectedDigest ?? entry.startup.selectedDigest ?? 'none' }}</dd>
                            <dt>Running version</dt>
                            <dd class="break-all">{{ activationFor(entry.pluginId)?.version ?? 'not running here' }}</dd>
                            <dt>Running digest</dt>
                            <dd class="break-all">{{ activationFor(entry.pluginId)?.packageDigest ?? 'not running here' }}</dd>
                        </dl>
                        <p class="mt-2">Running means this browser observed the exact selected package; a matching version with a different digest never counts.</p>
                    </details>
                    <div class="flex flex-wrap gap-2">
                        <UButton
                            v-if="entry.display?.canOpen"
                            size="sm"
                            color="primary"
                            variant="soft"
                            icon="i-lucide-play"
                            :disabled="!isEnabled(entry.pluginId)"
                            @click="openPlugin(entry.pluginId)"
                        >
                            Open
                        </UButton>
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="soft"
                            icon="i-lucide-settings"
                            @click="openConfigure(entry.pluginId)"
                        >
                            Configure
                        </UButton>
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="soft"
                            :loading="busyPluginId === entry.pluginId"
                            @click="toggle(entry.pluginId)"
                        >
                            {{ isEnabled(entry.pluginId) ? 'Disable' : 'Enable' }}
                        </UButton>
                        <UButton
                            size="sm"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-trash-2"
                            :loading="busyPluginId === entry.pluginId"
                            @click="uninstall(entry.pluginId)"
                        >
                            Uninstall
                        </UButton>
                        <UButton
                            v-if="canRollback(entry)"
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-undo-2"
                            title="Restores the previous code selection. Plugin data is kept, not migrated: data written by the newer version may not be readable."
                            :loading="busyPluginId === entry.pluginId"
                            @click="rollback(entry.pluginId)"
                        >
                            Roll back
                        </UButton>
                    </div>
                </li>
            </ul>
        </section>

        <p v-if="installed.role.value && installed.role.value !== 'owner'" class="text-xs text-(--ui-text-muted)">
            Advanced package operations and raw uploads remain on the admin plugins page.
        </p>
    </div>
</template>
