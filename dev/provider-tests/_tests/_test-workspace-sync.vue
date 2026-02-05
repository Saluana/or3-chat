<script setup lang="ts">
/**
 * Workspace Sync Test Page
 * Visit: http://localhost:3000/_tests/_test-workspace-sync
 *
 * Comprehensive tests for workspace sync behavior:
 * - Workspace switching preserves data isolation
 * - Data syncs correctly per workspace
 * - Cursor management per workspace
 * - Cross-workspace contamination detection
 */

definePageMeta({ ssr: false });

import { getDb, setActiveWorkspaceDb, getActiveWorkspaceId, getWorkspaceDbCacheStats } from '~/db/client';
import { getHookBridge } from '~/core/sync/hook-bridge';
import { nowSec } from '~/db/util';

// ----- State -----
const activeWorkspace = ref<string | null>(getActiveWorkspaceId());
const workspaces = ref<string[]>(['workspace-alpha', 'workspace-beta', 'workspace-gamma']);
const selectedWorkspace = ref<string>('workspace-alpha');

const testLog = ref<Array<{ time: string; message: string; status: 'info' | 'success' | 'warning' | 'error' }>>([]);
const testRunning = ref(false);
const testResults = ref<{ name: string; passed: boolean; details: string }[]>([]);

const workspaceStats = ref<Record<string, { threads: number; messages: number; pendingOps: number; cursor: number }>>({});
const cacheStats = ref({ size: 0, max: 0, keys: [] as string[] });

// ----- Helper Functions -----
function log(message: string, status: 'info' | 'success' | 'warning' | 'error' = 'info') {
    testLog.value.push({
        time: new Date().toLocaleTimeString(),
        message,
        status,
    });
}

function ensureHookBridge() {
    const bridge = getHookBridge(getDb());
    bridge.start();
}

async function switchWorkspace(workspaceId: string | null) {
    setActiveWorkspaceDb(workspaceId);
    activeWorkspace.value = getActiveWorkspaceId();
    ensureHookBridge();
    cacheStats.value = getWorkspaceDbCacheStats();
    log(`Switched to workspace: ${workspaceId ?? 'null'}`, 'info');
}

async function getWorkspaceData(workspaceId: string): Promise<{ threads: number; messages: number; pendingOps: number; cursor: number }> {
    // Temporarily switch to workspace
    setActiveWorkspaceDb(workspaceId);
    const db = getDb();
    
    const threads = await db.threads.count();
    const messages = await db.messages.count();
    const pendingOps = await db.pending_ops.count();
    
    // Get cursor from kv
    const cursorEntry = await db.kv.get('kv:sync_cursor');
    const cursor = cursorEntry ? Number(cursorEntry.value) || 0 : 0;
    
    return { threads, messages, pendingOps, cursor };
}

async function refreshAllWorkspaceStats() {
    const stats: Record<string, { threads: number; messages: number; pendingOps: number; cursor: number }> = {};
    
    for (const ws of workspaces.value) {
        stats[ws] = await getWorkspaceData(ws);
    }
    
    // Switch back to selected workspace
    setActiveWorkspaceDb(selectedWorkspace.value);
    workspaceStats.value = stats;
    cacheStats.value = getWorkspaceDbCacheStats();
}

// ----- Test Operations -----
async function createThreadInWorkspace(workspaceId: string, suffix: string = '') {
    setActiveWorkspaceDb(workspaceId);
    ensureHookBridge();
    
    const db = getDb();
    const id = `ws-thread-${workspaceId}-${Date.now()}${suffix}`;
    const timestamp = nowSec();
    
    await db.threads.put({
        id,
        title: `Thread in ${workspaceId}`,
        status: 'ready',
        deleted: false,
        pinned: false,
        forked: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    
    log(`Created thread in ${workspaceId}: ${id.slice(0, 30)}...`, 'info');
    return id;
}

async function verifyThreadExists(workspaceId: string, threadId: string): Promise<boolean> {
    setActiveWorkspaceDb(workspaceId);
    const db = getDb();
    const thread = await db.threads.get(threadId);
    return thread !== undefined;
}

async function clearWorkspace(workspaceId: string) {
    setActiveWorkspaceDb(workspaceId);
    ensureHookBridge();
    
    const db = getDb();
    await db.transaction('rw', [db.threads, db.messages, db.pending_ops, db.tombstones, db.kv], async () => {
        await db.threads.clear();
        await db.messages.clear();
        await db.pending_ops.clear();
        await db.tombstones.clear();
        await db.kv.clear();
    });
    
    log(`Cleared workspace: ${workspaceId}`, 'warning');
}

// ----- Test Suite -----
async function runWorkspaceSyncTests() {
    testRunning.value = true;
    testLog.value = [];
    testResults.value = [];
    
    log('🚀 Starting Workspace Sync Test Suite', 'info');
    
    try {
        // Test 1: Workspace Isolation
        await runIsolationTest();
        
        // Test 2: Data Preservation on Switch
        await runPreservationTest();
        
        // Test 3: Cross-Workspace Contamination Check
        await runContaminationTest();
        
        // Test 4: Cursor Independence
        await runCursorTest();
        
        // Test 5: Rapid Switching Stress Test
        await runRapidSwitchTest();
        
        log('✅ All workspace sync tests complete!', 'success');
        
    } catch (e) {
        log(`❌ Test suite failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
        // Restore to selected workspace
        setActiveWorkspaceDb(selectedWorkspace.value);
        await refreshAllWorkspaceStats();
        testRunning.value = false;
    }
}

async function runIsolationTest() {
    log('--- Test 1: Workspace Isolation ---', 'info');
    
    // Clear all workspaces
    for (const ws of workspaces.value) {
        await clearWorkspace(ws);
    }
    
    // Create thread in workspace-alpha
    const threadId = await createThreadInWorkspace('workspace-alpha', '-isolation');
    
    // Verify it exists in workspace-alpha
    const existsInAlpha = await verifyThreadExists('workspace-alpha', threadId);
    
    // Verify it does NOT exist in workspace-beta
    const existsInBeta = await verifyThreadExists('workspace-beta', threadId);
    
    const passed = existsInAlpha && !existsInBeta;
    testResults.value.push({
        name: 'Workspace Isolation',
        passed,
        details: passed 
            ? 'Thread only visible in correct workspace' 
            : `Failed: Alpha=${existsInAlpha}, Beta=${existsInBeta}`,
    });
    
    log(passed ? '✅ Isolation test passed' : '❌ Isolation test failed', passed ? 'success' : 'error');
}

async function runPreservationTest() {
    log('--- Test 2: Data Preservation on Switch ---', 'info');
    
    // Create thread in alpha
    await clearWorkspace('workspace-alpha');
    const threadId = await createThreadInWorkspace('workspace-alpha', '-preserve');
    
    // Switch away
    await switchWorkspace('workspace-beta');
    await new Promise(r => setTimeout(r, 500));
    
    // Switch back
    await switchWorkspace('workspace-alpha');
    
    // Verify thread still exists
    const stillExists = await verifyThreadExists('workspace-alpha', threadId);
    
    testResults.value.push({
        name: 'Data Preservation',
        passed: stillExists,
        details: stillExists 
            ? 'Data preserved after workspace switch' 
            : 'Data lost after switching workspaces!',
    });
    
    log(stillExists ? '✅ Preservation test passed' : '❌ Preservation test failed', stillExists ? 'success' : 'error');
}

async function runContaminationTest() {
    log('--- Test 3: Cross-Workspace Contamination Check ---', 'info');
    
    // Clear all workspaces
    for (const ws of workspaces.value) {
        await clearWorkspace(ws);
    }
    
    // Create unique data in each workspace
    const alphaThread = await createThreadInWorkspace('workspace-alpha', '-contam-check');
    const betaThread = await createThreadInWorkspace('workspace-beta', '-contam-check');
    const gammaThread = await createThreadInWorkspace('workspace-gamma', '-contam-check');
    
    // Verify each thread only exists in its workspace
    const alphaInAlpha = await verifyThreadExists('workspace-alpha', alphaThread);
    const alphaInBeta = await verifyThreadExists('workspace-beta', alphaThread);
    const alphaInGamma = await verifyThreadExists('workspace-gamma', alphaThread);
    
    const betaInAlpha = await verifyThreadExists('workspace-alpha', betaThread);
    const betaInBeta = await verifyThreadExists('workspace-beta', betaThread);
    const betaInGamma = await verifyThreadExists('workspace-gamma', betaThread);
    
    const passed = alphaInAlpha && !alphaInBeta && !alphaInGamma &&
                   !betaInAlpha && betaInBeta && !betaInGamma;
    
    testResults.value.push({
        name: 'No Cross-Contamination',
        passed,
        details: passed 
            ? 'No data leaked between workspaces' 
            : 'Data contamination detected between workspaces!',
    });
    
    log(passed ? '✅ Contamination test passed' : '❌ Contamination test failed', passed ? 'success' : 'error');
}

async function runCursorTest() {
    log('--- Test 4: Cursor Independence ---', 'info');
    
    // Set different cursors in different workspaces
    await switchWorkspace('workspace-alpha');
    let db = getDb();
    await db.kv.put({
        id: 'kv:sync_cursor',
        name: 'sync_cursor',
        value: '1000',
        deleted: false,
        created_at: nowSec(),
        updated_at: nowSec(),
        clock: 1,
    });
    
    await switchWorkspace('workspace-beta');
    db = getDb();
    await db.kv.put({
        id: 'kv:sync_cursor',
        name: 'sync_cursor',
        value: '2000',
        deleted: false,
        created_at: nowSec(),
        updated_at: nowSec(),
        clock: 1,
    });
    
    // Verify cursors are different
    await refreshAllWorkspaceStats();
    const alphaCursor = workspaceStats.value['workspace-alpha']?.cursor;
    const betaCursor = workspaceStats.value['workspace-beta']?.cursor;
    
    const passed = alphaCursor === 1000 && betaCursor === 2000;
    
    testResults.value.push({
        name: 'Cursor Independence',
        passed,
        details: passed 
            ? `Cursors independent (Alpha=${alphaCursor}, Beta=${betaCursor})` 
            : `Cursors not independent (Alpha=${alphaCursor}, Beta=${betaCursor})`,
    });
    
    log(passed ? '✅ Cursor test passed' : '❌ Cursor test failed', passed ? 'success' : 'error');
}

async function runRapidSwitchTest() {
    log('--- Test 5: Rapid Switching Stress Test ---', 'info');
    
    // Rapidly switch between workspaces
    for (let i = 0; i < 10; i++) {
        const ws = workspaces.value[i % workspaces.value.length]!;
        await switchWorkspace(ws);
        await new Promise(r => setTimeout(r, 50));
    }
    
    // Verify we can still read data
    let passed = true;
    try {
        await refreshAllWorkspaceStats();
        passed = Object.keys(workspaceStats.value).length === workspaces.value.length;
    } catch (e) {
        passed = false;
    }
    
    testResults.value.push({
        name: 'Rapid Switching',
        passed,
        details: passed 
            ? 'System stable after rapid workspace switches' 
            : 'System unstable after rapid switching!',
    });
    
    log(passed ? '✅ Rapid switch test passed' : '❌ Rapid switch test failed', passed ? 'success' : 'error');
}

// ----- Cleanup -----
async function clearAllWorkspaces() {
    for (const ws of workspaces.value) {
        await clearWorkspace(ws);
    }
    await refreshAllWorkspaceStats();
    log('🧹 All workspaces cleared', 'warning');
}

// ----- Initialize -----
onMounted(async () => {
    setActiveWorkspaceDb(selectedWorkspace.value);
    ensureHookBridge();
    await refreshAllWorkspaceStats();
});
</script>

<template>
    <div class="test-wrapper">
        <div class="test-page">
            <h1>🏢 Workspace Sync Test</h1>
            <p class="subtitle">Comprehensive tests for multi-workspace sync isolation and data integrity</p>

            <!-- Current Workspace -->
            <div class="status-banner">
                <span class="status-icon">📂</span>
                <span class="status-text">Active: {{ activeWorkspace ?? 'none' }}</span>
                <span class="cache-info">Cache: {{ cacheStats.keys.length }} workspaces loaded</span>
            </div>

            <!-- Controls -->
            <div class="card">
                <h2>🎮 Test Controls</h2>
                <div class="controls">
                    <button 
                        data-testid="run-all-tests" 
                        class="btn btn-primary" 
                        @click="runWorkspaceSyncTests"
                        :disabled="testRunning"
                    >
                        {{ testRunning ? '⏳ Running...' : '▶️ Run All Tests' }}
                    </button>
                    <button data-testid="refresh-stats" class="btn" @click="refreshAllWorkspaceStats">
                        🔄 Refresh Stats
                    </button>
                    <button data-testid="clear-all" class="btn btn-danger" @click="clearAllWorkspaces">
                        🧹 Clear All Workspaces
                    </button>
                </div>
            </div>

            <!-- Workspace Switcher -->
            <div class="card">
                <h2>🔀 Workspace Switcher</h2>
                <div class="workspace-grid">
                    <button
                        v-for="ws in workspaces"
                        :key="ws"
                        :data-testid="`switch-${ws}`"
                        class="workspace-btn"
                        :class="{ active: activeWorkspace === ws }"
                        @click="switchWorkspace(ws); selectedWorkspace = ws"
                    >
                        <span class="ws-name">{{ ws }}</span>
                        <span class="ws-stats" v-if="workspaceStats[ws]">
                            {{ workspaceStats[ws].threads }} threads, 
                            {{ workspaceStats[ws].pendingOps }} pending
                        </span>
                    </button>
                </div>
            </div>

            <!-- Workspace Stats Comparison -->
            <div class="card">
                <h2>📊 Workspace Comparison</h2>
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th>Workspace</th>
                            <th>Threads</th>
                            <th>Messages</th>
                            <th>Pending Ops</th>
                            <th>Cursor</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr 
                            v-for="ws in workspaces" 
                            :key="ws"
                            :class="{ 'active-row': activeWorkspace === ws }"
                        >
                            <td data-testid="ws-name">{{ ws }}</td>
                            <td data-testid="ws-threads">{{ workspaceStats[ws]?.threads ?? '-' }}</td>
                            <td data-testid="ws-messages">{{ workspaceStats[ws]?.messages ?? '-' }}</td>
                            <td data-testid="ws-pending">{{ workspaceStats[ws]?.pendingOps ?? '-' }}</td>
                            <td data-testid="ws-cursor">{{ workspaceStats[ws]?.cursor ?? '-' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Test Results -->
            <div class="card" v-if="testResults.length > 0">
                <h2>📋 Test Results</h2>
                <div class="results-list">
                    <div 
                        v-for="(result, i) in testResults" 
                        :key="i"
                        class="result-item"
                        :class="result.passed ? 'passed' : 'failed'"
                    >
                        <span class="result-icon">{{ result.passed ? '✅' : '❌' }}</span>
                        <span class="result-name">{{ result.name }}</span>
                        <span class="result-details">{{ result.details }}</span>
                    </div>
                </div>
                <div class="results-summary">
                    {{ testResults.filter(r => r.passed).length }} / {{ testResults.length }} tests passed
                </div>
            </div>

            <!-- Test Log -->
            <div class="card">
                <h2>📋 Test Log</h2>
                <div class="log" data-testid="test-log">
                    <div 
                        v-for="(entry, i) in testLog" 
                        :key="i" 
                        class="log-entry"
                        :class="entry.status"
                    >
                        <span class="log-time">{{ entry.time }}</span>
                        <span class="log-message">{{ entry.message }}</span>
                    </div>
                    <div v-if="testLog.length === 0" class="log-empty">
                        No log entries yet. Run the tests to begin.
                    </div>
                </div>
            </div>

            <!-- Navigation -->
            <div class="nav-links">
                <NuxtLink to="/" class="link">← Home</NuxtLink>
                <NuxtLink to="/_tests/_test-sync-e2e" class="link">Sync E2E →</NuxtLink>
                <NuxtLink to="/_tests/_test-offline-resilience" class="link">Offline Test →</NuxtLink>
            </div>
        </div>
    </div>
</template>

<style scoped>
.test-wrapper {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    background: #0f172a;
    color: #e2e8f0;
}

.test-page {
    max-width: 1000px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, sans-serif;
}

h1 { margin-bottom: 0.5rem; color: #f8fafc; }
h2 { margin: 0 0 1rem; font-size: 1.1rem; color: #94a3b8; }
.subtitle { color: #64748b; margin-bottom: 2rem; }

.status-banner {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
    background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%);
    border: 2px solid #3b82f6;
}
.status-icon { font-size: 1.5rem; }
.status-text { flex: 1; font-weight: 600; }
.cache-info { font-size: 0.875rem; opacity: 0.8; }

.card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}

.controls { display: flex; flex-wrap: wrap; gap: 0.75rem; }

.btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s;
}
.btn:hover { background: #2563eb; transform: translateY(-1px); }
.btn:disabled { background: #475569; cursor: not-allowed; transform: none; }
.btn-primary { background: #10b981; }
.btn-primary:hover { background: #059669; }
.btn-danger { background: #ef4444; }
.btn-danger:hover { background: #dc2626; }

.workspace-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
}
.workspace-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem;
    background: #0f172a;
    border: 2px solid #334155;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.15s;
    color: #e2e8f0;
}
.workspace-btn:hover { border-color: #3b82f6; }
.workspace-btn.active { border-color: #22c55e; background: #14532d; }
.ws-name { font-weight: 600; font-size: 1rem; }
.ws-stats { font-size: 0.75rem; color: #64748b; margin-top: 0.5rem; }

.stats-table {
    width: 100%;
    border-collapse: collapse;
}
.stats-table th, .stats-table td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid #334155;
}
.stats-table th { background: #0f172a; font-weight: 600; color: #94a3b8; }
.stats-table .active-row { background: #1e3a5f; }

.results-list { display: flex; flex-direction: column; gap: 0.5rem; }
.result-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: #0f172a;
    border-radius: 8px;
    border-left: 3px solid;
}
.result-item.passed { border-left-color: #22c55e; }
.result-item.failed { border-left-color: #ef4444; }
.result-icon { font-size: 1.2rem; }
.result-name { font-weight: 600; min-width: 200px; }
.result-details { font-size: 0.875rem; color: #94a3b8; }
.results-summary {
    margin-top: 1rem;
    padding: 0.75rem;
    background: #0f172a;
    border-radius: 8px;
    text-align: center;
    font-weight: 600;
}

.log {
    max-height: 250px;
    overflow-y: auto;
    background: #0f172a;
    border-radius: 8px;
    padding: 1rem;
}
.log-entry {
    display: flex;
    gap: 1rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid #1e293b;
    font-size: 0.875rem;
}
.log-entry.success { color: #22c55e; }
.log-entry.warning { color: #f59e0b; }
.log-entry.error { color: #ef4444; }
.log-time { font-family: monospace; font-size: 0.75rem; color: #64748b; min-width: 70px; }
.log-message { flex: 1; }
.log-empty { color: #64748b; text-align: center; padding: 2rem; }

.nav-links { display: flex; gap: 1rem; justify-content: center; margin-top: 2rem; }
.link { color: #3b82f6; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
