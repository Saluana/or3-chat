<template>
    <main class="mx-auto max-w-5xl p-6 space-y-6" data-testid="workspace-race-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Cloud Workspace Switch Race Harness</h1>
            <p class="text-sm opacity-80">
                Stresses rapid workspace switching with active notification writes and transfer queue processing.
            </p>
        </header>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div class="font-medium">Controls</div>
                    <UBadge :color="scenarioPass ? 'success' : 'warning'" variant="soft" data-testid="scenario-pass">
                        {{ scenarioPass ? 'pass' : 'pending/fail' }}
                    </UBadge>
                </div>
            </template>

            <div class="flex flex-wrap gap-2">
                <UButton data-testid="reset-switch-race" color="neutral" variant="soft" @click="resetHarness">
                    Reset
                </UButton>
                <UButton data-testid="run-switch-race" color="primary" :loading="running" @click="runScenario(24)">
                    Run Standard Race
                </UButton>
                <UButton data-testid="run-switch-race-stress" color="primary" variant="outline" :loading="running" @click="runScenario(64)">
                    Run Stress Race
                </UButton>
            </div>
        </UCard>

        <section class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <UCard>
                <div class="text-sm opacity-80">Phase</div>
                <div class="text-xl font-semibold" data-testid="phase">{{ phase }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Workspace Switches</div>
                <div class="text-xl font-semibold" data-testid="switch-count">{{ switchCount }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Transfer Completed</div>
                <div class="text-xl font-semibold" data-testid="transfer-completed">{{ transferCompleted ? 'true' : 'false' }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Workspace A Threads</div>
                <div class="text-xl font-semibold" data-testid="ws-a-threads">{{ workspaceAThreads }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Workspace B Threads</div>
                <div class="text-xl font-semibold" data-testid="ws-b-threads">{{ workspaceBThreads }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Unread Notifications</div>
                <div class="text-xl font-semibold" data-testid="unread-count">{{ unreadCount }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Unhandled Errors</div>
                <div class="text-xl font-semibold" data-testid="unhandled-errors">{{ unhandledErrors }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">DB Closed Console Errors</div>
                <div class="text-xl font-semibold" data-testid="db-closed-console-errors">{{ dbClosedConsoleErrors }}</div>
            </UCard>
            <UCard>
                <div class="text-sm opacity-80">Invariant</div>
                <div class="text-xl font-semibold" data-testid="invariant-stable-read">{{ invariantStableRead ? 'true' : 'false' }}</div>
            </UCard>
        </section>

        <UCard>
            <template #header>
                <div class="font-medium">Details</div>
            </template>
            <div class="text-sm" data-testid="details">{{ details }}</div>
        </UCard>

        <UCard>
            <template #header>
                <div class="font-medium">Event Log</div>
            </template>
            <pre class="max-h-72 overflow-auto text-xs whitespace-pre-wrap" data-testid="race-log">{{ logText }}</pre>
        </UCard>
    </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { ObjectStorageProvider } from '~/core/storage/types';
import { FileTransferQueue } from '~/core/storage/transfer-queue';
import { getDb, getWorkspaceDb, setActiveWorkspaceDb } from '~/db/client';
import { nowSec } from '~/db/util';
import { useNotifications } from '~/composables/notifications/useNotifications';

const WORKSPACE_A = 'race-a';
const WORKSPACE_B = 'race-b';

const phase = ref<'idle' | 'seeding' | 'switching' | 'validating' | 'complete' | 'failed'>('idle');
const switchCount = ref(0);
const transferCompleted = ref(false);
const workspaceAThreads = ref(0);
const workspaceBThreads = ref(0);
const unhandledErrors = ref(0);
const dbClosedConsoleErrors = ref(0);
const details = ref('Not started');
const running = ref(false);
const logs = ref<string[]>([]);
const fixtureHash = ref('');

const notifications = useNotifications();
const unreadCount = computed(() => notifications.unreadCount.value);
const logText = computed(() => logs.value.join('\n'));
const invariantStableRead = computed(() => workspaceAThreads.value === 2 && workspaceBThreads.value === 3);
const scenarioPass = computed(() =>
    phase.value === 'complete' &&
    transferCompleted.value &&
    invariantStableRead.value &&
    unhandledErrors.value === 0
);

let queue: FileTransferQueue | null = null;
let originalConsoleError: ((...args: unknown[]) => void) | null = null;

const fixtureBytes = new TextEncoder().encode('or3-workspace-switch-race-fixture');
const fixtureBlob = new Blob([fixtureBytes], { type: 'application/octet-stream' });
const fixtureBase64 = btoa(String.fromCharCode(...fixtureBytes));

function appendLog(message: string): void {
    logs.value.push(`[${new Date().toISOString()}] ${message}`);
}

function isDatabaseClosedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const name = (error as { name?: unknown }).name;
    const message = (error as { message?: unknown }).message;
    return name === 'DatabaseClosedError' || (typeof message === 'string' && message.includes('Database has been closed'));
}

async function computeFixtureHash(): Promise<void> {
    const digest = await crypto.subtle.digest('SHA-256', await fixtureBlob.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    fixtureHash.value = `sha256:${hex}`;
}

function createProvider(): ObjectStorageProvider {
    return {
        id: 'workspace-race-mock',
        displayName: 'Workspace Race Mock',
        supports: {
            presignedUpload: true,
            presignedDownload: true,
        },
        async getPresignedUploadUrl() {
            return {
                url: 'data:application/octet-stream;base64,',
                expiresAt: Date.now() + 60_000,
                method: 'PUT',
                storageId: 'mock-upload',
            };
        },
        async getPresignedDownloadUrl() {
            return {
                url: `data:application/octet-stream;base64,${fixtureBase64}`,
                expiresAt: Date.now() + 60_000,
                method: 'GET',
                storageId: 'mock-download',
            };
        },
        async commitUpload() {
            return;
        },
    };
}

function installErrorTracking(): void {
    window.addEventListener('error', () => {
        unhandledErrors.value += 1;
    });
    window.addEventListener('unhandledrejection', () => {
        unhandledErrors.value += 1;
    });

    originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
        const text = args.map((arg) => String(arg)).join(' ');
        if (text.includes('DatabaseClosedError')) {
            dbClosedConsoleErrors.value += 1;
        }
        originalConsoleError?.(...args);
    };
}

function uninstallErrorTracking(): void {
    if (originalConsoleError) {
        console.error = originalConsoleError;
    }
}

async function withWorkspace<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    setActiveWorkspaceDb(workspaceId);
    return await fn();
}

async function clearWorkspace(workspaceId: string): Promise<void> {
    await withWorkspace(workspaceId, async () => {
        const db = getDb();
        await db.transaction('rw', [db.threads, db.messages, db.pending_ops, db.tombstones, db.kv, db.notifications, db.file_meta, db.file_blobs, db.file_transfers], async () => {
            await db.threads.clear();
            await db.messages.clear();
            await db.pending_ops.clear();
            await db.tombstones.clear();
            await db.kv.clear();
            await db.notifications.clear();
            await db.file_meta.clear();
            await db.file_blobs.clear();
            await db.file_transfers.clear();
        });
    });
}

async function seedWorkspace(workspaceId: string, threadCount: number): Promise<void> {
    await withWorkspace(workspaceId, async () => {
        const db = getDb();
        const now = nowSec();

        for (let i = 0; i < threadCount; i += 1) {
            await db.threads.put({
                id: `${workspaceId}-thread-${i}`,
                title: `${workspaceId} thread ${i}`,
                status: 'ready',
                deleted: false,
                pinned: false,
                forked: false,
                created_at: now,
                updated_at: now,
                clock: now + i,
            });
        }

        await db.file_meta.put({
            hash: fixtureHash.value,
            name: `fixture-${workspaceId}.bin`,
            mime_type: 'application/octet-stream',
            kind: 'image',
            size_bytes: fixtureBlob.size,
            ref_count: 1,
            storage_provider_id: 'workspace-race-mock',
            storage_id: `storage-${workspaceId}`,
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: now,
        });
    });
}

async function waitForTransferDone(workspaceId: string, timeoutMs = 3000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const done = await withWorkspace(workspaceId, async () => {
            const db = getDb();
            const transfer = await db.file_transfers.where('hash').equals(fixtureHash.value).first();
            return transfer?.state === 'done';
        });

        if (done) return true;
        await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return false;
}

async function resetHarness(): Promise<void> {
    phase.value = 'idle';
    switchCount.value = 0;
    transferCompleted.value = false;
    workspaceAThreads.value = 0;
    workspaceBThreads.value = 0;
    unhandledErrors.value = 0;
    dbClosedConsoleErrors.value = 0;
    details.value = 'Reset complete';
    logs.value = [];

    queue?.cancelAllRunning();
    queue = null;

    await clearWorkspace(WORKSPACE_A);
    await clearWorkspace(WORKSPACE_B);
    setActiveWorkspaceDb(WORKSPACE_A);
    appendLog('Harness reset');
}

async function runScenario(iterations: number): Promise<void> {
    if (running.value) return;

    running.value = true;
    try {
        await resetHarness();

        if (!fixtureHash.value) {
            await computeFixtureHash();
        }

        phase.value = 'seeding';
        appendLog('Seeding workspaces');

        await seedWorkspace(WORKSPACE_A, 2);
        await seedWorkspace(WORKSPACE_B, 3);

        queue = new FileTransferQueue(getWorkspaceDb(WORKSPACE_A), createProvider(), {
            dbResolver: getDb,
            concurrency: 1,
            maxAttempts: 2,
        });

        setActiveWorkspaceDb(WORKSPACE_A);
        queue.setWorkspaceId(WORKSPACE_A);
        await queue.enqueue(fixtureHash.value, 'download');

        phase.value = 'switching';
        appendLog(`Switching workspaces ${iterations} times`);

        for (let i = 0; i < iterations; i += 1) {
            const target = i % 2 === 0 ? WORKSPACE_B : WORKSPACE_A;
            setActiveWorkspaceDb(target);
            queue.setWorkspaceId(target);
            switchCount.value += 1;

            await notifications.push({
                type: 'workspace-switch',
                title: `switch-${i}`,
                body: `Moved to ${target}`,
            });

            await new Promise((resolve) => setTimeout(resolve, 4));
        }

        phase.value = 'validating';

        setActiveWorkspaceDb(WORKSPACE_B);
        queue.setWorkspaceId(WORKSPACE_B);

        workspaceAThreads.value = await withWorkspace(WORKSPACE_A, async () => getDb().threads.count());
        workspaceBThreads.value = await withWorkspace(WORKSPACE_B, async () => getDb().threads.count());
        transferCompleted.value = await waitForTransferDone(WORKSPACE_A) || await waitForTransferDone(WORKSPACE_B);

        const stable = invariantStableRead.value;
        if (!stable) {
            details.value = 'Thread counts mismatch after workspace switch race';
            phase.value = 'failed';
            appendLog(details.value);
            return;
        }

        details.value = transferCompleted.value
            ? 'Transfer queue recovered and data remained workspace-isolated'
            : 'Data remained isolated but transfer completion was not observed in time';

        phase.value = transferCompleted.value ? 'complete' : 'failed';
        appendLog(details.value);
    } catch (error) {
        if (isDatabaseClosedError(error)) {
            dbClosedConsoleErrors.value += 1;
        }
        phase.value = 'failed';
        details.value = error instanceof Error ? error.message : String(error);
        appendLog(`Scenario failed: ${details.value}`);
    } finally {
        running.value = false;
    }
}

installErrorTracking();
void resetHarness();

onBeforeUnmount(() => {
    queue?.cancelAllRunning();
    uninstallErrorTracking();
});
</script>
