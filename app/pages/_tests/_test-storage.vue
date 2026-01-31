<script setup lang="ts">
/**
 * Interactive Storage Layer Test Page
 * Visit: http://localhost:3001/_tests/_test-storage
 *
 * Tests the file storage layer with Convex:
 * - File upload queue
 * - Download queue
 * - Transfer progress tracking
 * - Hash-based deduplication
 */

// Disable SSR to avoid hydration mismatches with client-only features
definePageMeta({ ssr: false });

import { useConvexQuery, useConvexMutation } from 'convex-vue';
import { api } from '~~/convex/_generated/api';
import { getDb } from '~/db/client';
import type { FileMeta } from '~/db/schema';

// ----- Convex User Identity -----
const { data: identity } = useConvexQuery(api.users.me, {});

// Transfer type for local use  
interface FileTransfer {
    id: string;
    hash: string;
    workspace_id: string;
    direction: 'upload' | 'download';
    state: 'queued' | 'running' | 'paused' | 'failed' | 'done';
    bytes_total: number;
    bytes_done: number;
    attempts: number;
    created_at: number;
    updated_at: number;
    last_error?: string;
}

// ----- File Transfers -----
const transfers = ref<FileTransfer[]>([]);
const transfersLoading = ref(false);
const transfersError = ref<string | null>(null);

async function loadTransfers() {
    transfersLoading.value = true;
    transfersError.value = null;
    try {
        const db = getDb();
        const all = await db.file_transfers.orderBy('created_at').reverse().limit(20).toArray();
        transfers.value = all;
    } catch (e) {
        transfersError.value = e instanceof Error ? e.message : String(e);
    } finally {
        transfersLoading.value = false;
    }
}

// ----- File Meta -----
const fileMeta = ref<FileMeta[]>([]);
const fileMetaLoading = ref(false);

async function loadFileMeta() {
    fileMetaLoading.value = true;
    try {
        const db = getDb();
        const all = await db.file_meta.limit(20).toArray();
        fileMeta.value = all;
    } catch {
        // ignore
    } finally {
        fileMetaLoading.value = false;
    }
}

// ----- Upload Test File -----
const uploadInput = ref<HTMLInputElement | null>(null);
const uploadLoading = ref(false);
const uploadResult = ref<string | null>(null);

async function selectFile() {
    uploadInput.value?.click();
}

async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    uploadLoading.value = true;
    uploadResult.value = null;

    try {
        const db = getDb();
        
        // Read file and compute hash
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        const hash = `sha256:${hashHex}`;

        // Check for existing file (deduplication)
        const existing = await db.file_meta.get(hash);
        if (existing) {
            uploadResult.value = `Deduplicated! File already exists with hash: ${hash.slice(0, 20)}...`;
            await loadFileMeta();
            await loadTransfers();
            return;
        }

        // Determine file kind
        const kind = file.type.startsWith('image/') ? 'image' : 'pdf';

        const nowSec = Math.floor(Date.now() / 1000);
        await db.file_meta.add({
            hash,
            mime_type: file.type,
            name: file.name,
            size_bytes: file.size,
            kind,
            ref_count: 1,
            deleted: false,
            created_at: nowSec,
            updated_at: nowSec,
            clock: 1,
        });

        // Add file blob
        await db.file_blobs.put({
            hash,
            blob: new Blob([buffer], { type: file.type }),
        });

        // Queue upload transfer
        await db.file_transfers.add({
            id: crypto.randomUUID(),
            hash,
            workspace_id: 'test-workspace',
            direction: 'upload',
            state: 'queued',
            bytes_total: file.size,
            bytes_done: 0,
            attempts: 0,
            created_at: nowSec,
            updated_at: nowSec,
        });

        uploadResult.value = `File queued for upload: ${file.name} (${hash.slice(0, 20)}...)`;
        await loadFileMeta();
        await loadTransfers();
    } catch (e) {
        uploadResult.value = `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        uploadLoading.value = false;
        input.value = '';
    }
}

// ----- Transfer Progress -----
function getProgressPercent(transfer: FileTransfer): number {
    if (!transfer.bytes_total) return 0;
    return Math.round((transfer.bytes_done / transfer.bytes_total) * 100);
}

function getStateColor(state: FileTransfer['state']): string {
    switch (state) {
        case 'done':
            return 'pass';
        case 'running':
            return 'pending';
        case 'failed':
            return 'fail';
        default:
            return '';
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ----- Clear Transfers -----
async function clearTransfers() {
    const db = getDb();
    await db.file_transfers.clear();
    await loadTransfers();
}

// ----- Initialize -----
onMounted(() => {
    loadTransfers();
    loadFileMeta();
});
</script>

<template>
    <div class="test-wrapper">
        <div class="test-page">
            <h1>📦 Storage Layer Test</h1>
            <p class="subtitle">Interactive test page for file upload/download with Convex</p>

        <!-- Auth Status -->
        <div class="card" :class="identity ? 'status-green' : 'status-yellow'">
            <h2>{{ identity ? '✅ Authenticated' : '⏳ Not Authenticated' }}</h2>
            <p v-if="identity">Signed in as: {{ identity.email }}</p>
            <p v-else>Sign in to test storage with real Convex backend</p>
        </div>

        <!-- Upload Test -->
        <div class="card">
            <h2>📤 Upload Test File</h2>
            <p class="help">Select a file to test upload queue and hash-based deduplication</p>
            <input ref="uploadInput" type="file" style="display: none" @change="handleFileSelect" />
            <button class="btn" @click="selectFile" :disabled="uploadLoading">
                {{ uploadLoading ? 'Processing...' : '+ Select File' }}
            </button>
            <p v-if="uploadResult" class="info">{{ uploadResult }}</p>
        </div>

        <!-- Transfer Queue -->
        <div class="card">
            <h2>📊 Transfer Queue</h2>
            <div class="btn-row">
                <button class="btn" @click="loadTransfers" :disabled="transfersLoading">
                    {{ transfersLoading ? 'Loading...' : 'Refresh' }}
                </button>
                <button class="btn btn-danger" @click="clearTransfers">Clear All</button>
            </div>
            <div v-if="transfersError" class="error">{{ transfersError }}</div>
            <table v-if="transfers.length" class="results-table">
                <thead>
                    <tr>
                        <th>Direction</th>
                        <th>Hash</th>
                        <th>State</th>
                        <th>Progress</th>
                        <th>Attempts</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="t in transfers" :key="t.id">
                        <td>{{ t.direction === 'upload' ? '⬆️' : '⬇️' }} {{ t.direction }}</td>
                        <td class="mono">{{ t.hash.slice(0, 16) }}...</td>
                        <td :class="getStateColor(t.state)">{{ t.state }}</td>
                        <td>
                            <div class="progress-bar">
                                <div class="progress-fill" :style="{ width: `${getProgressPercent(t)}%` }"></div>
                            </div>
                            <span class="progress-text">{{ formatBytes(t.bytes_done) }} / {{ formatBytes(t.bytes_total) }}</span>
                        </td>
                        <td>{{ t.attempts }}</td>
                    </tr>
                </tbody>
            </table>
            <p v-else class="info">No transfers in queue</p>
        </div>

        <!-- File Meta -->
        <div class="card">
            <h2>📁 File Metadata</h2>
            <button class="btn" @click="loadFileMeta" :disabled="fileMetaLoading">
                {{ fileMetaLoading ? 'Loading...' : 'Refresh' }}
            </button>
            <table v-if="fileMeta.length" class="results-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Size</th>
                        <th>Hash</th>
                        <th>Storage ID</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="f in fileMeta" :key="f.hash">
                        <td>{{ f.name }}</td>
                        <td><code>{{ f.kind }}</code></td>
                        <td>{{ formatBytes(f.size_bytes) }}</td>
                        <td class="mono">{{ f.hash.slice(0, 16) }}...</td>
                        <td>{{ f.storage_id ? '✅' : '❌ Not uploaded' }}</td>
                    </tr>
                </tbody>
            </table>
            <p v-else class="info">No files in local database</p>
        </div>

        <!-- Navigation -->
        <div class="nav-links">
            <NuxtLink to="/" class="link">← Home</NuxtLink>
            <NuxtLink to="/_tests/_test-sync" class="link">← Sync Test</NuxtLink>
            <NuxtLink to="/_tests/_test-full-stack" class="link">Full Stack Test →</NuxtLink>
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

.btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    margin-right: 0.5rem;
}

.btn:hover {
    background: #2563eb;
}

.btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
}

.btn-danger {
    background: #ef4444;
}

.btn-danger:hover {
    background: #dc2626;
}

.btn-row {
    margin-bottom: 1rem;
}

.help {
    color: #666;
    font-size: 0.875rem;
    margin-bottom: 1rem;
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

.mono {
    font-family: monospace;
    font-size: 0.8rem;
}

.pending {
    color: #f59e0b;
}
.pass {
    color: #10b981;
}
.fail {
    color: #ef4444;
}
.error {
    color: #ef4444;
    padding: 0.5rem;
    background: #fee2e2;
    border-radius: 4px;
    margin-bottom: 1rem;
}
.info {
    color: #3b82f6;
    margin-top: 0.5rem;
}

.progress-bar {
    height: 8px;
    background: #e5e7eb;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.25rem;
}

.progress-fill {
    height: 100%;
    background: #10b981;
    transition: width 0.3s;
}

.progress-text {
    font-size: 0.75rem;
    color: #666;
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

code {
    background: #e5e7eb;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.875rem;
}
</style>
