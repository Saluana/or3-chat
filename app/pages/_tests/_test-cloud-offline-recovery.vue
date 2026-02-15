<template>
    <main class="mx-auto max-w-5xl p-6 space-y-6" data-testid="offline-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Cloud Offline Recovery Harness</h1>
            <p class="text-sm opacity-80">
                Simulates offline local edits, reconnect flush, and notification storm protection.
            </p>
        </header>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div class="font-medium">Controls</div>
                    <UBadge :color="isOffline ? 'warning' : 'success'" variant="soft" data-testid="connection-state">
                        {{ isOffline ? 'offline' : 'online' }}
                    </UBadge>
                </div>
            </template>

            <div class="flex flex-wrap gap-2">
                <UButton data-testid="offline-reset" color="neutral" variant="soft" @click="resetHarness">
                    Reset
                </UButton>
                <UButton data-testid="go-offline" color="warning" variant="soft" @click="goOffline">
                    Go Offline
                </UButton>
                <UButton data-testid="create-local-edit" color="primary" @click="createLocalEdit">
                    Create Local Edit
                </UButton>
                <UButton data-testid="go-online-and-flush" color="success" @click="goOnlineAndFlush">
                    Reconnect + Flush
                </UButton>
                <UButton data-testid="run-offline-scenario" color="primary" variant="outline" @click="runScenario">
                    Run Scenario
                </UButton>
            </div>
        </UCard>

        <section class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <UCard>
                <div class="text-sm opacity-80">Local Ops Created</div>
                <div class="text-2xl font-semibold" data-testid="local-ops-created">{{ localOpsCreated }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Queued Ops</div>
                <div class="text-2xl font-semibold" data-testid="queued-ops">{{ queuedOps }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Flushed Ops</div>
                <div class="text-2xl font-semibold" data-testid="flushed-ops">{{ flushedOps }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Notifications Emitted</div>
                <div class="text-2xl font-semibold" data-testid="notification-count">{{ notificationCount }}</div>
            </UCard>
        </section>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between">
                    <span class="font-medium">Result</span>
                    <UBadge :color="scenarioPass ? 'success' : 'error'" variant="soft" data-testid="scenario-pass">
                        {{ scenarioPass ? 'pass' : 'fail' }}
                    </UBadge>
                </div>
            </template>
            <div class="space-y-2 text-sm">
                <div data-testid="phase">Phase: {{ phase }}</div>
                <div data-testid="invariant-queue-empty">
                    Invariant queue empty after reconnect: {{ invariantQueueEmpty ? 'true' : 'false' }}
                </div>
                <div data-testid="invariant-counts-match">
                    Invariant flushed equals local ops: {{ invariantCountsMatch ? 'true' : 'false' }}
                </div>
                <div data-testid="invariant-notify-stable">
                    Invariant notification storm protected: {{ invariantNotifyStable ? 'true' : 'false' }}
                </div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <div class="font-medium">Event Log</div>
            </template>
            <pre class="max-h-72 overflow-auto text-xs whitespace-pre-wrap" data-testid="offline-log">{{ logText }}</pre>
        </UCard>
    </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type PendingOp = {
    id: string;
    createdAt: number;
};

const isOffline = ref(false);
const phase = ref<'idle' | 'offline' | 'reconnecting' | 'complete'>('idle');
const localOpsCreated = ref(0);
const flushedOps = ref(0);
const pendingOps = ref<PendingOp[]>([]);
const notificationCount = ref(0);
const logLines = ref<string[]>([]);

const queuedOps = computed(() => pendingOps.value.length);
const invariantQueueEmpty = computed(() => !isOffline.value && queuedOps.value === 0);
const invariantCountsMatch = computed(() => flushedOps.value === localOpsCreated.value);
const invariantNotifyStable = computed(() => notificationCount.value <= 2);
const scenarioPass = computed(
    () => invariantQueueEmpty.value && invariantCountsMatch.value && invariantNotifyStable.value && phase.value === 'complete'
);
const logText = computed(() => logLines.value.join('\n'));

function appendLog(message: string): void {
    logLines.value.push(`[${new Date().toISOString()}] ${message}`);
}

function resetHarness(): void {
    isOffline.value = false;
    phase.value = 'idle';
    localOpsCreated.value = 0;
    flushedOps.value = 0;
    pendingOps.value = [];
    notificationCount.value = 0;
    logLines.value = [];
    appendLog('Harness reset');
}

function goOffline(): void {
    isOffline.value = true;
    phase.value = 'offline';
    appendLog('Connection switched OFFLINE');
}

function createLocalEdit(): void {
    localOpsCreated.value += 1;
    const op: PendingOp = {
        id: `op-${localOpsCreated.value}`,
        createdAt: Date.now(),
    };

    if (isOffline.value) {
        pendingOps.value.push(op);
        appendLog(`Queued local op ${op.id}`);
        return;
    }

    flushedOps.value += 1;
    appendLog(`Applied online op ${op.id}`);
}

async function goOnlineAndFlush(): Promise<void> {
    isOffline.value = false;
    phase.value = 'reconnecting';
    appendLog('Connection switched ONLINE, flushing queue');

    const queued = [...pendingOps.value];
    for (const op of queued) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        flushedOps.value += 1;
        appendLog(`Flushed queued op ${op.id}`);
    }

    pendingOps.value = [];
    notificationCount.value += 1;
    appendLog('Emitted single sync-complete notification');
    phase.value = 'complete';
}

async function runScenario(): Promise<void> {
    resetHarness();
    goOffline();
    createLocalEdit();
    createLocalEdit();
    createLocalEdit();
    await goOnlineAndFlush();
}
</script>
