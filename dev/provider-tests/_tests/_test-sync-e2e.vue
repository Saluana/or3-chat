<script setup lang="ts">
/**
 * Sync Layer E2E Harness
 * Visit: http://localhost:3000/_tests/_test-sync-e2e
 *
 * Provides deterministic controls for Playwright tests:
 * - Workspace switching + DB scoping
 * - HookBridge capture (pending_ops)
 * - Tombstone creation on deletes
 * - KV sync blocklist enforcement
 * - Pending message suppression
 */

definePageMeta({ ssr: false });

import { ref } from 'vue';
import { getDb, setActiveWorkspaceDb, getActiveWorkspaceId, getWorkspaceDbCacheStats } from '~/db/client';
import { getHookBridge } from '~/core/sync/hook-bridge';
import { nowSec } from '~/db/util';

const activeWorkspace = ref<string | null>(getActiveWorkspaceId());
const dbName = ref(getDb().name);
const cacheStats = ref({ size: 0, max: 0, keys: [] as string[] });
const stats = ref({
    threads: 0,
    messages: 0,
    pendingOps: 0,
    tombstones: 0,
    kv: 0,
});
const pendingOpsData = ref<any[]>([]); // New: Store actual ops for inspection
const lastThreadId = ref<string | null>(null);
const lastMessageId = ref<string | null>(null);
const lastAction = ref('');

function ensureHookBridge() {
    const bridge = getHookBridge(getDb());
    bridge.start();
}

async function refreshState() {
    const db = getDb();
    activeWorkspace.value = getActiveWorkspaceId();
    dbName.value = db.name;
    cacheStats.value = getWorkspaceDbCacheStats();
    stats.value = {
        threads: await db.threads.count(),
        messages: await db.messages.count(),
        pendingOps: await db.pending_ops.count(),
        tombstones: await db.tombstones.count(),
        kv: await db.kv.count(),
    };
    // New: Fetch actual ops for validation
    pendingOpsData.value = await db.pending_ops.toArray();
}

async function setWorkspace(id: string | null) {
    setActiveWorkspaceDb(id);
    ensureHookBridge();
    await refreshState();
    lastAction.value = id ? `Workspace set to ${id}` : 'Workspace cleared';
}

async function createThread() {
    const db = getDb();
    const id = `e2e-thread-${Date.now()}`;
    const timestamp = nowSec();
    await db.threads.put({
        id,
        title: 'E2E Thread',
        status: 'ready',
        deleted: false,
        pinned: false,
        forked: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    lastThreadId.value = id;
    lastAction.value = `Thread created: ${id}`;
    await refreshState();
}

async function createMessage(pending = false) {
    const db = getDb();
    const threadId = lastThreadId.value ?? `e2e-thread-${Date.now()}`;
    const id = `e2e-message-${Date.now()}`;
    const timestamp = nowSec();
    await db.messages.put({
        id,
        thread_id: threadId,
        index: 1,
        role: 'user',
        data: { text: 'E2E message' },
        pending,
        deleted: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    lastMessageId.value = id;
    lastAction.value = pending ? `Pending message created: ${id}` : `Message created: ${id}`;
    await refreshState();
}

async function createBlockedKv() {
    const db = getDb();
    const timestamp = nowSec();
    await db.kv.put({
        id: 'kv:openrouter_api_key',
        name: 'openrouter_api_key',
        value: 'redacted',
        deleted: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    lastAction.value = 'Blocked KV key written';
    await refreshState();
}

// New: Test that non-blocked keys work
async function createAllowedKv() {
    const db = getDb();
    const timestamp = nowSec();
    await db.kv.put({
        id: 'kv:user_theme',
        name: 'user_theme',
        value: 'dark',
        deleted: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    lastAction.value = 'Allowed KV key written';
    await refreshState();
}

// New: Simulate the background worker flushing ops
async function simulateSync() {
    const db = getDb();
    await db.pending_ops.clear();
    lastAction.value = 'Simulated Sync (Ops Flushed)';
    await refreshState();
}

async function deleteLastThread() {
    const db = getDb();
    if (!lastThreadId.value) {
        lastAction.value = 'No thread to delete';
        return;
    }
    await db.threads.delete(lastThreadId.value);
    lastAction.value = `Thread deleted: ${lastThreadId.value}`;
    await refreshState();
}

async function resetWorkspaceData() {
    const db = getDb();
    // Use array syntax for tables to avoid argument limit issues
    await db.transaction('rw', [db.threads, db.messages, db.pending_ops, db.tombstones, db.kv], async () => {
        await db.threads.clear();
        await db.messages.clear();
        await db.pending_ops.clear();
        await db.tombstones.clear();
        await db.kv.clear();
    });
    lastThreadId.value = null;
    lastMessageId.value = null;
    lastAction.value = 'Workspace data cleared';
    await refreshState();
}

await setWorkspace('workspace-a');
</script>

<template>
    <div class="e2e-sync">
        <h1>Sync Layer E2E Harness</h1>
        <p>Use this page for automated sync-layer validation.</p>

        <section>
            <h2>Workspace Controls</h2>
            <div class="controls">
                <button data-testid="workspace-a" @click="setWorkspace('workspace-a')">Workspace A</button>
                <button data-testid="workspace-b" @click="setWorkspace('workspace-b')">Workspace B</button>
                <button data-testid="workspace-clear" @click="setWorkspace(null)">Clear Workspace</button>
            </div>
            <div class="grid">
                <div>
                    <strong>Active Workspace</strong>
                    <div data-testid="active-workspace">{{ activeWorkspace ?? 'none' }}</div>
                </div>
                <div>
                    <strong>DB Name</strong>
                    <div data-testid="db-name">{{ dbName }}</div>
                </div>
                <div>
                    <strong>Cache Keys</strong>
                    <div data-testid="cache-keys">{{ cacheStats.keys.join(', ') || 'none' }}</div>
                </div>
            </div>
        </section>

        <section>
            <h2>Actions</h2>
            <div class="controls">
                <button data-testid="create-thread" @click="createThread">Create Thread</button>
                <button data-testid="create-message" @click="() => createMessage(false)">Create Message</button>
                <button data-testid="create-pending-message" @click="() => createMessage(true)">
                    Create Pending Message
                </button>
                <button data-testid="create-blocked-kv" @click="createBlockedKv">Write Blocked KV</button>
                <button data-testid="create-allowed-kv" @click="createAllowedKv">Write Allowed KV</button>
                <button data-testid="delete-thread" @click="deleteLastThread">Delete Last Thread</button>
                <button data-testid="simulate-sync" @click="simulateSync">Simulate Sync (Flush)</button>
                <button data-testid="reset-workspace" @click="resetWorkspaceData">Reset Workspace Data</button>
            </div>
        </section>

        <section>
            <h2>Stats</h2>
            <div class="grid">
                <div>
                    <strong>Threads</strong>
                    <div data-testid="threads-count">{{ stats.threads }}</div>
                </div>
                <div>
                    <strong>Messages</strong>
                    <div data-testid="messages-count">{{ stats.messages }}</div>
                </div>
                <div>
                    <strong>Pending Ops</strong>
                    <div data-testid="pending-ops-count">{{ stats.pendingOps }}</div>
                </div>
                <div>
                    <strong>Tombstones</strong>
                    <div data-testid="tombstones-count">{{ stats.tombstones }}</div>
                </div>
                <div>
                    <strong>KV Entries</strong>
                    <div data-testid="kv-count">{{ stats.kv }}</div>
                </div>
            </div>
        </section>

        <section>
            <h2>Pending Ops Payload</h2>
            <pre data-testid="pending-ops-json" style="background: #111; padding: 1rem; overflow: auto; max-height: 200px;">{{ JSON.stringify(pendingOpsData, null, 2) }}</pre>
        </section>

        <section>
            <h2>Last Action</h2>
            <div data-testid="last-action">{{ lastAction }}</div>
        </section>
    </div>
</template>

<style scoped>
.e2e-sync {
    max-width: 960px;
    margin: 2rem auto;
    padding: 1.5rem;
    font-family: system-ui, sans-serif;
}

.controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
}

button {
    background: #1f2937;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0.5rem 0.9rem;
    cursor: pointer;
}

button:hover {
    background: #111827;
}

.grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    margin-bottom: 1rem;
}
</style>
