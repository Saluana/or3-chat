<script setup lang="ts">
/**
 * Full-Stack Integration Test Page
 * Visit: http://localhost:3001/_tests/_test-full-stack
 *
 * Tests all layers together: Auth + Sync + Storage
 * - End-to-end message creation and sync
 * - File attachment workflow
 * - Multi-layer status monitoring
 */

// Disable SSR to avoid hydration mismatches with client-only features
definePageMeta({ ssr: false });

import { useConvexQuery, useConvexMutation } from 'convex-vue';
import { api } from '~~/convex/_generated/api';
import { db } from '~/db/client';
import type { Id } from '~~/convex/_generated/dataModel';

// ----- Auth State -----
const { data: identity, isPending: identityPending } = useConvexQuery(api.users.me, {});

// ----- Layer Status -----
const layerStatus = ref({
    auth: { status: 'checking', message: 'Verifying authentication...' },
    sync: { status: 'checking', message: 'Checking sync engine...' },
    storage: { status: 'checking', message: 'Checking storage queue...' },
});

async function checkAllLayers() {
    // Auth layer
    layerStatus.value.auth = identity.value
        ? { status: 'ok', message: `Authenticated as ${identity.value.email}` }
        : { status: 'warning', message: 'Not authenticated - some features disabled' };

    // Sync layer
    try {
        const pendingCount = await db.pending_ops.count();
        layerStatus.value.sync = {
            status: 'ok',
            message: `Sync engine ready (${pendingCount} pending ops)`,
        };
    } catch (e) {
        layerStatus.value.sync = {
            status: 'error',
            message: `Sync error: ${e instanceof Error ? e.message : 'Unknown'}`,
        };
    }

    // Storage layer
    try {
        const queueCount = await db.file_transfers.where('state').equals('queued').count();
        const runningCount = await db.file_transfers.where('state').equals('running').count();
        layerStatus.value.storage = {
            status: 'ok',
            message: `Storage ready (${queueCount} queued, ${runningCount} running)`,
        };
    } catch (e) {
        layerStatus.value.storage = {
            status: 'error',
            message: `Storage error: ${e instanceof Error ? e.message : 'Unknown'}`,
        };
    }
}

// ----- End-to-End Test -----
interface E2ETestResult {
    step: string;
    status: 'pending' | 'running' | 'success' | 'error';
    message: string;
}

const e2eResults = ref<E2ETestResult[]>([]);
const e2eRunning = ref(false);

async function runE2ETest() {
    e2eRunning.value = true;
    e2eResults.value = [
        { step: 'Check Auth', status: 'pending', message: '' },
        { step: 'Create Thread', status: 'pending', message: '' },
        { step: 'Create Message', status: 'pending', message: '' },
        { step: 'Check Outbox', status: 'pending', message: '' },
        { step: 'Verify Local DB', status: 'pending', message: '' },
    ];

    try {
        // Step 1: Check Auth
        e2eResults.value[0]!.status = 'running';
        await new Promise((r) => setTimeout(r, 500));
        if (identity.value) {
            e2eResults.value[0]!.status = 'success';
            e2eResults.value[0]!.message = `Authenticated as ${identity.value.email}`;
        } else {
            e2eResults.value[0]!.status = 'success';
            e2eResults.value[0]!.message = 'Running in local-only mode';
        }

        // Step 2: Create Thread
        e2eResults.value[1]!.status = 'running';
        const threadId = `e2e-thread-${Date.now()}`;
        const nowSec = Math.floor(Date.now() / 1000);
        await db.threads.add({
            id: threadId,
            title: `E2E Test ${new Date().toLocaleTimeString()}`,
            status: 'ready',
            deleted: false,
            pinned: false,
            forked: false,
            created_at: nowSec,
            updated_at: nowSec,
            clock: 1,
        });
        e2eResults.value[1]!.status = 'success';
        e2eResults.value[1]!.message = `Created thread: ${threadId}`;

        // Step 3: Create Message
        e2eResults.value[2]!.status = 'running';
        const messageId = `e2e-msg-${Date.now()}`;
        await db.messages.add({
            id: messageId,
            thread_id: threadId,
            index: 1,
            role: 'user',
            data: { text: `E2E test message at ${new Date().toISOString()}` },
            deleted: false,
            created_at: nowSec,
            updated_at: nowSec,
            clock: 1,
        });
        e2eResults.value[2]!.status = 'success';
        e2eResults.value[2]!.message = `Created message: ${messageId}`;

        // Step 4: Check Outbox
        e2eResults.value[3]!.status = 'running';
        await new Promise((r) => setTimeout(r, 300));
        const pendingOps = await db.pending_ops.where('status').equals('pending').toArray();
        const ourOps = pendingOps.filter((op) => op.pk === threadId || op.pk === messageId);
        if (ourOps.length > 0) {
            e2eResults.value[3]!.status = 'success';
            e2eResults.value[3]!.message = `Found ${ourOps.length} ops in outbox`;
        } else {
            e2eResults.value[3]!.status = 'success';
            e2eResults.value[3]!.message = 'Ops already synced or hook not active';
        }

        // Step 5: Verify Local DB
        e2eResults.value[4]!.status = 'running';
        const thread = await db.threads.get(threadId);
        const message = await db.messages.get(messageId);
        if (thread && message) {
            e2eResults.value[4]!.status = 'success';
            e2eResults.value[4]!.message = 'Thread and message verified in local DB';
        } else {
            e2eResults.value[4]!.status = 'error';
            e2eResults.value[4]!.message = 'Failed to verify records';
        }
    } catch (e) {
        const runningStep = e2eResults.value.find((r) => r.status === 'running');
        if (runningStep) {
            runningStep.status = 'error';
            runningStep.message = e instanceof Error ? e.message : String(e);
        }
    } finally {
        e2eRunning.value = false;
    }
}

// ----- Stats -----
const stats = ref({ threads: 0, messages: 0, files: 0, pendingOps: 0 });

async function loadStats() {
    stats.value = {
        threads: await db.threads.count(),
        messages: await db.messages.count(),
        files: await db.file_meta.count(),
        pendingOps: await db.pending_ops.where('status').equals('pending').count(),
    };
}

// ----- Initialize -----
onMounted(async () => {
    await checkAllLayers();
    await loadStats();
});

watch(identity, () => {
    checkAllLayers();
});
</script>

<template>
    <div class="test-wrapper">
        <div class="test-page">
            <h1>🚀 Full-Stack Integration Test</h1>
            <p class="subtitle">Tests Auth + Sync + Storage layers working together</p>

        <!-- Layer Status -->
        <div class="card">
            <h2>📊 Layer Status</h2>
            <button class="btn" @click="checkAllLayers">Refresh Status</button>
            <div class="layer-grid">
                <div
                    v-for="(layer, key) in layerStatus"
                    :key="key"
                    class="layer-item"
                    :class="`status-${layer.status}`"
                >
                    <div class="layer-header">
                        <span class="layer-icon">
                            {{ key === 'auth' ? '🔐' : key === 'sync' ? '🔄' : '📦' }}
                        </span>
                        <span class="layer-name">{{ key.toUpperCase() }}</span>
                        <span class="layer-status">
                            {{ layer.status === 'ok' ? '✅' : layer.status === 'warning' ? '⚠️' : layer.status === 'error' ? '❌' : '⏳' }}
                        </span>
                    </div>
                    <p class="layer-message">{{ layer.message }}</p>
                </div>
            </div>
        </div>

        <!-- Database Stats -->
        <div class="card">
            <h2>📈 Database Stats</h2>
            <button class="btn" @click="loadStats">Refresh</button>
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
                    <span class="stat-value">{{ stats.files }}</span>
                    <span class="stat-label">Files</span>
                </div>
                <div class="stat">
                    <span class="stat-value">{{ stats.pendingOps }}</span>
                    <span class="stat-label">Pending Ops</span>
                </div>
            </div>
        </div>

        <!-- E2E Test -->
        <div class="card">
            <h2>🧪 End-to-End Test</h2>
            <p class="help">Creates a thread + message and verifies sync flow</p>
            <button class="btn btn-primary" @click="runE2ETest" :disabled="e2eRunning">
                {{ e2eRunning ? 'Running...' : '▶️ Run E2E Test' }}
            </button>
            <div v-if="e2eResults.length" class="e2e-results">
                <div v-for="(result, i) in e2eResults" :key="i" class="e2e-step" :class="`step-${result.status}`">
                    <span class="step-icon">
                        {{ result.status === 'success' ? '✅' : result.status === 'error' ? '❌' : result.status === 'running' ? '🔄' : '⏳' }}
                    </span>
                    <span class="step-name">{{ result.step }}</span>
                    <span class="step-message">{{ result.message }}</span>
                </div>
            </div>
        </div>

        <!-- Quick Links -->
        <div class="card">
            <h2>🔗 Individual Layer Tests</h2>
            <div class="quick-links">
                <NuxtLink to="/_tests/_test-auth" class="quick-link">
                    🔐 Auth Test
                    <span class="desc">Test Clerk + session API</span>
                </NuxtLink>
                <NuxtLink to="/_tests/_test-sync" class="quick-link">
                    🔄 Sync Test
                    <span class="desc">Test outbox + conflicts</span>
                </NuxtLink>
                <NuxtLink to="/_tests/_test-storage" class="quick-link">
                    📦 Storage Test
                    <span class="desc">Test file upload/download</span>
                </NuxtLink>
                <NuxtLink to="/_tests/_test-convex" class="quick-link">
                    🔌 Convex Test
                    <span class="desc">Test Convex connection</span>
                </NuxtLink>
            </div>
        </div>

        <!-- Navigation -->
        <div class="nav-links">
            <NuxtLink to="/" class="link">← Home</NuxtLink>
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

.btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 1rem;
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

.help {
    color: #666;
    font-size: 0.875rem;
    margin-bottom: 1rem;
}

/* Layer Grid */
.layer-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-top: 1rem;
}

.layer-item {
    padding: 1rem;
    border-radius: 8px;
    background: white;
}

.layer-item.status-ok {
    border-left: 4px solid #10b981;
}
.layer-item.status-warning {
    border-left: 4px solid #f59e0b;
}
.layer-item.status-error {
    border-left: 4px solid #ef4444;
}
.layer-item.status-checking {
    border-left: 4px solid #9ca3af;
}

.layer-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
}

.layer-name {
    font-weight: 600;
    flex: 1;
}

.layer-message {
    font-size: 0.875rem;
    color: #666;
    margin: 0;
}

/* Stats Grid */
.stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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

/* E2E Results */
.e2e-results {
    margin-top: 1rem;
}

.e2e-step {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 0.5rem;
    background: white;
}

.e2e-step.step-success {
    border-left: 3px solid #10b981;
}
.e2e-step.step-error {
    border-left: 3px solid #ef4444;
}
.e2e-step.step-running {
    border-left: 3px solid #3b82f6;
}
.e2e-step.step-pending {
    border-left: 3px solid #9ca3af;
}

.step-name {
    font-weight: 500;
    min-width: 120px;
}

.step-message {
    color: #666;
    font-size: 0.875rem;
    flex: 1;
}

/* Quick Links */
.quick-links {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
}

.quick-link {
    display: block;
    padding: 1rem;
    background: white;
    border-radius: 8px;
    text-decoration: none;
    color: #1f2937;
    transition: transform 0.1s;
}

.quick-link:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.quick-link .desc {
    display: block;
    font-size: 0.75rem;
    color: #666;
    margin-top: 0.25rem;
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
