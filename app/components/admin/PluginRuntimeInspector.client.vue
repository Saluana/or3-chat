<template>
    <section
        class="space-y-4 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-4"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h3 class="text-lg font-medium">Runtime inspector</h3>
                <p class="mt-1 text-xs opacity-70">
                    Plugin lifecycle records from this browser client. This
                    is not fleet-wide server status and does not infer activity
                    from workspace enablement.
                </p>
            </div>
            <UButton size="xs" color="neutral" variant="soft" @click="refresh">
                Refresh
            </UButton>
        </div>

        <div class="grid gap-2 text-xs sm:grid-cols-3">
            <div class="rounded-[var(--md-border-radius-small)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">This client</div>
                <div class="mt-1 opacity-75">
                    {{ activeGenerationCount }} active bundled generation(s)
                </div>
            </div>
            <div class="rounded-[var(--md-border-radius-small)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] p-3">
                <div class="font-semibold">This server process</div>
                <div class="mt-1 opacity-75">
                    Server runtime is outside this client’s scope
                </div>
            </div>
            <div class="rounded-[var(--md-border-radius-small)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] p-3">
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
                :color="moduleLoaderV2Status.packagesSupported ? 'success' : 'neutral'"
                variant="subtle"
            >
                Module loader:
                {{
                    moduleLoaderV2Status.packagesSupported
                        ? 'package modules'
                        : moduleLoaderV2Status.reason === 'static-build-unsupported'
                          ? 'static unsupported'
                          : 'bundled modules'
                }}
            </UBadge>
            <UBadge
                v-if="pluginModuleLoaderV2Enabled"
                color="neutral"
                variant="subtle"
            >
                Package canaries: {{ moduleLoaderV2WorkspaceLabel }}
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
                :color="bundledManagerEnabled ? 'success' : 'neutral'"
                variant="subtle"
            >
                Bundled plugin manager:
                {{ bundledManagerEnabled ? 'enabled' : 'disabled' }}
            </UBadge>
            <UBadge color="neutral" variant="subtle">
                V2 contribution surfaces: {{ contributionSurfaceLabel }}
            </UBadge>
        </div>

        <details
            v-if="bundledManagerEnabled"
            class="rounded-[var(--md-border-radius-small)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] p-3 text-xs"
        >
            <summary class="cursor-pointer font-medium">
                Bundled plugin records ({{ bundledManagerRecords.length }})
            </summary>
            <div v-if="bundledManagerRecords.length" class="mt-3 space-y-2">
                <div
                    v-for="record in bundledManagerRecords"
                    :key="`${record.descriptor.id}:${record.generation}:${record.updatedAt}`"
                    class="rounded-[var(--md-border-radius-small)] bg-[var(--md-surface-container-low)] p-2"
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
                        {{ presentError(record.lastError, { source: 'plugin', code: 'ERR_HOOK_FAILURE' }).message }}
                    </div>
                    <div v-if="record.nextRetryAt" class="mt-1 opacity-75">
                        Retry after
                        {{ new Date(record.nextRetryAt).toLocaleTimeString() }}
                    </div>
                </div>
            </div>
            <p v-else class="mt-3 opacity-70">
                No bundled plugin records on this client.
            </p>
        </details>

        <details
            class="rounded-[var(--md-border-radius-small)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] p-3 text-xs"
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
                    class="rounded-[var(--md-border-radius-small)] bg-[var(--md-surface-container-low)] p-2"
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
                class="mt-3 rounded-[var(--md-border-radius-small)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] p-2"
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
    </section>
</template>

<script setup lang="ts">
import { presentError } from '~~/shared/errors';
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
const bundledManager = getBundledV1WorkspaceManager();
const bundledManagerEnabled = !!bundledManager;
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
const moduleLoaderV2WorkspaceIds = [
    ...((
        runtimeConfig.public as {
            admin?: { pluginModuleLoaderV2WorkspaceIds?: string[] };
        }
    ).admin?.pluginModuleLoaderV2WorkspaceIds ?? []),
];
const moduleLoaderV2WorkspaceLabel = moduleLoaderV2WorkspaceIds.length
    ? moduleLoaderV2WorkspaceIds.join(', ')
    : 'all workspaces when enabled';
const hookEngineVersion =
    (globalThis as { __NUXT_HOOKS_VERSION__?: 'v1' | 'v2' })
        .__NUXT_HOOKS_VERSION__ ?? (hookEngineV2Enabled ? 'v2' : 'v1');
const bundledManagerRecords = shallowRef(bundledManager?.listRecords() ?? []);
const activeGenerationCount = computed(() =>
    bundledManagerRecords.value.filter((record) => record.status === 'active').length
);
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
        safeModeEnabled,
        manager: bundledManager,
        descriptorKey: selectedDescriptorKey.value,
    })
);
let lastRefreshFingerprint = '';

function refresh() {
    const nextBundledManagerRecords = bundledManager?.listRecords() ?? [];
    const fingerprint = JSON.stringify(nextBundledManagerRecords);
    if (fingerprint === lastRefreshFingerprint) return;
    lastRefreshFingerprint = fingerprint;
    bundledManagerRecords.value = nextBundledManagerRecords;
    if (!selectedDescriptorKey.value && bundledManagerRecords.value[0]) {
        selectedDescriptorKey.value =
            bundledManagerRecords.value[0].descriptor.descriptorKey;
    }
}

async function runControl(controlId: RuntimeControlId) {
    controlBusy.value = controlId;
    try {
        const result = await executeRuntimeControl(controlId, {
            safeModeEnabled,
            manager: bundledManager,
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
