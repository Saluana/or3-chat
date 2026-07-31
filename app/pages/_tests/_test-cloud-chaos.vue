<template>
    <main class="mx-auto max-w-5xl p-6 space-y-6" data-testid="chaos-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Cloud Chaos Harness</h1>
            <p class="text-sm opacity-80">
                Deterministic fault-injection simulation for retry, circuit-breaker, and data-integrity checks.
            </p>
        </header>

        <UCard>
            <template #header>
                <div class="font-medium">Config</div>
            </template>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                    <label class="text-sm opacity-80">Failure Rate (%)</label>
                    <UInput v-model.number="failureRatePct" type="number" min="0" max="100" data-testid="failure-rate" />
                </div>
                <div>
                    <label class="text-sm opacity-80">Seed</label>
                    <UInput v-model.number="seed" type="number" min="1" data-testid="chaos-seed" />
                </div>
                <div class="flex items-end">
                    <UButton color="neutral" variant="soft" data-testid="chaos-reset" @click="resetHarness">
                        Reset
                    </UButton>
                </div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <span class="font-medium">Run</span>
                    <div class="flex gap-2">
                        <UButton data-testid="chaos-run-once" color="primary" :loading="running" @click="runSingle">
                            Run One Op
                        </UButton>
                        <UButton data-testid="chaos-run-batch" color="primary" variant="outline" :loading="running" @click="runBatch">
                            Run Batch
                        </UButton>
                    </div>
                </div>
            </template>
            <div class="text-sm space-y-1">
                <div>Circuit breaker: <strong data-testid="circuit-state">{{ circuitOpen ? 'open' : 'closed' }}</strong></div>
                <div>Queue remaining: <strong data-testid="queue-remaining">{{ pendingQueue.length }}</strong></div>
            </div>
        </UCard>

        <section class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <UCard>
                <div class="text-sm opacity-80">Processed</div>
                <div class="text-2xl font-semibold" data-testid="processed-count">{{ processedCount }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Failures</div>
                <div class="text-2xl font-semibold" data-testid="failed-count">{{ failedCount }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Retries</div>
                <div class="text-2xl font-semibold" data-testid="retry-count">{{ retryCount }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Integrity Pass</div>
                <div class="text-2xl font-semibold" data-testid="integrity-pass">{{ integrityPass ? 'true' : 'false' }}</div>
            </UCard>
        </section>

        <UCard>
            <template #header>
                <div class="font-medium">Event Log</div>
            </template>
            <pre class="max-h-72 overflow-auto text-xs whitespace-pre-wrap" data-testid="chaos-log">{{ logText }}</pre>
        </UCard>
    </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type PendingItem = {
    id: string;
    attempts: number;
};

const failureRatePct = ref(40);
const seed = ref(1337);
const running = ref(false);
const circuitOpen = ref(false);
const consecutiveFailures = ref(0);
const retryCount = ref(0);
const failedCount = ref(0);
const processedItems = ref<string[]>([]);
const pendingQueue = ref<PendingItem[]>([]);
const logs = ref<string[]>([]);

const processedCount = computed(() => processedItems.value.length);
const integrityPass = computed(() => new Set(processedItems.value).size === processedItems.value.length);
const logText = computed(() => logs.value.join('\n'));

function appendLog(message: string): void {
    logs.value.push(`[${new Date().toISOString()}] ${message}`);
}

function seededRandom(): number {
    seed.value = (seed.value * 1664525 + 1013904223) % 4294967296;
    return seed.value / 4294967296;
}

function shouldFail(): boolean {
    return seededRandom() * 100 < failureRatePct.value;
}

function refillQueue(): void {
    pendingQueue.value = Array.from({ length: 12 }, (_, i) => ({
        id: `op-${i + 1}`,
        attempts: 0,
    }));
}

function resetHarness(): void {
    circuitOpen.value = false;
    consecutiveFailures.value = 0;
    retryCount.value = 0;
    failedCount.value = 0;
    processedItems.value = [];
    logs.value = [];
    refillQueue();
    appendLog('Harness reset');
}

async function runItem(item: PendingItem): Promise<void> {
    if (circuitOpen.value) {
        appendLog(`Circuit open, skipping ${item.id}`);
        return;
    }

    while (item.attempts < 3) {
        item.attempts += 1;
        const fail = shouldFail();
        if (!fail) {
            processedItems.value.push(item.id);
            consecutiveFailures.value = 0;
            appendLog(`Processed ${item.id} on attempt ${item.attempts}`);
            return;
        }

        failedCount.value += 1;
        consecutiveFailures.value += 1;
        if (item.attempts < 3) {
            retryCount.value += 1;
        }
        appendLog(`Failure on ${item.id} attempt ${item.attempts}`);

        if (consecutiveFailures.value >= 3) {
            circuitOpen.value = true;
            appendLog('Circuit opened after 3 consecutive failures');
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    appendLog(`Exhausted retries for ${item.id}`);
}

async function runSingle(): Promise<void> {
    running.value = true;
    if (pendingQueue.value.length === 0) {
        refillQueue();
    }
    const next = pendingQueue.value.shift();
    if (next) {
        await runItem(next);
    }
    running.value = false;
}

async function runBatch(): Promise<void> {
    running.value = true;
    if (pendingQueue.value.length === 0) {
        refillQueue();
    }

    while (pendingQueue.value.length > 0 && !circuitOpen.value) {
        const next = pendingQueue.value.shift();
        if (!next) break;
        await runItem(next);
    }

    if (circuitOpen.value) {
        appendLog('Batch halted due to open circuit');
    } else {
        appendLog('Batch completed');
    }
    running.value = false;
}

resetHarness();
</script>
