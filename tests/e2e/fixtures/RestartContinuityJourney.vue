<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute } from '#imports';
import { Or3DB } from '~/db/client';
import { FileTransferQueue } from '~/core/storage/transfer-queue';
import { createGatewayStorageProvider } from '~/core/storage/providers/gateway-storage-provider';
import { createGatewaySyncProvider } from '~/core/sync/providers/gateway-sync-provider';
import { OutboxManager } from '~/core/sync/outbox-manager';
import type { PendingOp } from '~~/shared/sync/types';

// Browser fixture only: real queues and gateway transports, private disposable
// IndexedDBs, and no mocked provider success or production lifecycle shortcuts.
const query = useRoute().query;
const workspace = String(query.workspace), other = String(query.other), proof = String(query.proof);
const db = new Or3DB(`or3-restart-continuity-${workspace}`);
const otherDb = new Or3DB(`or3-restart-continuity-${other}`);
const queue = new FileTransferQueue(db, createGatewayStorageProvider({ id: 'fs' }), {
    concurrency: 1, maxAttempts: 2, backoffBaseMs: 1000,
    dbResolver: () => queue.getWorkspaceId() === other ? otherDb : db,
    workspaceDbResolver: id => id === other ? otherDb : db,
});
const outbox = new OutboxManager(db, createGatewaySyncProvider(), { workspaceId: workspace });
const ready = ref(false), error = ref(''), state = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
async function refresh() {
    state.value = JSON.stringify({ transfers: await db.file_transfers.toArray(), ops: await db.pending_ops.toArray(),
        files: await db.file_meta.toArray(), otherTransfers: await otherDb.file_transfers.count(), otherOps: await otherDb.pending_ops.count() });
}
async function run(action: () => Promise<void>) { try { error.value = ''; await action(); await refresh(); } catch (e) { error.value = String(e); } }
async function seed() {
    const blob = new Blob([proof], { type: 'text/plain' });
    const hash = 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    const now = Math.floor(Date.now() / 1000);
    const meta = { hash, name: 'restart-proof.txt', mime_type: 'text/plain', kind: 'file' as const, size_bytes: blob.size,
        ref_count: 1, created_at: now, updated_at: now, clock: 1, deleted: false };
    await db.file_blobs.put({ hash, blob }); await db.file_meta.put(meta);
    const id = crypto.randomUUID(), stamp = { deviceId: 'restart-browser-fixture', opId: crypto.randomUUID(), clock: 1, hlc: `${Date.now()}:0:restart-fixture` };
    const row = { id, name: proof, clock: 1, created_at: now, updated_at: now, deleted: false };
    await db.projects.put(row);
    await db.pending_ops.put({ id: stamp.opId, tableName: 'projects', operation: 'put', pk: id, payload: row, stamp,
        createdAt: Date.now(), attempts: 0, status: 'pending' } satisfies PendingOp);
    queue.setWorkspaceId(workspace); await queue.enqueue(hash, 'upload'); outbox.start();
}
async function park() { outbox.stop(); queue.setWorkspaceId(other); }
async function resume() { queue.setWorkspaceId(workspace); outbox.start(); }
async function publish() {
    const meta = (await db.file_meta.toArray())[0];
    if (!meta?.storage_id) throw new Error('Upload must finish before metadata publication');
    const stamp = { deviceId: 'restart-browser-fixture', opId: crypto.randomUUID(), clock: 2, hlc: `${Date.now()}:0:restart-fixture` };
    await db.pending_ops.put({ id: stamp.opId, tableName: 'file_meta', operation: 'put', pk: meta.hash, payload: { ...meta, clock: 2 }, stamp,
        createdAt: Date.now(), attempts: 0, status: 'pending' });
    await outbox.flush();
}
onMounted(async () => { await db.open(); await otherDb.open();
    // Vite can reload again after the initial dev-worker reconnect. Bootstrap
    // from the real session on every mount, as the application does, so an
    // already resumed queue continues without another manual fixture click.
    const session = await $fetch<{ session: { workspace: { id: string } } }>('/api/auth/session');
    const active = session.session.workspace.id;
    if (active !== workspace && active !== other) throw new Error('Unexpected fixture workspace');
    queue.setWorkspaceId(active); if (active === workspace) outbox.start();
    await refresh(); ready.value = true;
    timer = setInterval(() => { void refresh().catch(e => { error.value = String(e); }); }, 200); });
onBeforeUnmount(() => { clearInterval(timer); queue.dispose(); outbox.stop(); db.close(); otherDb.close(); });
</script>
<template>
    <main>
        <output data-testid="continuity-ready">{{ ready }}</output>
        <button :disabled="!ready" @click="run(seed)">Queue local work</button>
        <button :disabled="!ready" @click="run(park)">Switch away</button>
        <button :disabled="!ready" @click="run(resume)">Resume original workspace</button>
        <button :disabled="!ready" @click="run(publish)">Publish file metadata</button>
        <output data-testid="continuity-error">{{ error }}</output>
        <output v-if="ready" data-testid="continuity-state">{{ state }}</output>
    </main>
</template>
