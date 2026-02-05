<script setup lang="ts">
/**
 * Sync Conflict Debug Test Page
 * Visit: http://localhost:3000/_tests/_test-sync-conflicts
 *
 * Diagnoses why sync conflict notifications appear on first load:
 * - Monitors bootstrap/rescan phases
 * - Tracks conflict detection events
 * - Shows notification suppression status
 * - Debugs initial sync behavior
 */

definePageMeta({ ssr: false });

import { getDb, getActiveWorkspaceId } from '~/db/client';
import { getHookBridge } from '~/core/sync/hook-bridge';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';

// ----- State -----
const hooks = useHooks();
const activeWorkspace = ref<string | null>(getActiveWorkspaceId());

const syncState = ref({
    isBootstrapping: false,
    isRescan: false,
    subscriptionStatus: 'unknown',
    lastError: null as string | null,
});

const conflictLog = ref<Array<{
    time: string;
    tableName: string;
    pk: string;
    winner: string;
    localClock: number;
    remoteClock: number;
    suppressed: boolean;
}>>([]);

const notificationLog = ref<Array<{
    time: string;
    type: string;
    title: string;
    body: string;
}>>([]);

const stats = ref({
    totalConflicts: 0,
    suppressedConflicts: 0,
    notifications: 0,
    pendingOps: 0,
    cursor: 0,
});

let isInitialSyncing = false;

// ----- Hook Listeners -----
function setupHookListeners() {
    // Track bootstrap phase
    hooks.addAction('sync.bootstrap:action:start', () => {
        syncState.value.isBootstrapping = true;
        isInitialSyncing = true;
        log('📥 Bootstrap started', 'info');
    });
    
    hooks.addAction('sync.bootstrap:action:complete', () => {
        syncState.value.isBootstrapping = false;
        isInitialSyncing = false;
        log('✅ Bootstrap complete', 'success');
    });
    
    // Track rescan phase
    hooks.addAction('sync.rescan:action:starting', () => {
        syncState.value.isRescan = true;
        isInitialSyncing = true;
        log('🔄 Rescan started', 'info');
    });
    
    hooks.addAction('sync.rescan:action:completed', () => {
        syncState.value.isRescan = false;
        isInitialSyncing = false;
        log('✅ Rescan complete', 'success');
    });
    
    // Track conflicts
    hooks.addAction('sync.conflict:action:detected', (conflict: any) => {
        stats.value.totalConflicts++;
        
        const suppressed = isInitialSyncing;
        if (suppressed) {
            stats.value.suppressedConflicts++;
        }
        
        conflictLog.value.unshift({
            time: new Date().toLocaleTimeString(),
            tableName: conflict.tableName,
            pk: conflict.pk?.slice(0, 20) ?? 'unknown',
            winner: conflict.winner,
            localClock: conflict.local?.clock ?? 0,
            remoteClock: conflict.remote?.clock ?? 0,
            suppressed,
        });
        
        // Keep log manageable
        if (conflictLog.value.length > 50) {
            conflictLog.value.pop();
        }
        
        log(
            `⚠️ Conflict: ${conflict.tableName}/${conflict.pk?.slice(0, 10)} (${suppressed ? 'SUPPRESSED' : 'NOTIFIED'})`,
            suppressed ? 'warning' : 'error'
        );
    });
    
    // Track notifications
    hooks.addAction('notification:action:created', (notification: any) => {
        stats.value.notifications++;
        
        notificationLog.value.unshift({
            time: new Date().toLocaleTimeString(),
            type: notification.type,
            title: notification.title,
            body: notification.body,
        });
        
        if (notificationLog.value.length > 20) {
            notificationLog.value.pop();
        }
    });
    
    // Track subscription status
    hooks.addAction('sync.subscription:action:status', (payload: unknown) => {
        const status = (payload as { status?: string })?.status || 'unknown';
        syncState.value.subscriptionStatus = status;
        log(`📡 Subscription status: ${status}`, 'info');
    });
    
    // Track errors
    hooks.addAction('sync:action:error', (error: any) => {
        syncState.value.lastError = error?.message || String(error);
        log(`❌ Sync error: ${error?.message || error}`, 'error');
    });
}

// ----- Logging -----
const eventLog = ref<Array<{ time: string; message: string; status: 'info' | 'success' | 'warning' | 'error' }>>([]);

function log(message: string, status: 'info' | 'success' | 'warning' | 'error' = 'info') {
    eventLog.value.unshift({
        time: new Date().toLocaleTimeString(),
        message,
        status,
    });
    
    if (eventLog.value.length > 100) {
        eventLog.value.pop();
    }
}

// ----- Refresh -----
async function refreshStats() {
    const db = getDb();
    
    stats.value.pendingOps = await db.pending_ops.count();
    
    const cursorEntry = await db.kv.get('kv:sync_cursor');
    stats.value.cursor = cursorEntry ? Number(cursorEntry.value) || 0 : 0;
    
    activeWorkspace.value = getActiveWorkspaceId();
}

// ----- Manual Trigger -----
async function triggerConflict() {
    const db = getDb();
    const id = `conflict-test-${Date.now()}`;
    const timestamp = nowSec();
    
    // Create a thread
    await db.threads.put({
        id,
        title: 'Conflict Test Thread',
        status: 'ready',
        deleted: false,
        pinned: false,
        forked: false,
        created_at: timestamp,
        updated_at: timestamp,
        clock: 1,
    });
    
    // Immediately update it with a lower clock (simulates receiving stale remote data)
    await db.threads.put({
        id,
        title: 'Conflict Test Thread (updated)',
        status: 'ready',
        deleted: false,
        pinned: false,
        forked: false,
        created_at: timestamp,
        updated_at: timestamp + 1,
        clock: 2,
    });
    
    log(`Created conflict test: ${id}`, 'info');
    await refreshStats();
}

async function clearNotifications() {
    const db = getDb();
    await db.notifications.clear();
    notificationLog.value = [];
    stats.value.notifications = 0;
    log('🧹 Cleared all notifications', 'warning');
}

async function clearConflictLog() {
    conflictLog.value = [];
    stats.value.totalConflicts = 0;
    stats.value.suppressedConflicts = 0;
    log('🧹 Cleared conflict log', 'warning');
}

async function resetCursor() {
    const db = getDb();
    await db.kv.delete('kv:sync_cursor');
    log('🔄 Reset sync cursor to 0 - next load will trigger full bootstrap', 'warning');
    await refreshStats();
}

// ----- Initialize -----
onMounted(async () => {
    setupHookListeners();
    
    const bridge = getHookBridge(getDb());
    bridge.start();
    
    await refreshStats();
    log('🚀 Sync Conflict Debug page loaded', 'info');
    log(`Current cursor: ${stats.value.cursor}`, 'info');
    log(`Active workspace: ${activeWorkspace.value}`, 'info');
});
</script>

<template>
    <div class="test-wrapper">
        <div class="test-page">
            <h1>🔍 Sync Conflict Debug</h1>
            <p class="subtitle">Diagnose sync conflict notifications on first load</p>

            <!-- Sync Status -->
            <div class="status-grid">
                <div class="status-card" :class="{ active: syncState.isBootstrapping }">
                    <span class="status-icon">📥</span>
                    <span class="status-label">Bootstrap</span>
                    <span class="status-value">{{ syncState.isBootstrapping ? 'RUNNING' : 'Idle' }}</span>
                </div>
                <div class="status-card" :class="{ active: syncState.isRescan }">
                    <span class="status-icon">🔄</span>
                    <span class="status-label">Rescan</span>
                    <span class="status-value">{{ syncState.isRescan ? 'RUNNING' : 'Idle' }}</span>
                </div>
                <div class="status-card">
                    <span class="status-icon">📡</span>
                    <span class="status-label">Subscription</span>
                    <span class="status-value">{{ syncState.subscriptionStatus }}</span>
                </div>
                <div class="status-card">
                    <span class="status-icon">📍</span>
                    <span class="status-label">Cursor</span>
                    <span class="status-value">{{ stats.cursor }}</span>
                </div>
            </div>

            <!-- Stats -->
            <div class="card">
                <h2>📊 Conflict Statistics</h2>
                <div class="stats-grid">
                    <div class="stat">
                        <span class="stat-value">{{ stats.totalConflicts }}</span>
                        <span class="stat-label">Total Conflicts</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">{{ stats.suppressedConflicts }}</span>
                        <span class="stat-label">Suppressed</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">{{ stats.totalConflicts - stats.suppressedConflicts }}</span>
                        <span class="stat-label">Notified</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">{{ stats.notifications }}</span>
                        <span class="stat-label">Notifications</span>
                    </div>
                </div>
            </div>

            <!-- Controls -->
            <div class="card">
                <h2>🎮 Debug Controls</h2>
                <div class="controls">
                    <button class="btn" @click="refreshStats">🔄 Refresh</button>
                    <button class="btn btn-warning" @click="triggerConflict">⚡ Trigger Conflict</button>
                    <button class="btn btn-danger" @click="clearNotifications">🧹 Clear Notifications</button>
                    <button class="btn btn-danger" @click="clearConflictLog">🧹 Clear Conflict Log</button>
                    <button class="btn btn-danger" @click="resetCursor">🔄 Reset Cursor</button>
                </div>
                <p class="help">Reset cursor to 0 will trigger a full bootstrap on next page load, which may generate conflicts.</p>
            </div>

            <!-- Conflict Log -->
            <div class="card">
                <h2>⚠️ Conflict Log ({{ conflictLog.length }})</h2>
                <div class="conflict-log" v-if="conflictLog.length > 0">
                    <div 
                        v-for="(conflict, i) in conflictLog" 
                        :key="i"
                        class="conflict-item"
                        :class="{ suppressed: conflict.suppressed }"
                    >
                        <span class="conflict-time">{{ conflict.time }}</span>
                        <span class="conflict-table">{{ conflict.tableName }}</span>
                        <span class="conflict-pk">{{ conflict.pk }}</span>
                        <span class="conflict-clocks">L:{{ conflict.localClock }} R:{{ conflict.remoteClock }}</span>
                        <span class="conflict-winner">{{ conflict.winner }}</span>
                        <span class="conflict-status">{{ conflict.suppressed ? '🔇 Suppressed' : '🔔 Notified' }}</span>
                    </div>
                </div>
                <div v-else class="empty-state">No conflicts detected yet.</div>
            </div>

            <!-- Notification Log -->
            <div class="card">
                <h2>🔔 Notification Log ({{ notificationLog.length }})</h2>
                <div class="notification-log" v-if="notificationLog.length > 0">
                    <div v-for="(notif, i) in notificationLog" :key="i" class="notif-item">
                        <span class="notif-time">{{ notif.time }}</span>
                        <span class="notif-type">{{ notif.type }}</span>
                        <span class="notif-title">{{ notif.title }}</span>
                        <span class="notif-body">{{ notif.body }}</span>
                    </div>
                </div>
                <div v-else class="empty-state">No notifications created during this session.</div>
            </div>

            <!-- Event Log -->
            <div class="card">
                <h2>📋 Event Log</h2>
                <div class="log">
                    <div 
                        v-for="(entry, i) in eventLog" 
                        :key="i" 
                        class="log-entry"
                        :class="entry.status"
                    >
                        <span class="log-time">{{ entry.time }}</span>
                        <span class="log-message">{{ entry.message }}</span>
                    </div>
                </div>
            </div>

            <!-- Explanation -->
            <div class="card explanation">
                <h2>💡 How Conflict Suppression Works</h2>
                <p>The notification listener plugin tracks <code>isInitialSyncing</code> state:</p>
                <ul>
                    <li><strong>Bootstrap phase:</strong> When cursor is 0, all data is pulled. Conflicts during this phase are <em>suppressed</em>.</li>
                    <li><strong>Rescan phase:</strong> When cursor is expired, data is re-synced. Conflicts are also <em>suppressed</em>.</li>
                    <li><strong>Normal operation:</strong> After bootstrap/rescan completes, conflicts generate notifications.</li>
                </ul>
                <p><strong>If you see conflict notifications on first load:</strong></p>
                <ul>
                    <li>The bootstrap may have completed before all data was processed.</li>
                    <li>The <code>sync.bootstrap:action:complete</code> hook may fire too early.</li>
                    <li>The <code>isInitialSyncing</code> flag may not be set correctly.</li>
                </ul>
            </div>

            <!-- Navigation -->
            <div class="nav-links">
                <NuxtLink to="/" class="link">← Home</NuxtLink>
                <NuxtLink to="/_tests/_test-sync-e2e" class="link">Sync E2E →</NuxtLink>
                <NuxtLink to="/_tests/_test-workspace-sync" class="link">Workspace Sync →</NuxtLink>
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
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, sans-serif;
}

h1 { margin-bottom: 0.5rem; color: #f8fafc; }
h2 { margin: 0 0 1rem; font-size: 1.1rem; color: #94a3b8; }
.subtitle { color: #64748b; margin-bottom: 2rem; }

.status-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
}
.status-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem;
    background: #1e293b;
    border: 2px solid #334155;
    border-radius: 12px;
    transition: all 0.2s;
}
.status-card.active {
    border-color: #22c55e;
    background: linear-gradient(135deg, #14532d 0%, #166534 100%);
    animation: pulse 2s infinite;
}
@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
}
.status-icon { font-size: 2rem; margin-bottom: 0.5rem; }
.status-label { font-size: 0.75rem; color: #64748b; }
.status-value { font-weight: 600; }

.card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}

.controls { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.help { color: #64748b; font-size: 0.875rem; margin-top: 1rem; }

.btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
}
.btn:hover { background: #2563eb; }
.btn-warning { background: #f59e0b; }
.btn-warning:hover { background: #d97706; }
.btn-danger { background: #ef4444; }
.btn-danger:hover { background: #dc2626; }

.stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
}
.stat {
    background: #0f172a;
    padding: 1rem;
    border-radius: 8px;
    text-align: center;
}
.stat-value { display: block; font-size: 2rem; font-weight: 700; color: #3b82f6; }
.stat-label { font-size: 0.75rem; color: #64748b; }

.conflict-log, .notification-log {
    max-height: 250px;
    overflow-y: auto;
}
.conflict-item, .notif-item {
    display: grid;
    grid-template-columns: 80px 100px 150px 100px 80px 120px;
    gap: 0.5rem;
    padding: 0.5rem;
    border-bottom: 1px solid #334155;
    font-size: 0.8rem;
    align-items: center;
}
.conflict-item.suppressed { opacity: 0.6; }
.notif-item {
    grid-template-columns: 80px 150px 200px 1fr;
}
.conflict-time, .notif-time { font-family: monospace; color: #64748b; }
.conflict-table, .notif-type { color: #3b82f6; font-weight: 500; }
.conflict-pk { font-family: monospace; }
.conflict-clocks { color: #f59e0b; }
.conflict-winner { color: #22c55e; }
.conflict-status { text-align: right; }

.log {
    max-height: 200px;
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
    font-size: 0.85rem;
}
.log-entry.success { color: #22c55e; }
.log-entry.warning { color: #f59e0b; }
.log-entry.error { color: #ef4444; }
.log-time { font-family: monospace; font-size: 0.75rem; color: #64748b; min-width: 70px; }
.log-message { flex: 1; }

.empty-state { color: #64748b; text-align: center; padding: 2rem; }

.explanation {
    background: #1e3a5f;
    border-color: #3b82f6;
}
.explanation p { margin: 0.5rem 0; }
.explanation ul { margin: 0.5rem 0; padding-left: 1.5rem; }
.explanation li { margin: 0.25rem 0; }
.explanation code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.85rem; }

.nav-links { display: flex; gap: 1rem; justify-content: center; margin-top: 2rem; }
.link { color: #3b82f6; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
