<template>
    <main class="mx-auto max-w-5xl space-y-6 p-6" data-testid="storage-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Local Storage Harness</h1>
            <p class="text-sm opacity-80">
                Exercises the real file metadata store and persistent transfer queue.
            </p>
            <output data-testid="storage-ready">{{ ready ? 'true' : 'false' }}</output>
        </header>

        <section class="space-y-3 rounded-lg border p-4">
            <div class="flex flex-wrap gap-2">
                <label>
                    <span class="sr-only">Choose a file</span>
                    <input
                        data-testid="upload-input"
                        type="file"
                        :disabled="!ready || busy"
                        @change="upload"
                    >
                </label>
                <button data-testid="storage-reset" type="button" :disabled="busy" @click="reset">
                    Reset
                </button>
                <button data-testid="storage-refresh" type="button" :disabled="busy" @click="refresh">
                    Refresh
                </button>
            </div>
            <output aria-live="polite" data-testid="storage-feedback">{{ feedback }}</output>
        </section>

        <section class="space-y-3 rounded-lg border p-4" data-testid="transfer-card">
            <div class="flex items-center justify-between gap-3">
                <h2 class="text-lg font-medium">Transfer Queue</h2>
                <button
                    data-testid="transfer-clear"
                    type="button"
                    :disabled="busy"
                    @click="clearTransfers"
                >
                    Clear All
                </button>
            </div>
            <output data-testid="transfer-count">{{ transfers.length }}</output>
            <p v-if="transfers.length === 0" data-testid="transfer-empty">
                No transfers in queue
            </p>
            <table v-else data-testid="transfer-table">
                <thead>
                    <tr>
                        <th>Direction</th>
                        <th>State</th>
                        <th>Hash</th>
                    </tr>
                </thead>
                <tbody data-testid="transfer-rows">
                    <tr v-for="transfer in transfers" :key="transfer.id">
                        <td>{{ transfer.direction }}</td>
                        <td>{{ transfer.state }}</td>
                        <td>{{ transfer.hash }}</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section class="space-y-3 rounded-lg border p-4" data-testid="metadata-card">
            <h2 class="text-lg font-medium">File Metadata</h2>
            <output data-testid="metadata-count">{{ files.length }}</output>
            <p v-if="files.length === 0" data-testid="metadata-empty">
                No files in local database
            </p>
            <table v-else data-testid="metadata-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Kind</th>
                        <th>References</th>
                        <th>Remote</th>
                    </tr>
                </thead>
                <tbody data-testid="metadata-rows">
                    <tr v-for="file in files" :key="file.hash">
                        <td>{{ file.name }}</td>
                        <td>{{ file.kind }}</td>
                        <td>{{ file.ref_count }}</td>
                        <td>{{ file.storage_id ? 'Uploaded' : 'Not uploaded' }}</td>
                    </tr>
                </tbody>
            </table>
        </section>
    </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { FileTransferQueue } from '~/core/storage/transfer-queue';
import type { ObjectStorageProvider } from '~/core/storage/types';
import { getDb } from '~/db/client';
import { createOrRefFile } from '~/db/files';
import type { FileMeta } from '~/db/schema';
import type { FileTransfer } from '~~/shared/storage/types';

if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
}

const TEST_WORKSPACE_ID = 'storage-harness';
const db = getDb();
const provider: ObjectStorageProvider = {
    id: 'storage-harness',
    displayName: 'Storage harness',
    supports: {
        presignedUpload: true,
        presignedDownload: true,
    },
    getPresignedUploadUrl: async () => {
        throw new Error('Harness transfers must remain queued');
    },
    getPresignedDownloadUrl: async () => {
        throw new Error('Harness transfers must remain queued');
    },
};
const queue = new FileTransferQueue(db, provider, {
    concurrency: 0,
    dbResolver: () => db,
    workspaceDbResolver: () => db,
});

const ready = ref(false);
const busy = ref(false);
const feedback = ref('Ready');
const transfers = ref<FileTransfer[]>([]);
const files = ref<FileMeta[]>([]);

async function refresh(): Promise<void> {
    const [nextTransfers, nextFiles] = await Promise.all([
        db.file_transfers.toArray(),
        db.file_meta.toArray(),
    ]);
    transfers.value = nextTransfers.sort((a, b) => a.created_at - b.created_at);
    files.value = nextFiles.sort((a, b) => a.created_at - b.created_at);
}

async function upload(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    busy.value = true;
    try {
        const meta = await createOrRefFile(file, file.name);
        await queue.enqueue(meta.hash, 'upload');
        feedback.value =
            meta.ref_count > 1 ? 'Deduplicated!' : 'File queued for upload';
        await refresh();
    } catch (error) {
        feedback.value =
            error instanceof Error ? error.message : 'Upload failed';
    } finally {
        input.value = '';
        busy.value = false;
    }
}

async function clearTransfers(): Promise<void> {
    busy.value = true;
    try {
        await db.file_transfers.clear();
        feedback.value = 'Transfer queue cleared';
        await refresh();
    } finally {
        busy.value = false;
    }
}

async function reset(): Promise<void> {
    busy.value = true;
    try {
        await db.transaction(
            'rw',
            [db.file_transfers, db.file_blobs, db.file_meta],
            async () => {
                await db.file_transfers.clear();
                await db.file_blobs.clear();
                await db.file_meta.clear();
            }
        );
        feedback.value = 'Storage reset';
        await refresh();
    } finally {
        busy.value = false;
    }
}

onMounted(async () => {
    queue.setWorkspaceId(TEST_WORKSPACE_ID);
    await refresh();
    ready.value = true;
});

onBeforeUnmount(() => {
    queue.dispose();
});
</script>
