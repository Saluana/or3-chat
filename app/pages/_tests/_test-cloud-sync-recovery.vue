<template>
    <main class="mx-auto max-w-5xl p-6 space-y-6" data-testid="sync-recovery-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Cloud Sync Recovery Harness</h1>
            <p class="text-sm opacity-80">
                Runs the real write capture, snapshot installer and outbox against this browser's IndexedDB with an
                in-page provider. A test injects faults into the raw stores between steps.
            </p>
        </header>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div class="font-medium">Steps</div>
                    <UBadge color="neutral" variant="soft" data-testid="phase">{{ phase }}</UBadge>
                </div>
            </template>
            <div class="flex flex-wrap gap-2">
                <UButton data-testid="seed" color="neutral" variant="soft" @click="run(seed)">Seed records</UButton>
                <UButton data-testid="recover-snapshot" color="primary" @click="run(recoverFromEmptySnapshot)">
                    Recover from empty snapshot
                </UButton>
                <UButton data-testid="reconnect-flush" color="success" @click="run(reconnectAndFlush)">
                    Reconnect + flush
                </UButton>
                <UButton data-testid="retry-failed-flush" color="warning" variant="soft" @click="run(retryFailedAndFlush)">
                    Retry failed + flush
                </UButton>
                <UButton data-testid="quarantine-corrupt" color="primary" variant="outline" @click="run(quarantineCorrupt)">
                    Quarantine corrupt ops
                </UButton>
                <UButton data-testid="export-quarantine" color="neutral" variant="outline" @click="run(exportQuarantine)">
                    Export quarantine
                </UButton>
                <UButton data-testid="discard-first" color="error" variant="soft" @click="run(discardFirstUnresolved)">
                    Discard first unresolved
                </UButton>
            </div>
            <p v-if="error" class="mt-3 text-sm text-red-600" data-testid="error">{{ error }}</p>
        </UCard>

        <UCard>
            <template #header><div class="font-medium">Last result</div></template>
            <pre class="text-xs whitespace-pre-wrap" data-testid="result">{{ result }}</pre>
        </UCard>

        <UCard>
            <template #header><div class="font-medium">Pushed to the provider</div></template>
            <pre class="text-xs whitespace-pre-wrap" data-testid="pushed">{{ pushedText }}</pre>
        </UCard>

        <UCard>
            <template #header><div class="font-medium">Quarantine export</div></template>
            <pre class="max-h-72 overflow-auto text-xs whitespace-pre-wrap" data-testid="quarantine-export">{{ exported }}</pre>
        </UCard>
    </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Or3DB } from '~/db/client';
import { getWriteTxTableNames } from '~/db/util';
import { _resetHookBridge, getHookBridge } from '~/core/sync/hook-bridge';
import { OutboxManager } from '~/core/sync/outbox-manager';
import { SnapshotStager } from '~/core/sync/snapshot-applier';
import { FULL_HISTORY_PULL_RETENTION } from '~~/shared/sync/types';
import type { PushBatch, PushResult, SyncProvider } from '~~/shared/sync/types';

/** The test reads and corrupts this database directly, so the name is fixed. */
const DB_NAME = 'or3-sync-recovery-harness';
const scope = { workspaceId: 'sync-recovery-harness' };

const phase = ref('idle');
const error = ref('');
const result = ref('');
const exported = ref('');
const pushed = ref<Array<{ table: string; pk: string; opId: string; operation: string; payload: unknown }>>([]);
const pushedText = computed(() => JSON.stringify(pushed.value));

let db: Or3DB | null = null;
let outbox: OutboxManager | null = null;

/** Records pushes and accepts everything, standing in for the server. */
function createProvider(): SyncProvider {
    let serverVersion = 0;
    return {
        id: 'sync-recovery-harness',
        mode: 'direct',
        auth: undefined,
        subscribe: async () => () => undefined,
        pull: async () => ({ changes: [], nextCursor: 0, hasMore: false, ...FULL_HISTORY_PULL_RETENTION }),
        push: async (batch: PushBatch): Promise<PushResult> => {
            for (const op of batch.ops) {
                pushed.value.push({
                    table: op.tableName, pk: op.pk, opId: op.stamp.opId, operation: op.operation, payload: op.payload,
                });
            }
            serverVersion += batch.ops.length;
            return { results: batch.ops.map((op) => ({ opId: op.stamp.opId, success: true })), serverVersion };
        },
        updateCursor: async () => undefined,
        dispose: async () => undefined,
    };
}

async function run(step: () => Promise<unknown>): Promise<void> {
    error.value = '';
    try {
        const value = await step();
        if (value !== undefined) result.value = JSON.stringify(value);
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = 'failed';
    }
}

function requireDb(): Or3DB {
    if (!db) throw new Error('Seed the records first');
    return db;
}

function message(id: string, content: string, index: number) {
    const now = Math.floor(Date.now() / 1000);
    return {
        id, thread_id: 'harness-thread', role: 'user' as const, index, order_key: '', data: { content },
        deleted: false, created_at: now, updated_at: now, clock: 0,
    };
}

function document(id: string, title: string) {
    const now = Math.floor(Date.now() / 1000);
    return {
        id, title, content: '{"type":"doc"}', postType: 'doc', deleted: false, created_at: now, updated_at: now, clock: 0,
    };
}

/** Writes through the real capture hooks, as the app does, so each record gets a real queued operation. */
async function seed(): Promise<{ queued: number }> {
    phase.value = 'seeding';
    outbox?.stop();
    outbox = null;
    _resetHookBridge();
    db?.close();
    await new Or3DB(DB_NAME).delete();
    pushed.value = [];
    exported.value = '';
    db = new Or3DB(DB_NAME);
    await db.open();
    getHookBridge(db).start();
    const rows = [
        message('m-corrupt', 'corrupt op, local row intact', 0),
        message('m-failed', 'permanently failed op', 1),
        message('m-orphan', 'corrupt op, row lost', 2),
        message('m-intact', 'ordinary pending op', 3),
    ];
    const documents = [document('d-corrupt', 'Corrupt op document'), document('d-failed', 'Failed op document')];
    for (const row of rows) {
        await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () => db!.messages.put(row));
    }
    for (const row of documents) {
        await db.transaction('rw', getWriteTxTableNames(db, 'posts'), () => db!.posts.put(row));
    }
    phase.value = 'seeded';
    return { queued: await db.pending_ops.count() };
}

/** The server holds nothing for these tables, so replacing them would erase unsynced local work. */
async function recoverFromEmptySnapshot(): Promise<{ cursor: number | undefined }> {
    const target = requireDb();
    phase.value = 'recovering';
    const stager = new SnapshotStager(target, scope, ['messages', 'posts']);
    await stager.start();
    try {
        await stager.appendPage({
            workspaceId: scope.workspaceId, snapshotId: 'harness-empty', highWatermark: 42, items: [], nextPageToken: null,
        });
        await stager.apply('harness-device', () => true, ['messages', 'posts']);
    } finally {
        await stager.dispose();
    }
    phase.value = 'recovered';
    return { cursor: (await target.sync_state.get(`sync_state:${scope.workspaceId}:default`))?.cursor };
}

function ensureOutbox(): OutboxManager {
    outbox ??= new OutboxManager(requireDb(), createProvider(), scope);
    return outbox;
}

async function flushAll(): Promise<number> {
    const manager = ensureOutbox();
    let rounds = 0;
    while (rounds < 20 && await manager.flush()) rounds += 1;
    return rounds;
}

async function reconnectAndFlush(): Promise<{ rounds: number }> {
    phase.value = 'flushing';
    const rounds = await flushAll();
    phase.value = 'flushed';
    return { rounds };
}

async function retryFailedAndFlush(): Promise<{ rounds: number }> {
    phase.value = 'retrying';
    await ensureOutbox().retryFailed();
    return reconnectAndFlush();
}

async function quarantineCorrupt() {
    phase.value = 'quarantining';
    const summary = await ensureOutbox().quarantineCorruptOps();
    phase.value = 'quarantined';
    return summary;
}

async function exportQuarantine(): Promise<undefined> {
    exported.value = await ensureOutbox().exportQuarantined();
    return undefined;
}

async function discardFirstUnresolved(): Promise<{ discarded: string | null }> {
    const manager = ensureOutbox();
    const first = (await manager.getQuarantined()).find((entry) => entry.status === 'quarantined');
    if (!first) return { discarded: null };
    await manager.discardQuarantined(first.id);
    return { discarded: first.id };
}
</script>
