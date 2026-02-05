<script setup lang="ts">
/**
 * Offline-to-Online Resilience Test Page
 * Visit: http://localhost:3000/_tests/_test-offline-resilience
 *
 * Tests the full offline/online sync lifecycle:
 * - Simulates going offline
 * - Queues operations while offline
 * - Verifies UI shows pending states
 * - Goes back online
 * - Verifies operations flush automatically
 */

definePageMeta({ ssr: false });

import { getDb, getActiveWorkspaceId } from '~/db/client';
import { getHookBridge } from '~/core/sync/hook-bridge';
import { nowSec } from '~/db/util';
import { useNuxtApp } from '#app';

// Access sync engine for manual flush
const nuxtApp = useNuxtApp();
const syncEngine = nuxtApp.$syncEngine as { isRunning: () => boolean; flush: () => Promise<boolean> } | undefined;

// ----- State -----
const isSimulatedOffline = ref(false);
const testPhase = ref<'idle' | 'offline' | 'creating' | 'online' | 'verifying' | 'complete'>('idle');
const testLog = ref<Array<{ time: string; message: string; status: 'info' | 'success' | 'warning' | 'error'; details?: unknown }>>([]);

const stats = ref({
    pendingOps: 0,
    threads: 0,
    messages: 0,
    kvEntries: 0,
});

const createdItems = ref<{ type: string; id: string; status: 'pending' | 'synced' | 'failed' }[]>([]);

// ----- Helper Functions -----
function log(message: string, status: 'info' | 'success' | 'warning' | 'error' = 'info', details?: unknown) {
    testLog.value.push({
        time: new Date().toLocaleTimeString(),
        message,
        status,
        details: details ? JSON.parse(JSON.stringify(details)) : undefined
    });
}

async function refreshStats() {
    const db = getDb();
    stats.value = {
        pendingOps: await db.pending_ops.where('status').equals('pending').count(),
        threads: await db.threads.count(),
        messages: await db.messages.count(),
        kvEntries: await db.kv.count(),
    };
}

function ensureHookBridge() {
    const bridge = getHookBridge(getDb());
    bridge.start();
}

// ----- Offline Simulation -----
// we use a global flag that OutboxManager checks to simulate offline mode
// this allows us to verify queueing behavior without actually network disconnects

async function goOffline() {
    isSimulatedOffline.value = true;
    testPhase.value = 'offline';
    log('📴 Simulated OFFLINE mode - operations will queue locally', 'warning');
    
    // Set a flag that OutboxManager checks
    (globalThis as any).__OR3_TEST_OFFLINE = true;
    
    await refreshStats();
}

async function goOnline() {
    isSimulatedOffline.value = false;
    testPhase.value = 'online';
    log('📶 Simulated ONLINE mode - operations should flush', 'success');
    
    (globalThis as any).__OR3_TEST_OFFLINE = false;
    
    // Trigger manual flush if sync engine is available
    if (syncEngine?.isRunning()) {
        log('🔄 Triggering sync flush...', 'info');
        const flushed = await syncEngine.flush();
        log(flushed ? '✅ Flush completed' : '⏳ Flush already in progress or no ops', flushed ? 'success' : 'warning');
    } else {
        log('⚠️ Sync engine not running - waiting for auto-flush...', 'warning');
    }
    
    // Give the system time to complete
    await new Promise(r => setTimeout(r, 1000));
    await refreshStats();
    
    testPhase.value = 'verifying';
    await verifySync();
}

// ----- Test Operations -----
async function createOfflineThread() {
    const db = getDb();
    const id = `offline-thread-${Date.now()}`;
    const timestamp = nowSec();
    
    await db.threads.put({
        id,
        title: `Offline Thread ${new Date().toLocaleTimeString()}`,
        status: 'ready',
        deleted: false,
        pinned: false,
        forked: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    
    createdItems.value.push({ type: 'thread', id, status: 'pending' });
    log(`Created thread: ${id}`, 'info');
    await refreshStats();
}

async function createOfflineMessage() {
    const db = getDb();
    const threads = await db.threads.limit(1).toArray();
    const threadId = threads[0]?.id ?? `orphan-${Date.now()}`;
    const id = `offline-msg-${Date.now()}`;
    const timestamp = nowSec();
    
    await db.messages.put({
        id,
        thread_id: threadId,
        index: 1,
        role: 'user',
        data: { text: `Offline message at ${new Date().toISOString()}` },
        pending: false,
        deleted: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    
    createdItems.value.push({ type: 'message', id, status: 'pending' });
    log(`Created message: ${id}`, 'info');
    await refreshStats();
}

async function changeOfflineSetting() {
    const db = getDb();
    const id = 'kv:test_offline_setting';
    const timestamp = nowSec();
    
    await db.kv.put({
        id,
        name: 'test_offline_setting',
        value: `changed-at-${Date.now()}`,
        deleted: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    
    createdItems.value.push({ type: 'setting', id, status: 'pending' });
    log(`Changed setting: ${id}`, 'info');
    await refreshStats();
}

// ----- Verification -----
async function verifySync() {
    const db = getDb();
    
    // Check if pending ops flushed
    const remainingOps = await db.pending_ops.where('status').equals('pending').count();
    const failedOps = await db.pending_ops.where('status').equals('failed').toArray();
    
    if (remainingOps === 0 && failedOps.length === 0) {
        log(`✅ All operations synced successfully!`, 'success');
        createdItems.value.forEach(item => item.status = 'synced');
    } else if (remainingOps > 0) {
        log(`⏳ ${remainingOps} operations still pending...`, 'warning');
    } else if (failedOps.length > 0) {
        log(`❌ ${failedOps.length} operations failed to sync`, 'error', failedOps);
        // Mark failed items
        failedOps.forEach(op => {
            const item = createdItems.value.find(i => i.id === op.pk);
            if (item) item.status = 'failed';
        });
    }
    
    testPhase.value = 'complete';
    await refreshStats();
}

// ----- Full Test Run -----
async function runFullTest() {
    testLog.value = [];
    createdItems.value = [];
    testPhase.value = 'idle';
    
    log('🚀 Starting Offline-to-Online Resilience Test', 'info');
    
    // Step 1: Ensure hook bridge is running
    ensureHookBridge();
    await refreshStats();
    const initialPending = stats.value.pendingOps;
    log(`Initial state: ${initialPending} pending ops`, 'info');
    
    // Step 2: Go offline
    await goOffline();
    
    // Step 3: Create operations while offline
    testPhase.value = 'creating';
    log('Creating operations while offline...', 'info');
    
    await createOfflineThread();
    await new Promise(r => setTimeout(r, 300));
    await createOfflineMessage();
    await new Promise(r => setTimeout(r, 300));
    await createOfflineMessage();
    await new Promise(r => setTimeout(r, 300));
    await createOfflineMessage();
    await new Promise(r => setTimeout(r, 300));
    await changeOfflineSetting();
    
    await refreshStats();
    const offlinePending = stats.value.pendingOps;
    log(`After offline operations: ${offlinePending} pending ops`, offlinePending > initialPending ? 'success' : 'warning');
    
    // Step 4: Wait a moment, then go online
    log('Waiting 2 seconds before going online...', 'info');
    await new Promise(r => setTimeout(r, 2000));
    
    // Step 5: Go online and verify
    await goOnline();
}

// ----- Manual Flush -----
async function manualFlush() {
    const db = getDb();
    await db.pending_ops.where('status').equals('pending').delete();
    log('🧹 Manually cleared all pending ops', 'warning');
    await refreshStats();
}

async function resetTest() {
    const db = getDb();
    
    // Clear test data
    const testThreads = await db.threads.filter(t => t.id.startsWith('offline-')).toArray();
    const testMessages = await db.messages.filter(m => m.id.startsWith('offline-')).toArray();
    const testKv = await db.kv.filter(k => k.id.startsWith('kv:test_')).toArray();
    
    for (const t of testThreads) await db.threads.delete(t.id);
    for (const m of testMessages) await db.messages.delete(m.id);
    for (const k of testKv) await db.kv.delete(k.id);
    
    testLog.value = [];
    createdItems.value = [];
    testPhase.value = 'idle';
    isSimulatedOffline.value = false;
    (globalThis as any).__OR3_TEST_OFFLINE = false;
    
    await refreshStats();
    log('🔄 Test reset complete', 'info');
}

// ----- Initialize -----
onMounted(async () => {
    ensureHookBridge();
    await refreshStats();
    
    // Check sync engine status
    if (syncEngine?.isRunning()) {
        log('✅ Sync engine is running', 'success');
    } else {
        log('⚠️ Sync engine not running - you may need to log in first', 'warning');
    }
});
</script>

<template>
    <div class="test-wrapper">
        <div class="test-container">
            <!-- Left Column: Controls & Content -->
            <div class="left-col">
                <header>
                    <h1>📴 Offline Resilience</h1>
                    <p class="subtitle">Simulate offline state and verify sync recovery</p>
                </header>

                <!-- Connection Status -->
                <div class="status-banner" :class="isSimulatedOffline ? 'offline' : 'online'">
                    <div class="status-content">
                        <span class="status-icon">{{ isSimulatedOffline ? '📴' : '📶' }}</span>
                        <div class="status-details">
                            <span class="status-text">{{ isSimulatedOffline ? 'SIMULATED OFFLINE' : 'ONLINE' }}</span>
                            <span class="status-phase">Phase: {{ testPhase }}</span>
                        </div>
                    </div>
                </div>

                <!-- Controls -->
                <div class="card">
                    <h2>🎮 Test Controls</h2>
                    <div class="controls">
                        <button 
                            data-testid="run-full-test" 
                            class="btn btn-primary" 
                            @click="runFullTest"
                            :disabled="testPhase !== 'idle' && testPhase !== 'complete'"
                        >
                            ▶️ Run Full Test
                        </button>
                        <button 
                            data-testid="go-offline" 
                            class="btn" 
                            @click="goOffline"
                            :disabled="isSimulatedOffline"
                        >
                            📴 Go Offline
                        </button>
                        <button 
                            data-testid="go-online" 
                            class="btn" 
                            @click="goOnline"
                            :disabled="!isSimulatedOffline"
                        >
                            📶 Go Online
                        </button>
                        <button data-testid="reset-test" class="btn btn-danger" @click="resetTest">
                            🔄 Reset
                        </button>
                    </div>
                </div>

                <!-- Manual Operations -->
                <div class="card" v-if="isSimulatedOffline || testPhase === 'creating'">
                    <h2>✏️ Create While Offline</h2>
                    <div class="controls">
                        <button data-testid="create-thread" class="btn" @click="createOfflineThread">
                            + Thread
                        </button>
                        <button data-testid="create-message" class="btn" @click="createOfflineMessage">
                            + Message
                        </button>
                        <button data-testid="change-setting" class="btn" @click="changeOfflineSetting">
                            ⚙️ Change Setting
                        </button>
                    </div>
                </div>

                <!-- Stats -->
                <div class="card">
                    <div class="card-header">
                        <h2>📊 Database Stats</h2>
                        <button class="btn btn-xs" @click="refreshStats">Refresh</button>
                    </div>
                    <div class="stats-grid">
                        <div class="stat" data-testid="pending-ops">
                            <span class="stat-value">{{ stats.pendingOps }}</span>
                            <span class="stat-label">Pending</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">{{ stats.threads }}</span>
                            <span class="stat-label">Threads</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">{{ stats.messages }}</span>
                            <span class="stat-label">Messages</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">{{ stats.kvEntries }}</span>
                            <span class="stat-label">KV</span>
                        </div>
                    </div>
                </div>

                <!-- Created Items -->
                <div class="card" v-if="createdItems.length > 0">
                    <h2>📦 Created Items</h2>
                    <div class="items-list">
                        <div 
                            v-for="item in createdItems" 
                            :key="item.id" 
                            class="item"
                            :class="item.status"
                        >
                            <div class="item-main">
                                <span class="item-type">{{ item.type }}</span>
                                <span class="item-id">{{ item.id.slice(0, 20) }}...</span>
                            </div>
                            <span class="item-status" :data-testid="`item-${item.id}`">
                                {{ item.status === 'pending' ? '⏳' : item.status === 'synced' ? '✅' : '❌' }}
                                {{ item.status }}
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- Navigation -->
                <div class="nav-links desktop-only">
                    <NuxtLink to="/" class="link">← Home</NuxtLink>
                    <NuxtLink to="/_tests/_test-sync-e2e" class="link">Sync E2E →</NuxtLink>
                </div>
            </div>

            <!-- Right Column: Logs (Sticky on desktop) -->
            <div class="right-col">
                <div class="log-panel">
                    <div class="log-header">
                        <h2>📋 Test Log</h2>
                        <button class="btn btn-xs" @click="testLog = []">Clear</button>
                    </div>
                    <div class="log-content" data-testid="test-log">
                        <div 
                            v-for="(entry, i) in testLog" 
                            :key="i" 
                            class="log-entry"
                            :class="entry.status"
                        >
                            <span class="log-time">{{ entry.time }}</span>
                            <span class="log-message">{{ entry.message }}</span>
                            
                            <!-- Detailed Error View -->
                            <div v-if="entry.details" class="log-details">
                                <pre>{{ JSON.stringify(entry.details, null, 2) }}</pre>
                            </div>
                        </div>
                        <div v-if="testLog.length === 0" class="log-empty">
                            <p>Ready to start.</p>
                            <p class="sub-text">Logs will appear here.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.test-wrapper {
    min-height: 100vh;
    background: #0f172a;
    color: #e2e8f0;
    font-family: system-ui, sans-serif;
}

.test-container {
    display: flex;
    flex-direction: column;
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
    gap: 1.5rem;
}

/* Tablet & Desktop */
@media (min-width: 768px) {
    .test-container {
        flex-direction: row;
        align-items: flex-start;
        padding: 2rem;
    }
    
    .left-col {
        flex: 1;
        min-width: 0; /* Prevent overflow */
    }
    
    .right-col {
        width: 450px;
        flex-shrink: 0;
        position: sticky;
        top: 2rem;
        height: calc(100vh - 4rem);
    }
    
    .log-panel {
        height: 100%;
        display: flex;
        flex-direction: column;
    }
    
    .log-content {
        flex: 1;
        overflow-y: auto;
    }
}

h1 { margin: 0 0 0.25rem; color: #f8fafc; font-size: 1.5rem; }
h2 { margin: 0; font-size: 1rem; color: #94a3b8; font-weight: 600; }
.subtitle { color: #64748b; margin: 0 0 1.5rem; font-size: 0.9rem; }

.status-banner {
    background: #1e293b;
    border: 2px solid #334155;
    border-radius: 12px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    transition: all 0.3s ease;
}
.status-banner.offline {
    background: linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%);
    border-color: #ef4444;
}
.status-banner.online {
    background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
    border-color: #10b981;
}
.status-content {
    display: flex;
    align-items: center;
    gap: 1rem;
}
.status-icon { font-size: 2rem; }
.status-details { display: flex; flex-direction: column; }
.status-text { font-weight: 700; font-size: 1.1rem; }
.status-phase { font-size: 0.8rem; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.05em; }

.card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1rem;
}
.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.controls { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }

.btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.9rem;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.btn:hover { background: #2563eb; transform: translateY(-1px); }
.btn:disabled { background: #475569; cursor: not-allowed; transform: none; opacity: 0.6; }
.btn-primary { background: #10b981; }
.btn-primary:hover { background: #059669; }
.btn-danger { background: #ef4444; }
.btn-danger:hover { background: #dc2626; }
.btn-xs { padding: 0.25rem 0.6rem; font-size: 0.75rem; background: #475569; }
.btn-xs:hover { background: #64748b; }

.stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
}
.stat {
    background: #0f172a;
    padding: 0.75rem;
    border-radius: 8px;
    text-align: center;
    border: 1px solid #334155;
}
.stat-value { display: block; font-size: 1.5rem; font-weight: 700; color: #3b82f6; }
.stat-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 600; }

.items-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
.item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background: #0f172a;
    border-radius: 8px;
    border-left: 3px solid #64748b;
}
.item.pending { border-left-color: #f59e0b; }
.item.synced { border-left-color: #22c55e; }
.item.failed { border-left-color: #ef4444; }
.item-main { display: flex; flex-direction: column; gap: 0.2rem; }
.item-type { font-weight: 600; font-size: 0.85rem; color: #e2e8f0; }
.item-id { font-family: monospace; font-size: 0.75rem; color: #64748b; }
.item-status { font-size: 0.8rem; font-weight: 500; }

.log-panel {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    overflow: hidden;
}
.log-header {
    background: #0f172a;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #334155;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.log-content {
    background: #0f172a;
    padding: 1rem;
    min-height: 300px;
    max-height: 600px; /* Limit height on mobile */
    overflow-y: auto;
}
@media (min-width: 768px) {
    .log-content { max-height: none; }
}

.log-entry {
    border-bottom: 1px solid #1e293b;
    padding: 0.5rem 0;
    font-size: 0.85rem;
    animation: fadeIn 0.2s ease-out;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

.log-entry.success { color: #4ade80; }
.log-entry.warning { color: #fbbf24; }
.log-entry.error { color: #f87171; }
.log-time { 
    display: inline-block; 
    font-family: monospace; 
    font-size: 0.75rem; 
    color: #64748b; 
    margin-right: 0.5rem;
    width: 65px;
}
.log-details {
    margin-top: 0.25rem;
    margin-left: 70px;
    background: #1e1e1e;
    padding: 0.5rem;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.75rem;
    color: #fca5a5;
    overflow-x: auto;
}
.log-empty {
    text-align: center;
    color: #64748b;
    padding: 4rem 1rem;
}
.sub-text { font-size: 0.8rem; margin-top: 0.5rem; opacity: 0.7; }

.nav-links { display: flex; gap: 1rem; justify-content: center; margin-top: 2rem; }
.link { color: #3b82f6; text-decoration: none; font-size: 0.9rem; }
.link:hover { text-decoration: underline; }
.desktop-only { display: none; }
@media (min-width: 768px) {
    .desktop-only { display: flex; }
}
</style>
