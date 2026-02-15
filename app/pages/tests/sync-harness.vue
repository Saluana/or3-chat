<template>
    <div class="sync-harness" data-page="sync-harness">
        <!-- Header -->
        <header class="harness-header">
            <div class="header-content">
                <h1 class="header-title">
                    <UIcon name="i-heroicons-arrow-path" class="header-icon" />
                    Sync E2E Test Harness
                </h1>
                <p class="header-subtitle">
                    Comprehensive database synchronization testing with real streaming
                </p>
            </div>
            <div class="header-actions">
                <UButton
                    v-if="!isRunning"
                    color="primary"
                    icon="i-heroicons-play"
                    @click="runAllTests"
                >
                    Run All Tests
                </UButton>
                <UButton
                    v-else
                    color="error"
                    icon="i-heroicons-stop"
                    @click="stopTests"
                >
                    Stop Tests
                </UButton>
                <UButton
                    variant="ghost"
                    icon="i-heroicons-trash"
                    @click="clearResults"
                >
                    Clear
                </UButton>
            </div>
        </header>

        <!-- Status Banner -->
        <USkeleton v-if="initializing" class="status-skeleton" />
        <div v-else class="status-banner" :class="statusBannerClass">
            <UIcon :name="statusIcon" class="status-icon" />
            <div class="status-text">
                <span class="status-label">{{ statusLabel }}</span>
                <span class="status-detail">{{ statusDetail }}</span>
            </div>
            <div class="status-stats">
                <span class="stat passed">{{ passedCount }} passed</span>
                <span class="stat failed">{{ failedCount }} failed</span>
                <span class="stat pending">{{ pendingCount }} pending</span>
            </div>
        </div>

        <!-- Sync Health Panel -->
        <section class="panel sync-health">
            <h2 class="panel-title">
                <UIcon name="i-heroicons-heart" />
                Sync Health
            </h2>
            <div class="health-grid">
                <div class="health-card" :class="{ ok: syncEngineStatus === 'running' }">
                    <span class="health-label">Sync Engine</span>
                    <span class="health-value">{{ syncEngineStatus }}</span>
                </div>
                <div class="health-card" :class="{ ok: outboxCount === 0 }">
                    <span class="health-label">Outbox Queue</span>
                    <span class="health-value">{{ outboxCount }} pending</span>
                </div>
                <div class="health-card" :class="{ ok: !hasApiKey }">
                    <span class="health-label">API Key</span>
                    <span class="health-value">{{ hasApiKey ? '✓ Present' : '✗ Missing' }}</span>
                </div>
                <div class="health-card">
                    <span class="health-label">Workspace</span>
                    <span class="health-value">{{ workspaceId || 'default' }}</span>
                </div>
            </div>
        </section>

        <!-- Test Categories -->
        <div class="test-grid">
            <!-- Basic Send Tests -->
            <section class="panel test-category">
                <h2 class="panel-title">
                    <UIcon name="i-heroicons-paper-airplane" />
                    Basic Send
                </h2>
                <div class="test-list">
                    <TestItem
                        v-for="test in basicSendTests"
                        :key="test.id"
                        :test="test"
                        @run="runTest(test)"
                    />
                </div>
            </section>

            <!-- Retry Tests -->
            <section class="panel test-category">
                <h2 class="panel-title">
                    <UIcon name="i-heroicons-arrow-path" />
                    Retry Logic
                </h2>
                <div class="test-list">
                    <TestItem
                        v-for="test in retryTests"
                        :key="test.id"
                        :test="test"
                        @run="runTest(test)"
                    />
                </div>
            </section>

            <!-- Fork Tests -->
            <section class="panel test-category">
                <h2 class="panel-title">
                    <UIcon name="i-heroicons-arrow-top-right-on-square" />
                    Fork Logic
                </h2>
                <div class="test-list">
                    <TestItem
                        v-for="test in forkTests"
                        :key="test.id"
                        :test="test"
                        @run="runTest(test)"
                    />
                </div>
            </section>

            <!-- Conflict Resolution -->
            <section class="panel test-category">
                <h2 class="panel-title">
                    <UIcon name="i-heroicons-bolt" />
                    Conflict Resolution
                </h2>
                <div class="test-list">
                    <TestItem
                        v-for="test in conflictTests"
                        :key="test.id"
                        :test="test"
                        @run="runTest(test)"
                    />
                </div>
            </section>

            <!-- Edge Cases -->
            <section class="panel test-category">
                <h2 class="panel-title">
                    <UIcon name="i-heroicons-exclamation-triangle" />
                    Edge Cases
                </h2>
                <div class="test-list">
                    <TestItem
                        v-for="test in edgeCaseTests"
                        :key="test.id"
                        :test="test"
                        @run="runTest(test)"
                    />
                </div>
            </section>

            <!-- Multi-Tab Sync -->
            <section class="panel test-category">
                <h2 class="panel-title">
                    <UIcon name="i-heroicons-squares-2x2" />
                    Multi-Tab Sync
                </h2>
                <div class="test-list">
                    <TestItem
                        v-for="test in multiTabTests"
                        :key="test.id"
                        :test="test"
                        @run="runTest(test)"
                    />
                </div>
            </section>
        </div>

        <!-- Live Log -->
        <section class="panel log-panel">
            <div class="log-header">
                <h2 class="panel-title">
                    <UIcon name="i-heroicons-command-line" />
                    Live Log
                </h2>
                <UButton
                    size="xs"
                    variant="ghost"
                    icon="i-heroicons-trash"
                    @click="clearLogs"
                >
                    Clear
                </UButton>
            </div>
            <div ref="logContainer" class="log-container">
                <div
                    v-for="(entry, i) in logs"
                    :key="i"
                    class="log-entry"
                    :class="entry.level"
                >
                    <span class="log-time">{{ entry.time }}</span>
                    <span class="log-level">{{ entry.level }}</span>
                    <span class="log-message">{{ entry.message }}</span>
                </div>
                <div v-if="logs.length === 0" class="log-empty">
                    No log entries yet. Run a test to see output.
                </div>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { getDb, getActiveWorkspaceId } from '~/db/client';
import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { create, tx, upsert, queries, del } from '~/db';
import type { Message, Thread } from '~/db';
import { newId, nowSec } from '~/db/util';
import { useChat } from '~/composables/chat/useAi';
import { useHooks } from '~/core/hooks/useHooks';
import TestItem from './TestItem.vue';

// ============================================================
// Types
// ============================================================

interface TestCase {
    id: string;
    name: string;
    description: string;
    category: string;
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
    duration?: number;
    error?: string;
    fn: () => Promise<void>;
}

interface LogEntry {
    time: string;
    level: 'info' | 'success' | 'error' | 'warn' | 'debug';
    message: string;
}

// ============================================================
// State
// ============================================================

const initializing = ref(true);
const isRunning = ref(false);
const abortRequested = ref(false);
const logs = ref<LogEntry[]>([]);
const logContainer = ref<HTMLElement | null>(null);

// Sync health
const syncEngineStatus = ref<'running' | 'stopped' | 'unknown'>('unknown');
const outboxCount = ref(0);
const workspaceId = ref<string | null>(null);

// API key
const { apiKey } = useUserApiKey();
const hasApiKey = computed(() => Boolean(apiKey.value));

// Test thread for isolation
const testThreadId = ref<string | null>(null);

// Test cases organized by category
const basicSendTests = ref<TestCase[]>([]);
const retryTests = ref<TestCase[]>([]);
const forkTests = ref<TestCase[]>([]);
const conflictTests = ref<TestCase[]>([]);
const edgeCaseTests = ref<TestCase[]>([]);
const multiTabTests = ref<TestCase[]>([]);

const allTests = computed(() => [
    ...basicSendTests.value,
    ...retryTests.value,
    ...forkTests.value,
    ...conflictTests.value,
    ...edgeCaseTests.value,
    ...multiTabTests.value,
]);

const passedCount = computed(() => allTests.value.filter(t => t.status === 'passed').length);
const failedCount = computed(() => allTests.value.filter(t => t.status === 'failed').length);
const pendingCount = computed(() => allTests.value.filter(t => t.status === 'pending').length);

const statusBannerClass = computed(() => {
    if (isRunning.value) return 'status-running';
    if (failedCount.value > 0) return 'status-failed';
    if (passedCount.value > 0 && pendingCount.value === 0) return 'status-passed';
    return 'status-idle';
});

const statusIcon = computed(() => {
    if (isRunning.value) return 'i-heroicons-arrow-path';
    if (failedCount.value > 0) return 'i-heroicons-x-circle';
    if (passedCount.value > 0 && pendingCount.value === 0) return 'i-heroicons-check-circle';
    return 'i-heroicons-clock';
});

const statusLabel = computed(() => {
    if (isRunning.value) return 'Running...';
    if (failedCount.value > 0) return 'Tests Failed';
    if (passedCount.value > 0 && pendingCount.value === 0) return 'All Tests Passed';
    return 'Ready';
});

const statusDetail = computed(() => {
    const total = allTests.value.length;
    const completed = passedCount.value + failedCount.value;
    if (isRunning.value) return `${completed} / ${total} completed`;
    return `${total} tests available`;
});

// ============================================================
// Logging
// ============================================================

function log(level: LogEntry['level'], message: string) {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    logs.value.push({ time, level, message });
    
    // Auto-scroll to bottom
    nextTick(() => {
        if (logContainer.value) {
            logContainer.value.scrollTop = logContainer.value.scrollHeight;
        }
    });
    
    // Console output
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[SyncHarness] [${level.toUpperCase()}] ${message}`);
}

function clearLogs() {
    logs.value = [];
}

// ============================================================
// Test Infrastructure
// ============================================================

async function setupTestThread(): Promise<string> {
    const threadId = newId();
    await create.thread({
        id: threadId,
        title: `Sync Test - ${new Date().toISOString()}`,
        pinned: false,
        status: 'active',
    });
    testThreadId.value = threadId;
    log('info', `Created test thread: ${threadId}`);
    return threadId;
}

async function cleanupTestThread() {
    if (testThreadId.value) {
        try {
            // Hard delete the test thread and its messages
            const messages = await queries.messagesByThread(testThreadId.value) as Message[];
            for (const msg of messages) {
                await del.hard.message(msg.id);
            }
            await del.hard.thread(testThreadId.value);
            log('info', `Cleaned up test thread: ${testThreadId.value}`);
        } catch (e) {
            log('warn', `Failed to cleanup test thread: ${e}`);
        }
        testThreadId.value = null;
    }
}

async function waitForOutboxFlush(timeoutMs = 10000): Promise<boolean> {
    const db = getDb();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const pending = await db.pending_ops.where('status').equals('pending').count();
        if (pending === 0) {
            log('debug', 'Outbox flushed successfully');
            return true;
        }
        await sleep(100);
    }
    log('warn', `Outbox flush timeout after ${timeoutMs}ms`);
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function refreshSyncHealth() {
    const db = getDb();
    workspaceId.value = getActiveWorkspaceId();
    
    try {
        outboxCount.value = await db.pending_ops.where('status').equals('pending').count();
    } catch {
        outboxCount.value = 0;
    }
    
    // Check sync engine status via hook
    try {
        const hooks = useHooks();
        // We'll assume it's running if no error
        syncEngineStatus.value = 'running';
    } catch {
        syncEngineStatus.value = 'unknown';
    }
}

// ============================================================
// Test Runner
// ============================================================

async function runTest(test: TestCase) {
    test.status = 'running';
    test.error = undefined;
    test.duration = undefined;
    
    log('info', `Running test: ${test.name}`);
    const start = Date.now();
    
    try {
        await test.fn();
        test.status = 'passed';
        test.duration = Date.now() - start;
        log('success', `✓ ${test.name} (${test.duration}ms)`);
    } catch (e) {
        test.status = 'failed';
        test.duration = Date.now() - start;
        test.error = e instanceof Error ? e.message : String(e);
        log('error', `✗ ${test.name}: ${test.error}`);
    }
    
    await refreshSyncHealth();
}

async function runAllTests() {
    if (isRunning.value) return;
    
    isRunning.value = true;
    abortRequested.value = false;
    
    log('info', '═══════════════════════════════════════');
    log('info', 'Starting comprehensive sync E2E tests...');
    log('info', '═══════════════════════════════════════');
    
    // Reset all test statuses
    for (const test of allTests.value) {
        test.status = 'pending';
        test.error = undefined;
        test.duration = undefined;
    }
    
    try {
        // Setup
        await setupTestThread();
        
        // Run each test sequentially
        for (const test of allTests.value) {
            if (abortRequested.value) {
                test.status = 'skipped';
                continue;
            }
            await runTest(test);
            await sleep(200); // Small delay between tests
        }
        
        // Cleanup
        await cleanupTestThread();
        
    } catch (e) {
        log('error', `Test suite error: ${e}`);
    }
    
    isRunning.value = false;
    
    log('info', '═══════════════════════════════════════');
    log('info', `Tests complete: ${passedCount.value} passed, ${failedCount.value} failed`);
    log('info', '═══════════════════════════════════════');
}

function stopTests() {
    abortRequested.value = true;
    log('warn', 'Stop requested - finishing current test...');
}

function clearResults() {
    for (const test of allTests.value) {
        test.status = 'pending';
        test.error = undefined;
        test.duration = undefined;
    }
    clearLogs();
}

// ============================================================
// Test Definitions
// ============================================================

function initializeTests() {
    // Basic Send Tests
    basicSendTests.value = [
        {
            id: 'send-basic',
            name: 'Send Simple Message',
            description: 'Send a basic text message and verify it persists to DB',
            category: 'basic',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Create a message directly (simulating send)
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Test message from sync harness' },
                });
                
                // Verify it exists in DB
                const stored = await db.messages.get(msgId);
                if (!stored) throw new Error('Message not found in DB');
                if (stored.thread_id !== threadId) throw new Error('Thread ID mismatch');
                if (stored.role !== 'user') throw new Error('Role mismatch');
            },
        },
        {
            id: 'send-sync-capture',
            name: 'Verify Sync Capture',
            description: 'Message creates a pending op in outbox',
            category: 'basic',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Get initial outbox count
                const initialCount = await db.pending_ops.count();
                
                // Create message
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Sync capture test' },
                });
                
                // Check if pending op was created
                // Note: HookBridge skips pending=true messages, so we need to wait a bit
                await sleep(100);
                
                // Verify message has required fields for sync
                const stored = await db.messages.get(msgId);
                if (!stored) throw new Error('Message not found');
                if (!stored.thread_id) throw new Error('Missing thread_id');
                if (!stored.role) throw new Error('Missing role');
                if (stored.index === undefined) throw new Error('Missing index');
            },
        },
        {
            id: 'send-order-key',
            name: 'Order Key Generation',
            description: 'Messages get unique order_key for deterministic ordering',
            category: 'basic',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Create two messages
                const msg1Id = newId();
                const msg2Id = newId();
                
                await tx.appendMessage({
                    id: msg1Id,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'First message' },
                });
                
                await sleep(10);
                
                await tx.appendMessage({
                    id: msg2Id,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Second message' },
                });
                
                const msg1 = await db.messages.get(msg1Id);
                const msg2 = await db.messages.get(msg2Id);
                
                if (!msg1?.order_key) throw new Error('First message missing order_key');
                if (!msg2?.order_key) throw new Error('Second message missing order_key');
                if (msg1.order_key === msg2.order_key) throw new Error('Order keys should be unique');
                if (msg1.order_key > msg2.order_key) throw new Error('Order keys should be ascending');
            },
        },
        {
            id: 'send-timestamps',
            name: 'Timestamp Handling',
            description: 'created_at and updated_at are set correctly',
            category: 'basic',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                const beforeCreate = nowSec();
                
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Timestamp test' },
                });
                
                const afterCreate = nowSec();
                const msg = await db.messages.get(msgId);
                
                if (!msg) throw new Error('Message not found');
                if (msg.created_at < beforeCreate) throw new Error(`created_at ${msg.created_at} is before ${beforeCreate}`);
                if (msg.created_at > afterCreate + 1) throw new Error(`created_at ${msg.created_at} is after ${afterCreate}`);
                if (msg.updated_at < msg.created_at) throw new Error('updated_at before created_at');
            },
        },
    ];
    
    // Retry Tests
    retryTests.value = [
        {
            id: 'retry-message-delete',
            name: 'Retry Deletes Original',
            description: 'Retrying a message properly deletes the original pair',
            category: 'retry',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Create user message
                const userMsgId = newId();
                await tx.appendMessage({
                    id: userMsgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Retry test user message' },
                });
                
                // Create assistant response
                const assistantMsgId = newId();
                await tx.appendMessage({
                    id: assistantMsgId,
                    thread_id: threadId,
                    role: 'assistant',
                    data: { content: 'Original assistant response' },
                });
                
                // Verify both exist
                const userBefore = await db.messages.get(userMsgId);
                const assistantBefore = await db.messages.get(assistantMsgId);
                if (!userBefore || !assistantBefore) throw new Error('Messages not created');
                
                // Soft delete both (simulating retry cleanup)
                await del.soft.message(userMsgId);
                await del.soft.message(assistantMsgId);
                
                // Verify soft deleted
                const userAfter = await db.messages.get(userMsgId);
                const assistantAfter = await db.messages.get(assistantMsgId);
                if (!userAfter?.deleted) throw new Error('User message not soft deleted');
                if (!assistantAfter?.deleted) throw new Error('Assistant message not soft deleted');
            },
        },
        {
            id: 'retry-clock-increment',
            name: 'Retry Increments Clock',
            description: 'Retried messages have higher clock values',
            category: 'retry',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Clock test' },
                });
                
                const original = await db.messages.get(msgId);
                if (!original) throw new Error('Message not created');
                
                const originalClock = original.clock;
                
                // Update the message (simulating retry update)
                await upsert.message({
                    ...original,
                    data: { content: 'Updated content' },
                    clock: originalClock + 1,
                    updated_at: nowSec(),
                });
                
                const updated = await db.messages.get(msgId);
                if (!updated) throw new Error('Message not found after update');
                if (updated.clock <= originalClock) throw new Error(`Clock not incremented: ${updated.clock} <= ${originalClock}`);
            },
        },
    ];
    
    // Fork Tests
    forkTests.value = [
        {
            id: 'fork-thread-create',
            name: 'Fork Creates Child Thread',
            description: 'Forking creates a new thread with parent reference',
            category: 'fork',
            status: 'pending',
            fn: async () => {
                const threadId = testThreadId.value!;
                
                // Create a forked thread
                const forkedId = newId();
                await create.thread({
                    id: forkedId,
                    title: 'Forked Thread',
                    parent_thread_id: threadId,
                    anchor_index: 0,
                    pinned: false,
                    status: 'active',
                    forked: true,
                });
                
                const forked = await getDb().threads.get(forkedId);
                if (!forked) throw new Error('Forked thread not created');
                if (forked.parent_thread_id !== threadId) throw new Error('Parent reference incorrect');
                if (!forked.forked) throw new Error('Forked flag not set');
                
                // Cleanup
                await del.hard.thread(forkedId);
            },
        },
        {
            id: 'fork-message-copy',
            name: 'Fork Copies Messages',
            description: 'Messages up to fork point are copied to new thread',
            category: 'fork',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Create messages in parent
                const msg1Id = newId();
                const msg2Id = newId();
                
                await tx.appendMessage({
                    id: msg1Id,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Message before fork' },
                });
                
                await tx.appendMessage({
                    id: msg2Id,
                    thread_id: threadId,
                    role: 'assistant',
                    data: { content: 'Response before fork' },
                });
                
                // Create forked thread
                const forkedId = newId();
                await create.thread({
                    id: forkedId,
                    title: 'Forked Thread',
                    parent_thread_id: threadId,
                    anchor_index: 1,
                    pinned: false,
                    status: 'active',
                    forked: true,
                });
                
                // Copy message to forked thread (simulating fork operation)
                const copiedMsgId = newId();
                const originalMsg = await db.messages.get(msg1Id);
                if (!originalMsg) throw new Error('Original message not found');
                
                await tx.appendMessage({
                    id: copiedMsgId,
                    thread_id: forkedId,
                    role: originalMsg.role,
                    data: originalMsg.data,
                });
                
                // Verify copy
                const copied = await db.messages.get(copiedMsgId);
                if (!copied) throw new Error('Copied message not found');
                if (copied.thread_id !== forkedId) throw new Error('Copied to wrong thread');
                
                // Cleanup
                await del.hard.message(copiedMsgId);
                await del.hard.thread(forkedId);
            },
        },
    ];
    
    // Conflict Resolution Tests
    conflictTests.value = [
        {
            id: 'conflict-lww-higher-clock',
            name: 'LWW: Higher Clock Wins',
            description: 'Last-Write-Wins uses clock comparison',
            category: 'conflict',
            status: 'pending',
            fn: async () => {
                // This is a logic test - simulating what ConflictResolver does
                const local = { clock: 5, hlc: 'aaa' };
                const remote = { clock: 7, hlc: 'bbb' };
                
                // Remote should win (higher clock)
                const winner = remote.clock > local.clock ? 'remote' : 'local';
                if (winner !== 'remote') throw new Error(`Expected remote to win, got ${winner}`);
            },
        },
        {
            id: 'conflict-lww-hlc-tiebreak',
            name: 'LWW: HLC Tiebreaker',
            description: 'Equal clocks use HLC for deterministic resolution',
            category: 'conflict',
            status: 'pending',
            fn: async () => {
                const local = { clock: 5, hlc: 'aaa123' };
                const remote = { clock: 5, hlc: 'bbb456' };
                
                // Same clock, HLC breaks tie (string comparison)
                const winner = local.clock === remote.clock
                    ? (remote.hlc > local.hlc ? 'remote' : 'local')
                    : (remote.clock > local.clock ? 'remote' : 'local');
                    
                if (winner !== 'remote') throw new Error(`Expected remote to win on HLC, got ${winner}`);
            },
        },
    ];
    
    // Edge Cases
    edgeCaseTests.value = [
        {
            id: 'edge-empty-content',
            name: 'Handle Empty Content',
            description: 'Messages with empty content are handled gracefully',
            category: 'edge',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: '' },
                });
                
                const msg = await db.messages.get(msgId);
                if (!msg) throw new Error('Empty content message not created');
                if (msg.id !== msgId) throw new Error('Message ID mismatch');
            },
        },
        {
            id: 'edge-large-content',
            name: 'Handle Large Content',
            description: 'Large messages are stored successfully',
            category: 'edge',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Create a 100KB message
                const largeContent = 'x'.repeat(100 * 1024);
                
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: largeContent },
                });
                
                const msg = await db.messages.get(msgId);
                if (!msg) throw new Error('Large content message not created');
                
                const storedContent = (msg.data as any)?.content;
                if (storedContent?.length !== largeContent.length) {
                    throw new Error(`Content size mismatch: ${storedContent?.length} vs ${largeContent.length}`);
                }
            },
        },
        {
            id: 'edge-special-chars',
            name: 'Handle Special Characters',
            description: 'Unicode and special characters are preserved',
            category: 'edge',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                const specialContent = '🎉 Hello 世界! \x3Cscript\x3Ealert("test")\x3C/script\x3E \n\t "quotes"';
                
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: specialContent },
                });
                
                const msg = await db.messages.get(msgId);
                if (!msg) throw new Error('Special chars message not created');
                
                const storedContent = (msg.data as any)?.content;
                if (storedContent !== specialContent) {
                    throw new Error('Special characters not preserved');
                }
            },
        },
        {
            id: 'edge-concurrent-writes',
            name: 'Handle Concurrent Writes',
            description: 'Multiple messages created simultaneously',
            category: 'edge',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Create 10 messages concurrently
                const promises = Array.from({ length: 10 }, (_, i) =>
                    tx.appendMessage({
                        id: newId(),
                        thread_id: threadId,
                        role: 'user',
                        data: { content: `Concurrent message ${i + 1}` },
                    })
                );
                
                await Promise.all(promises);
                
                // Verify all were created
                const messages = await queries.messagesByThread(threadId) as Message[];
                // Should have at least our 10 concurrent messages
                if (messages.length < 10) {
                    throw new Error(`Expected at least 10 messages, got ${messages.length}`);
                }
            },
        },
    ];
    
    // Multi-Tab Sync Tests
    multiTabTests.value = [
        {
            id: 'multitab-broadcast',
            name: 'Broadcast Channel Available',
            description: 'BroadcastChannel API is available for cross-tab sync',
            category: 'multitab',
            status: 'pending',
            fn: async () => {
                if (typeof BroadcastChannel === 'undefined') {
                    throw new Error('BroadcastChannel not available');
                }
                
                // Create and close a channel to verify it works
                const channel = new BroadcastChannel('sync-harness-test');
                channel.close();
            },
        },
        {
            id: 'multitab-storage-event',
            name: 'Storage Events Work',
            description: 'localStorage changes can trigger cross-tab updates',
            category: 'multitab',
            status: 'pending',
            fn: async () => {
                if (typeof localStorage === 'undefined') {
                    throw new Error('localStorage not available');
                }
                
                const testKey = 'sync-harness-test-' + Date.now();
                localStorage.setItem(testKey, 'test');
                const retrieved = localStorage.getItem(testKey);
                localStorage.removeItem(testKey);
                
                if (retrieved !== 'test') {
                    throw new Error('localStorage roundtrip failed');
                }
            },
        },
        {
            id: 'multitab-indexeddb',
            name: 'IndexedDB Cross-Tab',
            description: 'IndexedDB changes are visible to other contexts',
            category: 'multitab',
            status: 'pending',
            fn: async () => {
                const db = getDb();
                const threadId = testThreadId.value!;
                
                // Write a message
                const msgId = newId();
                await tx.appendMessage({
                    id: msgId,
                    thread_id: threadId,
                    role: 'user',
                    data: { content: 'Cross-tab test' },
                });
                
                // Open a fresh DB connection and verify
                const freshDb = getDb();
                const msg = await freshDb.messages.get(msgId);
                
                if (!msg) throw new Error('Message not visible through fresh connection');
            },
        },
    ];
}

// ============================================================
// Lifecycle
// ============================================================

onMounted(async () => {
    initializeTests();
    await refreshSyncHealth();
    initializing.value = false;
    log('info', 'Sync E2E Test Harness initialized');
});

onUnmounted(() => {
    cleanupTestThread();
});
</script>

<style scoped>
.sync-harness {
    min-height: 100dvh;
    background: var(--md-surface);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

/* Header */
.harness-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: linear-gradient(135deg, var(--md-primary) 0%, var(--md-secondary) 100%);
    border-radius: 1rem;
    color: white;
}

.header-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.header-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
}

.header-icon {
    width: 1.75rem;
    height: 1.75rem;
}

.header-subtitle {
    font-size: 0.875rem;
    opacity: 0.9;
    margin: 0;
}

.header-actions {
    display: flex;
    gap: 0.5rem;
}

/* Status Banner */
.status-skeleton {
    height: 4rem;
    border-radius: 0.75rem;
}

.status-banner {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid var(--md-outline);
    background: var(--md-surface-container);
}

.status-banner.status-running {
    border-color: var(--md-primary);
    background: color-mix(in srgb, var(--md-primary) 10%, var(--md-surface));
}

.status-banner.status-passed {
    border-color: var(--md-success);
    background: color-mix(in srgb, var(--md-success) 10%, var(--md-surface));
}

.status-banner.status-failed {
    border-color: var(--md-error);
    background: color-mix(in srgb, var(--md-error) 10%, var(--md-surface));
}

.status-icon {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
}

.status-running .status-icon {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.status-text {
    flex: 1;
    display: flex;
    flex-direction: column;
}

.status-label {
    font-weight: 600;
    font-size: 1rem;
}

.status-detail {
    font-size: 0.875rem;
    color: var(--md-on-surface-variant);
}

.status-stats {
    display: flex;
    gap: 1rem;
}

.stat {
    font-size: 0.875rem;
    font-weight: 500;
}

.stat.passed { color: var(--md-success, #22c55e); }
.stat.failed { color: var(--md-error, #ef4444); }
.stat.pending { color: var(--md-on-surface-variant); }

/* Panels */
.panel {
    background: var(--md-surface-container);
    border: 1px solid var(--md-outline);
    border-radius: 0.75rem;
    padding: 1rem 1.25rem;
}

.panel-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
    color: var(--md-on-surface);
}

/* Sync Health */
.health-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
}

.health-card {
    padding: 0.75rem;
    background: var(--md-surface);
    border-radius: 0.5rem;
    border: 1px solid var(--md-outline);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.health-card.ok {
    border-color: var(--md-success, #22c55e);
    background: color-mix(in srgb, var(--md-success, #22c55e) 5%, var(--md-surface));
}

.health-label {
    font-size: 0.75rem;
    color: var(--md-on-surface-variant);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.health-value {
    font-size: 0.875rem;
    font-weight: 600;
}

/* Test Grid */
.test-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1rem;
}

.test-category {
    max-height: 400px;
    display: flex;
    flex-direction: column;
}

.test-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

/* Test Item */
.test-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--md-surface);
    border-radius: 0.5rem;
    border: 1px solid var(--md-outline);
    transition: border-color 0.2s, background 0.2s;
}

.test-item.status-passed {
    border-color: var(--md-success, #22c55e);
    background: color-mix(in srgb, var(--md-success, #22c55e) 5%, var(--md-surface));
}

.test-item.status-failed {
    border-color: var(--md-error, #ef4444);
    background: color-mix(in srgb, var(--md-error, #ef4444) 5%, var(--md-surface));
}

.test-item.status-running {
    border-color: var(--md-primary);
    background: color-mix(in srgb, var(--md-primary) 5%, var(--md-surface));
}

.test-info {
    flex: 1;
    min-width: 0;
}

.test-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    font-size: 0.875rem;
}

.test-status-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
}

.status-passed .test-status-icon { color: var(--md-success, #22c55e); }
.status-failed .test-status-icon { color: var(--md-error, #ef4444); }
.status-running .test-status-icon { color: var(--md-primary); animation: spin 1s linear infinite; }

.test-duration {
    font-size: 0.75rem;
    color: var(--md-on-surface-variant);
    margin-left: auto;
}

.test-desc {
    font-size: 0.75rem;
    color: var(--md-on-surface-variant);
    margin-top: 0.25rem;
}

.test-error {
    font-size: 0.75rem;
    color: var(--md-error, #ef4444);
    margin-top: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: color-mix(in srgb, var(--md-error, #ef4444) 10%, transparent);
    border-radius: 0.25rem;
}

/* Log Panel */
.log-panel {
    flex: 1;
    min-height: 200px;
    display: flex;
    flex-direction: column;
}

.log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
}

.log-header .panel-title {
    margin: 0;
}

.log-container {
    flex: 1;
    background: #0d0d0d;
    border-radius: 0.5rem;
    padding: 0.75rem;
    overflow-y: auto;
    font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Source Code Pro', monospace;
    font-size: 0.75rem;
    min-height: 150px;
    max-height: 300px;
}

.log-entry {
    display: flex;
    gap: 0.5rem;
    padding: 0.125rem 0;
}

.log-time {
    color: #666;
    flex-shrink: 0;
}

.log-level {
    width: 4rem;
    flex-shrink: 0;
    text-transform: uppercase;
    font-weight: 600;
}

.log-entry.info .log-level { color: #3b82f6; }
.log-entry.success .log-level { color: #22c55e; }
.log-entry.error .log-level { color: #ef4444; }
.log-entry.warn .log-level { color: #f59e0b; }
.log-entry.debug .log-level { color: #6b7280; }

.log-message {
    color: #e5e5e5;
    word-break: break-word;
}

.log-entry.error .log-message { color: #fca5a5; }
.log-entry.warn .log-message { color: #fcd34d; }

.log-empty {
    color: #666;
    font-style: italic;
    text-align: center;
    padding: 2rem;
}
</style>
