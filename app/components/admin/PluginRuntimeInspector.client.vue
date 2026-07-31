<template>
    <section
        class="space-y-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-4"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h3 class="text-lg font-medium">Runtime inspector</h3>
                <p class="mt-1 text-xs opacity-70">
                    Read-only shadow observations from this browser client. This
                    is not fleet-wide server status and does not infer activity
                    from workspace enablement.
                </p>
            </div>
            <UButton size="xs" color="neutral" variant="soft" @click="refresh">
                Refresh
            </UButton>
        </div>

        <div class="grid gap-2 text-xs sm:grid-cols-3">
            <div class="rounded border border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">This client</div>
                <div class="mt-1 opacity-75">
                    {{ records.length }} observed active generation(s)
                </div>
            </div>
            <div class="rounded border border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">This server process</div>
                <div class="mt-1 opacity-75">
                    Not observed by this client-only shadow manager
                </div>
            </div>
            <div class="rounded border border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">Persisted package state</div>
                <div class="mt-1 opacity-75">
                    Disable/rollback require server package lifecycle/promotion
                    surfaces; this client explains unavailability instead of
                    inventing fleet status
                </div>
            </div>
        </div>

        <div class="flex flex-wrap gap-2 text-xs">
            <UBadge
                :color="shadowObserverEnabled ? 'neutral' : 'warning'"
                variant="subtle"
            >
                Manager:
                {{
                    shadowObserverEnabled
                        ? 'shadow observer'
                        : 'V1 only (observer disabled)'
                }}
            </UBadge>
            <UBadge
                :color="moduleLoaderV2Status.packagesSupported ? 'success' : 'neutral'"
                variant="subtle"
            >
                Module loader:
                {{
                    moduleLoaderV2Status.packagesSupported
                        ? 'module-v2'
                        : moduleLoaderV2Status.reason === 'static-build-unsupported'
                          ? 'static unsupported'
                          : 'bundled-v1'
                }}
            </UBadge>
            <UBadge
                :color="hookEngineVersion === 'v2' ? 'success' : 'neutral'"
                variant="subtle"
            >
                Hook engine: {{ hookEngineVersion.toUpperCase() }} (this client)
            </UBadge>
            <UBadge
                :color="safeModeEnabled ? 'warning' : 'neutral'"
                variant="subtle"
            >
                Safe mode: {{ safeModeEnabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge
                :color="ssrAuthEnabled ? 'success' : 'neutral'"
                variant="subtle"
            >
                SSR auth: {{ ssrAuthEnabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge
                :color="runtimeLoaderEnabled ? 'success' : 'neutral'"
                variant="subtle"
            >
                Workspace loader:
                {{ runtimeLoaderEnabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge
                :color="managerV2Enabled ? 'success' : 'neutral'"
                variant="subtle"
            >
                V2 startup selector:
                {{ managerV2Enabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge v-if="managerV2Enabled" color="neutral" variant="subtle">
                Workspace canaries: {{ managerV2WorkspaceLabel }}
            </UBadge>
            <UBadge color="neutral" variant="subtle">
                V2 contribution surfaces: {{ contributionSurfaceLabel }}
            </UBadge>
        </div>

        <details
            v-if="managerV2Enabled"
            class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
        >
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
                        {{ record.descriptor.id }} · {{ record.status }} ·
                        generation
                        {{ record.generation }}
                    </div>
                    <div class="mt-1 break-all font-mono opacity-75">
                        {{ record.descriptor.descriptorKey }}
                    </div>
                    <div
                        v-if="record.lastError"
                        class="mt-1 text-[var(--md-error)]"
                    >
                        {{ record.lastError.code }}:
                        {{ record.lastError.message }}
                    </div>
                    <div v-if="record.nextRetryAt" class="mt-1 opacity-75">
                        Retry after
                        {{ new Date(record.nextRetryAt).toLocaleTimeString() }}
                    </div>
                </div>
            </div>
            <p v-else class="mt-3 opacity-70">
                No manager record in this client. Startup selection does not by
                itself imply an active plugin.
            </p>
        </details>

        <div v-if="records.length" class="space-y-2">
            <details
                v-for="record in records"
                :key="`${record.descriptor.id}:${record.generation}`"
                class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
            >
                <summary class="cursor-pointer font-medium">
                    {{ record.descriptor.id }} · generation
                    {{ record.generation }} ·
                    {{ record.status }}
                </summary>
                <dl class="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
                    <dt class="opacity-65">Desired / actual</dt>
                    <dd>{{ record.desired }} / {{ record.status }}</dd>
                    <dt class="opacity-65">Lifecycle coverage</dt>
                    <dd>{{ record.lifecycleCoverage }}</dd>
                    <dt class="opacity-65">Passed V1 API</dt>
                    <dd>
                        managed-v1-api; direct imports, timers, listeners, and
                        arbitrary side effects remain legacy-global-possible
                    </dd>
                    <dt class="opacity-65">Trust / source</dt>
                    <dd>
                        {{ record.descriptor.trust }} /
                        {{ record.descriptor.source }}
                    </dd>
                    <dt class="opacity-65">Workspace</dt>
                    <dd class="break-all font-mono">
                        {{ record.descriptor.workspaceId }}
                    </dd>
                    <dt class="opacity-65">Artifact</dt>
                    <dd class="break-all font-mono">
                        {{ record.descriptor.artifact.hostBuildId }} ·
                        {{ record.descriptor.artifact.moduleKey }}
                    </dd>
                    <dt class="opacity-65">Descriptor key</dt>
                    <dd class="break-all font-mono">
                        {{ record.descriptor.descriptorKey }}
                    </dd>
                    <dt class="opacity-65">Policy revision</dt>
                    <dd class="break-all font-mono">
                        {{ record.descriptor.policyRevision }}
                    </dd>
                    <dt class="opacity-65">Grants revision</dt>
                    <dd class="break-all font-mono">
                        {{ record.descriptor.grantsRevision }}
                    </dd>
                    <dt class="opacity-65">Contributions / hooks</dt>
                    <dd>
                        {{ record.contributionCount }} /
                        {{ record.hookCount }} (shadow-unattributed)
                    </dd>
                    <dt class="opacity-65">Retry / rollback</dt>
                    <dd>
                        Shadow records are observe-only. Use Runtime controls
                        with the V2 manager for retry/quarantine; package
                        rollback stays on the server promotion service
                    </dd>
                </dl>
            </details>
        </div>
        <p
            v-else
            class="rounded border border-dashed border-[var(--md-outline-variant)] p-3 text-xs opacity-70"
        >
            No active V1 generation has been observed in this client.
        </p>

        <details
            class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
            open
        >
            <summary class="cursor-pointer font-medium">
                Runtime controls ({{ controls.length }})
            </summary>
            <p class="mt-2 opacity-70">
                Controls call real manager/package operations when available.
                Unavailable actions explain why. This panel is not fleet-wide.
            </p>
            <div class="mt-3 space-y-2">
                <div
                    v-for="control in controls"
                    :key="control.id"
                    class="rounded bg-[var(--md-surface-container-low)] p-2"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div class="font-medium">{{ control.label }}</div>
                            <div class="opacity-75">{{ control.description }}</div>
                            <div class="mt-1 opacity-65">
                                Scope: {{ control.scope }} ·
                                {{
                                    control.availability.available
                                        ? 'available'
                                        : 'unavailable'
                                }}
                            </div>
                            <div
                                v-if="control.availability.reason"
                                class="mt-1 opacity-70"
                            >
                                {{ control.availability.reason }}
                            </div>
                        </div>
                        <UButton
                            size="xs"
                            color="neutral"
                            variant="soft"
                            :disabled="controlBusy === control.id"
                            @click="runControl(control.id)"
                        >
                            {{
                                control.availability.available ? 'Run' : 'Explain'
                            }}
                        </UButton>
                    </div>
                </div>
            </div>
            <p
                v-if="controlMessage"
                class="mt-3 rounded border border-[var(--md-outline-variant)] p-2"
                :class="
                    controlMessage.status === 'failed'
                        ? 'text-[var(--md-error)]'
                        : ''
                "
            >
                {{ controlMessage.controlId }}:
                {{ controlMessage.message }}
            </p>
            <div v-if="safeModeSteps.length" class="mt-3 space-y-1 opacity-80">
                <div class="font-medium">Safe-mode steps</div>
                <ol class="list-decimal space-y-1 pl-4">
                    <li v-for="(step, index) in safeModeSteps" :key="index">
                        {{ step }}
                    </li>
                </ol>
            </div>
        </details>

        <details
            class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
        >
            <summary class="cursor-pointer font-medium">
                Shadow divergences ({{ divergences.length }})
            </summary>
            <div v-if="divergences.length" class="mt-3 space-y-2">
                <div
                    v-for="item in divergences"
                    :key="item.sequence"
                    class="rounded bg-[var(--md-surface-container-low)] p-2 font-mono"
                >
                    #{{ item.sequence }} {{ item.kind }} · desired={{
                        item.desiredPluginId ?? '—'
                    }}
                    · observed={{ item.observedPluginId ?? '—' }} · source={{
                        item.desiredSource ?? '—'
                    }}/{{ item.observedSource ?? '—' }} · workspace={{
                        item.desiredWorkspaceId ?? '—'
                    }}/{{ item.observedWorkspaceId ?? '—' }}
                    <span v-if="item.rebuildRequiredReason">
                        · {{ item.rebuildRequiredReason }}</span
                    >
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
import { resolveModuleLoaderV2Status } from '~~/shared/plugins/module-loader-v2-status';
import {
    executeRuntimeControl,
    listRuntimeControls,
    type RuntimeControlId,
    type RuntimeControlResult,
} from '~~/shared/plugins/runtime-controls';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';

const runtimeConfig = useRuntimeConfig();
const shadowObserverEnabled =
    (
        runtimeConfig.public as {
            admin?: { pluginRuntimeShadowEnabled?: boolean };
        }
    ).admin?.pluginRuntimeShadowEnabled !== false;
const manager = shadowObserverEnabled ? getShadowPluginManager() : null;
const records = shallowRef(manager?.listRecords() ?? []);
const divergences = shallowRef(manager?.listDivergences() ?? []);
const ssrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
const safeModeEnabled =
    (runtimeConfig.public as { admin?: { disableNonCorePlugins?: boolean } })
        .admin?.disableNonCorePlugins === true;
const runtimeLoaderEnabled =
    (
        runtimeConfig.public as {
            admin?: { pluginRuntimeLoaderEnabled?: boolean };
        }
    ).admin?.pluginRuntimeLoaderEnabled !== false;
const managerV2Enabled =
    (runtimeConfig.public as { admin?: { pluginRuntimeV2Enabled?: boolean } })
        .admin?.pluginRuntimeV2Enabled === true;
const hookEngineV2Enabled =
    (runtimeConfig.public as { admin?: { hookEngineV2Enabled?: boolean } })
        .admin?.hookEngineV2Enabled === true;
const pluginModuleLoaderV2Enabled =
    (
        runtimeConfig.public as {
            admin?: { pluginModuleLoaderV2Enabled?: boolean };
        }
    ).admin?.pluginModuleLoaderV2Enabled === true;
const moduleLoaderV2Status = resolveModuleLoaderV2Status({
    enabled: pluginModuleLoaderV2Enabled,
    mode: ssrAuthEnabled ? 'ssr' : 'static',
    safeMode: safeModeEnabled,
});
const hookEngineVersion =
    (globalThis as { __NUXT_HOOKS_VERSION__?: 'v1' | 'v2' })
        .__NUXT_HOOKS_VERSION__ ?? (hookEngineV2Enabled ? 'v2' : 'v1');
const managerV2WorkspaceIds = [
    ...((
        runtimeConfig.public as {
            admin?: { pluginRuntimeV2WorkspaceIds?: string[] };
        }
    ).admin?.pluginRuntimeV2WorkspaceIds ?? []),
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
const selectedDescriptorKey = shallowRef<Sha256 | undefined>(undefined);
const controlMessage = shallowRef<RuntimeControlResult | null>(null);
const controlBusy = shallowRef<RuntimeControlId | null>(null);
const safeModeSteps = shallowRef<string[]>([]);
const controls = computed(() =>
    listRuntimeControls({
        managerV2Enabled,
        safeModeEnabled,
        manager: managerV2,
        descriptorKey: selectedDescriptorKey.value,
    })
);
let lastRefreshFingerprint = '';

function refresh() {
    const nextRecords = manager?.listRecords() ?? [];
    const nextDivergences = manager?.listDivergences() ?? [];
    const nextManagerV2Records = managerV2?.listRecords() ?? [];
    const fingerprint = JSON.stringify({
        records: nextRecords,
        divergences: nextDivergences,
        managerV2Records: nextManagerV2Records,
    });
    if (fingerprint === lastRefreshFingerprint) return;
    lastRefreshFingerprint = fingerprint;
    records.value = nextRecords;
    divergences.value = nextDivergences;
    managerV2Records.value = nextManagerV2Records;
    if (!selectedDescriptorKey.value && managerV2Records.value[0]) {
        selectedDescriptorKey.value =
            managerV2Records.value[0].descriptor.descriptorKey;
    }
}

async function runControl(controlId: RuntimeControlId) {
    controlBusy.value = controlId;
    try {
        const result = await executeRuntimeControl(controlId, {
            managerV2Enabled,
            safeModeEnabled,
            manager: managerV2,
            descriptorKey: selectedDescriptorKey.value,
        });
        controlMessage.value = result;
        if (
            result.status === 'ok' &&
            result.detail &&
            typeof result.detail === 'object' &&
            'steps' in result.detail &&
            Array.isArray((result.detail as { steps: unknown }).steps)
        ) {
            safeModeSteps.value = (
                result.detail as { steps: string[] }
            ).steps.slice();
        }
        refresh();
    } finally {
        controlBusy.value = null;
    }
}

onMounted(() => {
    refresh();
    window.addEventListener('or3:workspace-plugin-reconcile', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
});

onBeforeUnmount(() => {
    window.removeEventListener('or3:workspace-plugin-reconcile', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
});
</script>
