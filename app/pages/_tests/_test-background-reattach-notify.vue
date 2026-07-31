<template>
    <main class="mx-auto max-w-5xl p-6 space-y-6" data-testid="background-reattach-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Background Reattach + Notification Harness</h1>
            <p class="text-sm opacity-80">
                Deterministic simulation for detached completion notifications and in-progress reattachment behavior.
            </p>
        </header>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-2">
                    <span class="font-medium">Scenario Controls</span>
                    <div class="flex gap-2">
                        <UButton data-testid="bg-rn-reset" color="neutral" variant="soft" @click="resetHarness">
                            Reset
                        </UButton>
                        <UButton
                            data-testid="bg-rn-run-reattach"
                            color="primary"
                            variant="outline"
                            :loading="running"
                            @click="runReattachScenario"
                        >
                            Run Reattach
                        </UButton>
                        <UButton
                            data-testid="bg-rn-run-notify"
                            color="primary"
                            :loading="running"
                            @click="runNotificationScenario"
                        >
                            Run Notify
                        </UButton>
                    </div>
                </div>
            </template>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                    <div class="text-xs opacity-70">Job Status</div>
                    <div class="text-lg font-semibold" data-testid="bg-rn-job-status">{{ jobStatus }}</div>
                </div>
                <div>
                    <div class="text-xs opacity-70">Subscribers</div>
                    <div class="text-lg font-semibold" data-testid="bg-rn-subscriber-count">{{ subscribers }}</div>
                </div>
                <div>
                    <div class="text-xs opacity-70">Notifications</div>
                    <div class="text-lg font-semibold" data-testid="bg-rn-notification-count">{{ notificationCount }}</div>
                </div>
            </div>
        </UCard>

        <section class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <UCard>
                <div class="text-sm opacity-80">Reattach Observed</div>
                <div class="text-2xl font-semibold" data-testid="bg-rn-reattach-observed">
                    {{ reattachObserved ? 'true' : 'false' }}
                </div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Delta Updates Received</div>
                <div class="text-2xl font-semibold" data-testid="bg-rn-delta-count">
                    {{ deltaCount }}
                </div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Content Length</div>
                <div class="text-2xl font-semibold" data-testid="bg-rn-content-length">
                    {{ content.length }}
                </div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Scenario Pass</div>
                <div class="text-2xl font-semibold" data-testid="bg-rn-scenario-pass">
                    {{ scenarioPass ? 'true' : 'false' }}
                </div>
            </UCard>
        </section>

        <UCard>
            <template #header>
                <div class="font-medium">Scenario Result</div>
            </template>
            <div class="space-y-1 text-sm">
                <div data-testid="bg-rn-result-label">Current scenario: {{ scenarioLabel }}</div>
                <div data-testid="bg-rn-result-detail">{{ scenarioDetail }}</div>
                <div data-testid="bg-rn-content-preview">Content: {{ content || '<empty>' }}</div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <div class="font-medium">Event Log</div>
            </template>
            <pre class="max-h-72 overflow-auto text-xs whitespace-pre-wrap" data-testid="bg-rn-log">{{ logText }}</pre>
        </UCard>
    </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type JobStatus = 'idle' | 'streaming' | 'complete';
type Scenario = 'none' | 'reattach' | 'notification';

const jobStatus = ref<JobStatus>('idle');
const subscribers = ref(0);
const notificationCount = ref(0);
const deltaCount = ref(0);
const reattachObserved = ref(false);
const content = ref('');
const running = ref(false);
const scenario = ref<Scenario>('none');
const scenarioPass = ref(false);
const scenarioDetail = ref('No scenario has run yet.');
const logLines = ref<string[]>([]);

const scenarioLabel = computed(() => scenario.value);
const logText = computed(() => logLines.value.join('\n'));

function appendLog(message: string): void {
    logLines.value.push(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetHarness(): void {
    jobStatus.value = 'idle';
    subscribers.value = 0;
    notificationCount.value = 0;
    deltaCount.value = 0;
    reattachObserved.value = false;
    content.value = '';
    running.value = false;
    scenario.value = 'none';
    scenarioPass.value = false;
    scenarioDetail.value = 'No scenario has run yet.';
    logLines.value = [];
    appendLog('Harness reset');
}

function startJob(): void {
    jobStatus.value = 'streaming';
    subscribers.value = 1;
    appendLog('Job started with one active subscriber');
}

function detachSubscriber(): void {
    subscribers.value = 0;
    appendLog('Subscriber detached');
}

function attachSubscriber(): void {
    const wasDetached = subscribers.value === 0;
    subscribers.value = 1;
    if (jobStatus.value === 'streaming' && wasDetached) {
        reattachObserved.value = true;
    }
    appendLog('Subscriber attached');
}

function emitDelta(delta: string): void {
    if (jobStatus.value !== 'streaming') return;
    content.value += delta;
    deltaCount.value += 1;
    appendLog(`Delta received: "${delta}"`);
}

function completeJob(): void {
    if (jobStatus.value !== 'streaming') return;
    jobStatus.value = 'complete';
    appendLog('Job completed');
    if (subscribers.value === 0) {
        notificationCount.value += 1;
        appendLog('Completion notification emitted');
    } else {
        appendLog('Completion notification suppressed because subscriber is attached');
    }
}

async function runReattachScenario(): Promise<void> {
    running.value = true;
    scenario.value = 'reattach';
    resetHarness();
    scenario.value = 'reattach';

    startJob();
    await sleep(10);
    detachSubscriber();
    emitDelta('hello ');
    await sleep(10);
    attachSubscriber();
    emitDelta('world');
    await sleep(10);
    completeJob();

    scenarioPass.value =
        reattachObserved.value &&
        notificationCount.value === 0 &&
        content.value === 'hello world' &&
        deltaCount.value >= 2;
    scenarioDetail.value = scenarioPass.value
        ? 'Reattach recovered streaming state and suppressed detached notification once viewer returned.'
        : 'Reattach scenario failed expected invariants.';
    running.value = false;
}

async function runNotificationScenario(): Promise<void> {
    running.value = true;
    scenario.value = 'notification';
    resetHarness();
    scenario.value = 'notification';

    startJob();
    await sleep(10);
    detachSubscriber();
    emitDelta('done');
    await sleep(10);
    completeJob();

    scenarioPass.value =
        notificationCount.value === 1 &&
        reattachObserved.value === false &&
        content.value === 'done';
    scenarioDetail.value = scenarioPass.value
        ? 'Detached completion emitted exactly one notification.'
        : 'Notification scenario failed expected invariants.';
    running.value = false;
}

resetHarness();
</script>
