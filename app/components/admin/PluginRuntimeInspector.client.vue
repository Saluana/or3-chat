<template>
    <section
        class="space-y-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-4"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h3 class="text-lg font-medium">Runtime inspector</h3>
                <p class="mt-1 text-xs opacity-70">
                    Read-only shadow observations from this browser client. This is not fleet-wide
                    server status and does not infer activity from workspace enablement.
                </p>
            </div>
            <UButton size="xs" color="neutral" variant="soft" @click="refresh">
                Refresh
            </UButton>
        </div>

        <div class="grid gap-2 text-xs sm:grid-cols-3">
            <div class="rounded border border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">This client</div>
                <div class="mt-1 opacity-75">{{ records.length }} observed active generation(s)</div>
            </div>
            <div class="rounded border border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">This server process</div>
                <div class="mt-1 opacity-75">Not observed by this client-only shadow manager</div>
            </div>
            <div class="rounded border border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">Persisted package state</div>
                <div class="mt-1 opacity-75">Not available until the V2 package catalog ships</div>
            </div>
        </div>

        <div class="flex flex-wrap gap-2 text-xs">
            <UBadge :color="shadowObserverEnabled ? 'neutral' : 'warning'" variant="subtle">
                Manager: {{ shadowObserverEnabled ? 'shadow observer' : 'V1 only (observer disabled)' }}
            </UBadge>
            <UBadge color="neutral" variant="subtle">Module loader: bundled-v1</UBadge>
            <UBadge color="neutral" variant="subtle">Hook engine: V1</UBadge>
            <UBadge :color="safeModeEnabled ? 'warning' : 'neutral'" variant="subtle">
                Safe mode: {{ safeModeEnabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge :color="ssrAuthEnabled ? 'success' : 'neutral'" variant="subtle">
                SSR auth: {{ ssrAuthEnabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge :color="runtimeLoaderEnabled ? 'success' : 'neutral'" variant="subtle">
                Workspace loader: {{ runtimeLoaderEnabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge :color="managerV2Enabled ? 'success' : 'neutral'" variant="subtle">
                V2 startup selector: {{ managerV2Enabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge v-if="managerV2Enabled" color="neutral" variant="subtle">
                Workspace canaries: {{ managerV2WorkspaceLabel }}
            </UBadge>
            <UBadge color="neutral" variant="subtle">
                V2 contribution surfaces: {{ contributionSurfaceLabel }}
            </UBadge>
        </div>

        <details v-if="managerV2Enabled" class="rounded border border-[var(--md-outline-variant)] p-3 text-xs">
            <summary class="cursor-pointer font-medium">
                Manager-canary records ({{ managerV2Records.length }})
            </summary>
            <div v-if="managerV2Records.length" class="mt-3 space-y-2">
                <div
                    v-for="record in managerV2Records"
                    :key="`${record.descriptor.id}:${record.generation}:${record.updatedAt}`"
                    class="rounded bg-[var(--md-surface-container-low)] p-2"
                >
                    <div class="font-medium">
                        {{ record.descriptor.id }} · {{ record.status }} · generation {{ record.generation }}
                    </div>
                    <div class="mt-1 break-all font-mono opacity-75">
                        {{ record.descriptor.descriptorKey }}
                    </div>
                    <div v-if="record.lastError" class="mt-1 text-[var(--md-error)]">
                        {{ record.lastError.code }}: {{ record.lastError.message }}
                    </div>
                    <div v-if="record.nextRetryAt" class="mt-1 opacity-75">
                        Retry after {{ new Date(record.nextRetryAt).toLocaleTimeString() }}
                    </div>
                </div>
            </div>
            <p v-else class="mt-3 opacity-70">
                No manager record in this client. Startup selection does not by itself imply an active plugin.
            </p>
        </details>

        <div v-if="records.length" class="space-y-2">
            <details
                v-for="record in records"
                :key="`${record.descriptor.id}:${record.generation}`"
                class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
            >
                <summary class="cursor-pointer font-medium">
                    {{ record.descriptor.id }} · generation {{ record.generation }} ·
                    {{ record.status }}
                </summary>
                <dl class="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
                    <dt class="opacity-65">Desired / actual</dt>
                    <dd>{{ record.desired }} / {{ record.status }}</dd>
                    <dt class="opacity-65">Lifecycle coverage</dt>
                    <dd>{{ record.lifecycleCoverage }}</dd>
                    <dt class="opacity-65">Passed V1 API</dt>
                    <dd>
                        managed-v1-api; direct imports, timers, listeners, and arbitrary side
                        effects remain legacy-global-possible
                    </dd>
                    <dt class="opacity-65">Trust / source</dt>
                    <dd>{{ record.descriptor.trust }} / {{ record.descriptor.source }}</dd>
                    <dt class="opacity-65">Workspace</dt>
                    <dd class="break-all font-mono">{{ record.descriptor.workspaceId }}</dd>
                    <dt class="opacity-65">Artifact</dt>
                    <dd class="break-all font-mono">
                        {{ record.descriptor.artifact.hostBuildId }} ·
                        {{ record.descriptor.artifact.moduleKey }}
                    </dd>
                    <dt class="opacity-65">Descriptor key</dt>
                    <dd class="break-all font-mono">{{ record.descriptor.descriptorKey }}</dd>
                    <dt class="opacity-65">Policy revision</dt>
                    <dd class="break-all font-mono">{{ record.descriptor.policyRevision }}</dd>
                    <dt class="opacity-65">Grants revision</dt>
                    <dd class="break-all font-mono">{{ record.descriptor.grantsRevision }}</dd>
                    <dt class="opacity-65">Contributions / hooks</dt>
                    <dd>{{ record.contributionCount }} / {{ record.hookCount }} (shadow-unattributed)</dd>
                    <dt class="opacity-65">Retry / rollback</dt>
                    <dd>Not owned in shadow mode; V1 remains authoritative</dd>
                </dl>
            </details>
        </div>
        <p v-else class="rounded border border-dashed border-[var(--md-outline-variant)] p-3 text-xs opacity-70">
            No active V1 generation has been observed in this client.
        </p>

        <details class="rounded border border-[var(--md-outline-variant)] p-3 text-xs">
            <summary class="cursor-pointer font-medium">
                Shadow divergences ({{ divergences.length }})
            </summary>
            <div v-if="divergences.length" class="mt-3 space-y-2">
                <div
                    v-for="item in divergences"
                    :key="item.sequence"
                    class="rounded bg-[var(--md-surface-container-low)] p-2 font-mono"
                >
                    #{{ item.sequence }} {{ item.kind }} · desired={{ item.desiredPluginId ?? '—' }}
                    · observed={{ item.observedPluginId ?? '—' }} · source={{ item.desiredSource ?? '—' }}/{{ item.observedSource ?? '—' }}
                    · workspace={{ item.desiredWorkspaceId ?? '—' }}/{{ item.observedWorkspaceId ?? '—' }}
                    <span v-if="item.rebuildRequiredReason"> · {{ item.rebuildRequiredReason }}</span>
                </div>
            </div>
            <p v-else class="mt-3 opacity-70">No bounded divergence records.</p>
        </details>
    </section>
</template>

<script setup lang="ts">
import { getShadowPluginManager } from '~/composables/plugins/shadow-plugin-manager';
import { getBundledV1WorkspaceManager } from '~/composables/plugins/bundled-v1-manager-runtime';
import { getContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';

const runtimeConfig = useRuntimeConfig();
const shadowObserverEnabled =
    (runtimeConfig.public as { admin?: { pluginRuntimeShadowEnabled?: boolean } }).admin
        ?.pluginRuntimeShadowEnabled !== false;
const manager = shadowObserverEnabled ? getShadowPluginManager() : null;
const records = shallowRef(manager?.listRecords() ?? []);
const divergences = shallowRef(manager?.listDivergences() ?? []);
const ssrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
const safeModeEnabled =
    (runtimeConfig.public as { admin?: { disableNonCorePlugins?: boolean } }).admin
        ?.disableNonCorePlugins === true;
const runtimeLoaderEnabled =
    (runtimeConfig.public as { admin?: { pluginRuntimeLoaderEnabled?: boolean } }).admin
        ?.pluginRuntimeLoaderEnabled !== false;
const managerV2Enabled =
    (runtimeConfig.public as { admin?: { pluginRuntimeV2Enabled?: boolean } }).admin
        ?.pluginRuntimeV2Enabled === true;
const managerV2WorkspaceIds = [
    ...((runtimeConfig.public as { admin?: { pluginRuntimeV2WorkspaceIds?: string[] } }).admin
        ?.pluginRuntimeV2WorkspaceIds ?? []),
];
const managerV2WorkspaceLabel = managerV2WorkspaceIds.length
    ? managerV2WorkspaceIds.join(', ')
    : 'all';
const managerV2 = managerV2Enabled ? getBundledV1WorkspaceManager() : null;
const managerV2Records = shallowRef(managerV2?.listRecords() ?? []);
const contributionSurfaces = getContributionSurfaceSelection().listSelected();
const contributionSurfaceLabel = contributionSurfaces.length
    ? contributionSurfaces.join(', ')
    : 'V1 only';
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function refresh() {
    records.value = manager?.listRecords() ?? [];
    divergences.value = manager?.listDivergences() ?? [];
    managerV2Records.value = managerV2?.listRecords() ?? [];
}

onMounted(() => {
    refresh();
    refreshTimer = setInterval(refresh, 1000);
});

onBeforeUnmount(() => {
    if (refreshTimer) clearInterval(refreshTimer);
});
</script>
