<script setup lang="ts">
/**
 * Interactive Sync Layer Test Page
 * Visit: http://localhost:3000/_tests/_test-sync
 *
 * Tests local database operations:
 * - Create threads and messages
 * - Verify they save to IndexedDB
 * - Monitor pending operations
 */

// Disable SSR to avoid hydration mismatches with client-only features
definePageMeta({ ssr: false });

import { useConvexQuery, useConvexMutation } from 'convex-vue';
import { api } from '~~/convex/_generated/api';
import { db } from '~/db/client';
import type { Id } from '~~/convex/_generated/dataModel';

// ----- Auth Status -----
const { data: identity } = useConvexQuery(api.users.me, {});

// ----- Workspaces -----
const { data: workspaces, isPending: workspacesLoading } = useConvexQuery(api.workspaces.listMyWorkspaces, {});
const createWorkspaceMutation = useConvexMutation(api.workspaces.create);
const selectedWorkspaceId = ref<Id<'workspaces'> | null>(null);
const creatingWorkspace = ref(false);
const workspaceError = ref<string | null>(null);

// Auto-select first workspace
watch(workspaces, (ws) => {
    const firstWorkspace = ws?.[0];
    if (firstWorkspace && !selectedWorkspaceId.value) {
        selectedWorkspaceId.value = firstWorkspace._id;
    }
});

async function createTestWorkspace() {
    creatingWorkspace.value = true;
    workspaceError.value = null;
    try {
        const id = await createWorkspaceMutation.mutate({ name: `Test Workspace ${Date.now()}` });
        selectedWorkspaceId.value = id;
    } catch (e) {
        workspaceError.value = e instanceof Error ? e.message : String(e);
    } finally {
        creatingWorkspace.value = false;
    }
}

// ----- Database Stats -----
const stats = ref({
    threads: 0,
    messages: 0,
    pendingOps: 0,
});

async function loadStats() {
    try {
        stats.value = {
            threads: await db.threads.count(),
            messages: await db.messages.count(),
            pendingOps: await db.pending_ops.where('status').equals('pending').count(),
        };
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

// ----- Recent Threads -----
const recentThreads = ref<{ id: string; title: string | null; createdAt: string }[]>([]);
const threadsLoading = ref(false);

async function loadRecentThreads() {
    threadsLoading.value = true;
    try {
        const threads = await db.threads.orderBy('created_at').reverse().limit(5).toArray();
        recentThreads.value = threads.map((t) => ({
            id: t.id,
            title: t.title ?? '(Untitled)',
            createdAt: new Date((t.created_at ?? 0) * 1000).toLocaleString(),
        }));
    } catch (e) {
        console.error('Failed to load threads:', e);
    } finally {
        threadsLoading.value = false;
    }
}

// ----- Recent Messages -----
const recentMessages = ref<{ id: string; threadId: string; role: string; preview: string }[]>([]);
const messagesLoading = ref(false);

async function loadRecentMessages() {
    messagesLoading.value = true;
    try {
        const messages = await db.messages.orderBy('created_at').reverse().limit(5).toArray();
        recentMessages.value = messages.map((m) => ({
            id: m.id,
            threadId: m.thread_id ?? '',
            role: m.role ?? 'user',
            preview: getMessagePreview(m.data),
        }));
    } catch (e) {
        console.error('Failed to load messages:', e);
    } finally {
        messagesLoading.value = false;
    }
}

function getMessagePreview(data: unknown): string {
    if (!data) return '(empty)';
    if (typeof data === 'string') return data.slice(0, 50);
    if (typeof data === 'object' && data !== null) {
        const obj = data as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text.slice(0, 50);
        if (typeof obj.content === 'string') return obj.content.slice(0, 50);
    }
    return JSON.stringify(data).slice(0, 50);
}

// ----- Create Test Thread -----
const createResult = ref<{ type: 'success' | 'error'; message: string } | null>(null);
const creating = ref(false);
const pushMutation = useConvexMutation(api.sync.push);

async function createTestThread() {
    if (!selectedWorkspaceId.value) {
        createResult.value = { type: 'error', message: '❌ Select a workspace first!' };
        return;
    }

    creating.value = true;
    createResult.value = null;
    try {
        const threadId = `test-${Date.now()}`;
        const nowSec = Math.floor(Date.now() / 1000);
        const deviceId = 'test-device-' + Math.random().toString(36).slice(2, 8);
        const hlc = `${nowSec}:0:${deviceId}`;

        const threadData = {
            id: threadId,
            title: `Test Chat ${new Date().toLocaleTimeString()}`,
            status: 'ready',
            deleted: false,
            pinned: false,
            forked: false,
            created_at: nowSec,
            updated_at: nowSec,
            clock: 1,
        };

        // Save locally first
        await db.threads.add(threadData);

        // Sync to Convex
        await pushMutation.mutate({
            workspace_id: selectedWorkspaceId.value,
            ops: [
                {
                    op_id: crypto.randomUUID(),
                    table_name: 'threads',
                    operation: 'put' as const,
                    pk: threadId,
                    payload: threadData,
                    clock: 1,
                    hlc,
                    device_id: deviceId,
                },
            ],
        });

        createResult.value = { type: 'success', message: `✅ Created & synced thread: ${threadId}` };
        await loadStats();
        await loadRecentThreads();
    } catch (e) {
        createResult.value = { type: 'error', message: `❌ ${e instanceof Error ? e.message : String(e)}` };
    } finally {
        creating.value = false;
    }
}

async function createTestMessage() {
    if (!selectedWorkspaceId.value) {
        createResult.value = { type: 'error', message: '❌ Select a workspace first!' };
        return;
    }

    creating.value = true;
    createResult.value = null;
    try {
        const messageId = `msg-${Date.now()}`;
        const nowSec = Math.floor(Date.now() / 1000);
        const deviceId = 'test-device-' + Math.random().toString(36).slice(2, 8);
        const hlc = `${nowSec}:0:${deviceId}`;

        // Get first thread to attach message to
        const thread = await db.threads.orderBy('created_at').reverse().first();
        const threadId = thread?.id ?? `orphan-thread-${Date.now()}`;

        const messageData = {
            id: messageId,
            thread_id: threadId,
            index: 1,
            role: 'user',
            data: { text: `Test message at ${new Date().toISOString()}` },
            order_key: hlc,
            deleted: false,
            created_at: nowSec,
            updated_at: nowSec,
            clock: 1,
        };

        // Save locally first
        await db.messages.add(messageData);

        // Sync to Convex
        await pushMutation.mutate({
            workspace_id: selectedWorkspaceId.value,
            ops: [
                {
                    op_id: crypto.randomUUID(),
                    table_name: 'messages',
                    operation: 'put' as const,
                    pk: messageId,
                    payload: messageData,
                    clock: 1,
                    hlc,
                    device_id: deviceId,
                },
            ],
        });

        createResult.value = { type: 'success', message: `✅ Created & synced message: ${messageId}` };
        await loadStats();
        await loadRecentMessages();
    } catch (e) {
        createResult.value = { type: 'error', message: `❌ ${e instanceof Error ? e.message : String(e)}` };
    } finally {
        creating.value = false;
    }
}

// ----- Sync All Local Data -----
const syncing = ref(false);
const syncResult = ref<{ synced: number; errors: number; skipped: number } | null>(null);
const syncErrors = ref<string[]>([]);

async function syncAllLocalData() {
    if (!selectedWorkspaceId.value) {
        createResult.value = { type: 'error', message: '❌ Select a workspace first!' };
        return;
    }

    syncing.value = true;
    syncResult.value = null;
    syncErrors.value = [];
    let synced = 0;
    let errors = 0;
    let skipped = 0;

    try {
        const deviceId = 'sync-all-' + Math.random().toString(36).slice(2, 8);
        const nowSec = Math.floor(Date.now() / 1000);

        // Sync all local threads
        const threads = await db.threads.toArray();
        console.log(`[sync] Starting sync of ${threads.length} threads`);
        
        for (const thread of threads) {
            try {
                const hlc = `${thread.created_at || nowSec}:0:${deviceId}`;
                const result = await pushMutation.mutate({
                    workspace_id: selectedWorkspaceId.value,
                    ops: [
                        {
                            op_id: crypto.randomUUID(),
                            table_name: 'threads',
                            operation: 'put' as const,
                            pk: thread.id,
                            payload: thread,
                            clock: thread.clock || 1,
                            hlc,
                            device_id: deviceId,
                        },
                    ],
                });
                // Check if actually synced or skipped
                if (result && Array.isArray(result) && result[0]?.success) {
                    synced++;
                } else {
                    skipped++;
                }
            } catch (e) {
                errors++;
                const errMsg = `Thread ${thread.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`;
                syncErrors.value.push(errMsg);
                console.error('[sync] Error syncing thread:', errMsg);
            }
        }

        // Sync all local messages
        const messages = await db.messages.toArray();
        console.log(`[sync] Starting sync of ${messages.length} messages`);
        
        for (const message of messages) {
            try {
                const hlc = `${message.created_at || nowSec}:0:${deviceId}`;
                const result = await pushMutation.mutate({
                    workspace_id: selectedWorkspaceId.value,
                    ops: [
                        {
                            op_id: crypto.randomUUID(),
                            table_name: 'messages',
                            operation: 'put' as const,
                            pk: message.id,
                            payload: { ...message, order_key: message.order_key || hlc },
                            clock: message.clock || 1,
                            hlc,
                            device_id: deviceId,
                        },
                    ],
                });
                if (result && Array.isArray(result) && result[0]?.success) {
                    synced++;
                } else {
                    skipped++;
                }
            } catch (e) {
                errors++;
                const errMsg = `Message ${message.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`;
                syncErrors.value.push(errMsg);
                console.error('[sync] Error syncing message:', errMsg);
            }
        }

        syncResult.value = { synced, errors, skipped };
        const total = threads.length + messages.length;
        createResult.value = {
            type: errors === 0 ? 'success' : 'error',
            message: `✅ Synced ${synced}/${total} records${errors > 0 ? ` (${errors} errors)` : ''}${skipped > 0 ? ` (${skipped} skipped)` : ''}`,
        };
        console.log(`[sync] Complete: ${synced} synced, ${errors} errors, ${skipped} skipped`);
    } catch (e) {
        createResult.value = { type: 'error', message: `❌ ${e instanceof Error ? e.message : String(e)}` };
    } finally {
        syncing.value = false;
    }
}

// ----- Pending Operations -----
const pendingOps = ref<{ id: string; tableName: string; pk: string; status: string }[]>([]);

async function loadPendingOps() {
    try {
        const ops = await db.pending_ops.where('status').equals('pending').limit(10).toArray();
        pendingOps.value = ops.map((op) => ({
            id: op.id,
            tableName: op.tableName,
            pk: op.pk,
            status: op.status,
        }));
    } catch (e) {
        console.error('Failed to load pending ops:', e);
    }
}

// ----- Cleanup -----
async function clearTestData() {
    creating.value = true;
    try {
        // Only clear test data (items with 'test-' or 'msg-' prefix)
        const testThreads = await db.threads.filter((t) => t.id.startsWith('test-')).toArray();
        const testMessages = await db.messages.filter((m) => m.id.startsWith('msg-')).toArray();

        for (const t of testThreads) {
            await db.threads.delete(t.id);
        }
        for (const m of testMessages) {
            await db.messages.delete(m.id);
        }

        createResult.value = {
            type: 'success',
            message: `🧹 Cleared ${testThreads.length} test threads and ${testMessages.length} test messages`,
        };
        await loadStats();
        await loadRecentThreads();
        await loadRecentMessages();
    } catch (e) {
        createResult.value = { type: 'error', message: `❌ ${e instanceof Error ? e.message : String(e)}` };
    } finally {
        creating.value = false;
    }
}

// ----- Initialize -----
onMounted(async () => {
    await loadStats();
    await loadRecentThreads();
    await loadRecentMessages();
    await loadPendingOps();
});
</script>

<template>
    <div class="test-wrapper">
        <div class="test-page">
            <h1>🔄 Sync Layer Test</h1>
            <p class="subtitle">Test local database operations for threads and messages</p>

            <!-- Auth Status -->
            <div class="card" :class="identity ? 'status-green' : 'status-yellow'">
                <h2>{{ identity ? '✅ Authenticated' : '⏳ Not Authenticated' }}</h2>
                <p v-if="identity">Signed in as: {{ identity.email }}</p>
                <p v-else>Local-only mode (sign in for sync to Convex)</p>
            </div>

            <!-- Workspace Selection -->
            <div class="card" v-if="identity">
                <h2>🏢 Workspace</h2>
                <div v-if="workspacesLoading" class="info">Loading workspaces...</div>
                <div v-else-if="workspaces && workspaces.length > 0">
                    <p class="help">Select a workspace for sync:</p>
                    <div class="workspace-list">
                        <div
                            v-for="ws in workspaces ?? []"
                            :key="ws._id"
                            class="workspace-item"
                            :class="{ selected: selectedWorkspaceId === ws._id }"
                            @click="selectedWorkspaceId = ws._id"
                        >
                            <span class="ws-name">{{ ws.name }}</span>
                            <span class="ws-role">{{ ws.role }}</span>
                            <span v-if="selectedWorkspaceId === ws._id" class="ws-check">✓</span>
                        </div>
                    </div>
                </div>
                <div v-else>
                    <p class="help">No workspaces found. Create one to enable sync:</p>
                    <button class="btn btn-primary" @click="createTestWorkspace" :disabled="creatingWorkspace">
                        {{ creatingWorkspace ? 'Creating...' : '+ Create Test Workspace' }}
                    </button>
                    <div v-if="workspaceError" class="error-msg">{{ workspaceError }}</div>
                </div>
            </div>

            <!-- Database Stats -->
            <div class="card">
                <h2>📊 Database Stats</h2>
                <button class="btn" @click="loadStats">Refresh Stats</button>
                <div class="stats-grid">
                    <div class="stat">
                        <span class="stat-value">{{ stats.threads }}</span>
                        <span class="stat-label">Threads</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">{{ stats.messages }}</span>
                        <span class="stat-label">Messages</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">{{ stats.pendingOps }}</span>
                        <span class="stat-label">Pending Ops</span>
                    </div>
                </div>
            </div>

            <!-- Create Test Data -->
            <div class="card">
                <h2>🧪 Create Test Data</h2>
                <p class="help">Create threads and messages to verify local storage is working</p>
                <div class="btn-row">
                    <button class="btn btn-primary" @click="createTestThread" :disabled="creating || syncing">
                        {{ creating ? 'Creating...' : '+ Create Thread' }}
                    </button>
                    <button class="btn btn-primary" @click="createTestMessage" :disabled="creating || syncing">
                        {{ creating ? 'Creating...' : '+ Create Message' }}
                    </button>
                    <button class="btn btn-danger" @click="clearTestData" :disabled="creating || syncing">
                        🧹 Clear Test Data
                    </button>
                </div>
                <div class="btn-row" style="margin-top: 0.5rem">
                    <button
                        class="btn"
                        style="background: #8b5cf6"
                        @click="syncAllLocalData"
                        :disabled="syncing || !selectedWorkspaceId"
                    >
                        {{ syncing ? 'Syncing...' : '🔄 Sync All to Convex' }}
                    </button>
                </div>
                <div v-if="createResult" :class="createResult.type === 'success' ? 'success-msg' : 'error-msg'">
                    {{ createResult.message }}
                </div>
            </div>

            <!-- Recent Threads -->
            <div class="card">
                <h2>💬 Recent Threads</h2>
                <button class="btn" @click="loadRecentThreads" :disabled="threadsLoading">
                    {{ threadsLoading ? 'Loading...' : 'Refresh' }}
                </button>
                <table v-if="recentThreads.length" class="results-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Title</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="t in recentThreads" :key="t.id">
                            <td class="mono">{{ t.id.slice(0, 12) }}...</td>
                            <td>{{ t.title }}</td>
                            <td>{{ t.createdAt }}</td>
                        </tr>
                    </tbody>
                </table>
                <p v-else class="info">No threads in local database</p>
            </div>

            <!-- Recent Messages -->
            <div class="card">
                <h2>📝 Recent Messages</h2>
                <button class="btn" @click="loadRecentMessages" :disabled="messagesLoading">
                    {{ messagesLoading ? 'Loading...' : 'Refresh' }}
                </button>
                <table v-if="recentMessages.length" class="results-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Thread</th>
                            <th>Role</th>
                            <th>Preview</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="m in recentMessages" :key="m.id">
                            <td class="mono">{{ m.id.slice(0, 10) }}...</td>
                            <td class="mono">{{ m.threadId.slice(0, 8) }}...</td>
                            <td><span class="badge" :class="m.role">{{ m.role }}</span></td>
                            <td>{{ m.preview }}</td>
                        </tr>
                    </tbody>
                </table>
                <p v-else class="info">No messages in local database</p>
            </div>

            <!-- Pending Operations -->
            <div class="card">
                <h2>📤 Pending Operations</h2>
                <p class="help">Operations waiting to sync to Convex</p>
                <button class="btn" @click="loadPendingOps">Refresh</button>
                <table v-if="pendingOps.length" class="results-table">
                    <thead>
                        <tr>
                            <th>Table</th>
                            <th>Primary Key</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="op in pendingOps" :key="op.id">
                            <td><code>{{ op.tableName }}</code></td>
                            <td class="mono">{{ op.pk.slice(0, 12) }}...</td>
                            <td class="pending">{{ op.status }}</td>
                        </tr>
                    </tbody>
                </table>
                <p v-else class="info">✅ No pending operations - all synced!</p>
            </div>

            <!-- Navigation -->
            <div class="nav-links">
                <NuxtLink to="/" class="link">← Home</NuxtLink>
                <NuxtLink to="/_tests/_test-auth" class="link">← Auth Test</NuxtLink>
                <NuxtLink to="/_tests/_test-storage" class="link">Storage Test →</NuxtLink>
            </div>
        </div>
    </div>
</template>

<style scoped>
.test-wrapper {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    background: white;
}

.test-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, sans-serif;
}

h1 {
    margin-bottom: 0.5rem;
}

.subtitle {
    color: #666;
    margin-bottom: 2rem;
}

.card {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}

.card h2 {
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.25rem;
}

.status-green {
    background: #d1fae5;
    border-color: #10b981;
}
.status-yellow {
    background: #fef3c7;
    border-color: #f59e0b;
}

.workspace-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
}

.workspace-item {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
}

.workspace-item:hover {
    border-color: #3b82f6;
}

.workspace-item.selected {
    border-color: #10b981;
    background: #d1fae5;
}

.ws-name {
    font-weight: 500;
    flex: 1;
}

.ws-role {
    font-size: 0.75rem;
    color: #666;
    background: #e5e7eb;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    margin-right: 0.5rem;
}

.ws-check {
    color: #10b981;
    font-weight: bold;
}

.btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    margin-right: 0.5rem;
    margin-bottom: 0.5rem;
}

.btn:hover {
    background: #2563eb;
}

.btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
}

.btn-primary {
    background: #10b981;
}
.btn-primary:hover {
    background: #059669;
}

.btn-danger {
    background: #ef4444;
}
.btn-danger:hover {
    background: #dc2626;
}

.btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

.help {
    color: #666;
    font-size: 0.875rem;
    margin-bottom: 1rem;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-top: 1rem;
}

.stat {
    background: white;
    padding: 1rem;
    border-radius: 8px;
    text-align: center;
}

.stat-value {
    display: block;
    font-size: 2rem;
    font-weight: 600;
    color: #3b82f6;
}

.stat-label {
    font-size: 0.75rem;
    color: #666;
}

.results-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
}

.results-table th,
.results-table td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
}

.results-table th {
    background: #f3f4f6;
    font-weight: 600;
}

.mono {
    font-family: monospace;
    font-size: 0.8rem;
}

.info {
    color: #3b82f6;
    margin-top: 1rem;
}

.success-msg {
    color: #10b981;
    background: #d1fae5;
    padding: 0.75rem;
    border-radius: 6px;
    margin-top: 1rem;
}

.error-msg {
    color: #ef4444;
    background: #fee2e2;
    padding: 0.75rem;
    border-radius: 6px;
    margin-top: 1rem;
}

.pending {
    color: #f59e0b;
}

.badge {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
}

.badge.user {
    background: #dbeafe;
    color: #1d4ed8;
}

.badge.assistant {
    background: #d1fae5;
    color: #047857;
}

.nav-links {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 2rem;
}

.link {
    color: #3b82f6;
    text-decoration: none;
}

.link:hover {
    text-decoration: underline;
}
</style>
