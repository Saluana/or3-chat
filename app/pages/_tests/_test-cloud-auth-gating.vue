<template>
    <main class="mx-auto max-w-5xl p-6 space-y-6" data-testid="auth-gating-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Cloud Auth Gating Harness</h1>
            <p class="text-sm opacity-80">
                Probes SSR cloud endpoints and verifies expected behavior for auth-enabled versus auth-disabled mode.
            </p>
        </header>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between">
                    <span class="font-medium">Mode</span>
                    <UBadge color="primary" variant="soft" data-testid="expected-mode">
                        {{ expectedMode }}
                    </UBadge>
                </div>
            </template>
            <div class="space-y-2 text-sm">
                <div>
                    `runtimeConfig.public.ssrAuthEnabled`: <strong data-testid="runtime-ssr-auth">{{ publicSsrAuthEnabled }}</strong>
                </div>
                <div>
                    `runtimeConfig.public.sync.enabled`: <strong data-testid="runtime-sync-enabled">{{ publicSyncEnabled }}</strong>
                </div>
                <div>
                    `runtimeConfig.public.storage.enabled`: <strong data-testid="runtime-storage-enabled">{{ publicStorageEnabled }}</strong>
                </div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between">
                    <span class="font-medium">Endpoint Probes</span>
                    <UButton data-testid="run-auth-probes" color="primary" :loading="running" @click="runProbes">
                        Run Probes
                    </UButton>
                </div>
            </template>

            <table class="w-full text-sm border-collapse" data-testid="probe-table">
                <thead>
                    <tr class="text-left border-b border-default">
                        <th class="py-2">Endpoint</th>
                        <th class="py-2">Method</th>
                        <th class="py-2">Status</th>
                        <th class="py-2">Verdict</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="probe in probes" :key="probe.id" class="border-b border-default/60">
                        <td class="py-2" :data-testid="`probe-endpoint-${probe.id}`">{{ probe.path }}</td>
                        <td class="py-2">{{ probe.method }}</td>
                        <td class="py-2" :data-testid="`probe-status-${probe.id}`">{{ probe.status ?? 'pending' }}</td>
                        <td class="py-2" :data-testid="`probe-pass-${probe.id}`">
                            {{ probe.pass == null ? 'pending' : probe.pass ? 'pass' : 'fail' }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </UCard>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between">
                    <span class="font-medium">Overall</span>
                    <UBadge :color="overallPass ? 'success' : 'error'" variant="soft" data-testid="auth-overall-pass">
                        {{ overallPass ? 'pass' : 'fail' }}
                    </UBadge>
                </div>
            </template>
            <pre class="max-h-60 overflow-auto text-xs whitespace-pre-wrap" data-testid="auth-log">{{ logText }}</pre>
        </UCard>
    </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type Probe = {
    id: string;
    path: string;
    method: 'GET' | 'POST';
    body?: Record<string, unknown>;
    status: number | null;
    pass: boolean | null;
};

const runtimeConfig = useRuntimeConfig();
const running = ref(false);
const logs = ref<string[]>([]);

const publicSsrAuthEnabled = computed(() => runtimeConfig.public?.ssrAuthEnabled === true);
const publicSyncEnabled = computed(() => runtimeConfig.public?.sync?.enabled !== false);
const publicStorageEnabled = computed(() => runtimeConfig.public?.storage?.enabled !== false);
const expectedMode = computed(() => (publicSsrAuthEnabled.value ? 'auth-enabled' : 'auth-disabled'));

const probes = ref<Probe[]>([
    {
        id: 'auth-session',
        path: '/api/auth/session',
        method: 'GET',
        status: null,
        pass: null,
    },
    {
        id: 'sync-pull',
        path: '/api/sync/pull',
        method: 'POST',
        body: {
            scope: { workspaceId: 'ws-test' },
            cursor: 0,
            limit: 1,
        },
        status: null,
        pass: null,
    },
    {
        id: 'sync-push',
        path: '/api/sync/push',
        method: 'POST',
        body: {
            scope: { workspaceId: 'ws-test' },
            ops: [],
        },
        status: null,
        pass: null,
    },
    {
        id: 'storage-presign-upload',
        path: '/api/storage/presign-upload',
        method: 'POST',
        body: {
            workspace_id: 'ws-test',
            hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            mime_type: 'image/png',
            size_bytes: 1,
        },
        status: null,
        pass: null,
    },
]);

const overallPass = computed(() => probes.value.every((probe) => probe.pass === true));
const logText = computed(() => logs.value.join('\n'));

function appendLog(message: string): void {
    logs.value.push(`[${new Date().toISOString()}] ${message}`);
}

function evaluateProbeStatus(status: number): boolean {
    if (!publicSsrAuthEnabled.value) {
        return status === 404 || status === 405;
    }
    return status !== 404;
}

async function executeProbe(probe: Probe): Promise<void> {
    try {
        const response = await fetch(probe.path, {
            method: probe.method,
            headers: probe.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
            body: probe.method === 'POST' ? JSON.stringify(probe.body ?? {}) : undefined,
        });
        probe.status = response.status;
        probe.pass = evaluateProbeStatus(response.status);
        appendLog(`${probe.method} ${probe.path} -> ${response.status} (${probe.pass ? 'pass' : 'fail'})`);
    } catch (error) {
        probe.status = 0;
        probe.pass = false;
        appendLog(`${probe.method} ${probe.path} -> network error: ${(error as Error).message}`);
    }
}

async function runProbes(): Promise<void> {
    running.value = true;
    logs.value = [];
    for (const probe of probes.value) {
        probe.status = null;
        probe.pass = null;
    }
    appendLog(`Expected mode: ${expectedMode.value}`);

    for (const probe of probes.value) {
        await executeProbe(probe);
    }
    running.value = false;
}
</script>
