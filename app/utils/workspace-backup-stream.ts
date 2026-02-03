/**
 * @module app/utils/workspace-backup-stream
 *
 * Purpose:
 * Streams workspace backups to and from a JSONL format optimized for large
 * datasets and file blobs.
 *
 * Behavior:
 * - Exports tables as a line-delimited stream with a metadata header
 * - Imports by streaming lines into Dexie transactions
 * - Applies special handling for `file_blobs` to keep line size bounded
 *
 * Constraints:
 * - The backup format is versioned and validated on import
 * - Import can be destructive when `clearTables` is true
 *
 * Non-Goals:
 * - Cross-database migration between unrelated schemas
 * - Encrypted backups (handled at a higher layer)
 */

import Dexie from 'dexie';
import type { IndexableType } from 'dexie';
import type { Or3DB } from '~/db/client';

/**
 * `WORKSPACE_BACKUP_FORMAT`
 *
 * Purpose:
 * Identifies the JSONL backup stream format.
 */
export const WORKSPACE_BACKUP_FORMAT = 'or3-backup-stream';

/**
 * `WORKSPACE_BACKUP_VERSION`
 *
 * Purpose:
 * Current backup format version.
 */
export const WORKSPACE_BACKUP_VERSION = 1;

export interface WorkspaceBackupTableSummary {
    name: string;
    rowCount: number;
    inbound: boolean;
}

export interface WorkspaceBackupHeaderLine {
    type: 'meta';
    format: typeof WORKSPACE_BACKUP_FORMAT;
    version: typeof WORKSPACE_BACKUP_VERSION;
    databaseName: string;
    databaseVersion: number;
    createdAt: string;
    tables: WorkspaceBackupTableSummary[];
}

export interface WorkspaceBackupRowsLine {
    type: 'rows';
    table: string;
    rows: Array<unknown>;
}

export interface WorkspaceBackupTableStartLine {
    type: 'table-start';
    table: string;
}

export interface WorkspaceBackupTableEndLine {
    type: 'table-end';
    table: string;
}

export interface WorkspaceBackupEndLine {
    type: 'end';
}

export type WorkspaceBackupLine =
    | WorkspaceBackupHeaderLine
    | WorkspaceBackupRowsLine
    | WorkspaceBackupTableStartLine
    | WorkspaceBackupTableEndLine
    | WorkspaceBackupEndLine;

export interface WorkspaceBackupProgress {
    completedTables: number;
    totalTables: number;
    completedRows: number;
    totalRows: number;
}

const DEFAULT_EXPORT_LIMIT = 500;
const FILE_BLOBS_MAX_ROWS_PER_BATCH = 20;
const FILE_BLOBS_MAX_SERIALIZED_BYTES = 256 * 1024; // ~256 KB per JSONL line

const textEncoder = new TextEncoder();

interface WorkspaceBackupWriter {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
}

async function writeLine(
    writer: WorkspaceBackupWriter,
    line: WorkspaceBackupLine
) {
    const text = JSON.stringify(line) + '\n';
    await writer.write(textEncoder.encode(text));
}

function emitProgress(
    progress: WorkspaceBackupProgress,
    onProgress?: (progress: WorkspaceBackupProgress) => void
) {
    onProgress?.({ ...progress });
}

async function blobToBase64(
    blob: Blob
): Promise<{ data: string; type: string }> {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    const data = btoa(binary);
    return { data, type: blob.type };
}

function base64ToBlob(payload: { data: string; type: string }): Blob {
    const binaryString = atob(payload.data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes.buffer], { type: payload.type });
}

/**
 * `detectWorkspaceBackupFormat`
 *
 * Purpose:
 * Peeks at the first line to determine the backup format type.
 */
export async function detectWorkspaceBackupFormat(
    file: Blob
): Promise<'stream' | 'dexie' | 'unknown'> {
    const firstLine = await readFirstLine(file);
    if (!firstLine) return 'unknown';
    if (firstLine.includes('"formatName"') && firstLine.includes('"dexie"')) {
        return 'dexie';
    }
    try {
        const parsed = JSON.parse(firstLine) as Partial<WorkspaceBackupLine>;
        if (
            parsed.type === 'meta' &&
            parsed.format === WORKSPACE_BACKUP_FORMAT &&
            parsed.version === WORKSPACE_BACKUP_VERSION
        ) {
            return 'stream';
        }
    } catch {
        // ignore
    }
    return 'unknown';
}

/**
 * `streamWorkspaceExport`
 *
 * Purpose:
 * Streams a workspace backup to a FileSystem file handle.
 */
export async function streamWorkspaceExport({
    db,
    fileHandle,
    chunkSize = DEFAULT_EXPORT_LIMIT,
    onProgress,
}: {
    db: Or3DB;
    fileHandle: FileSystemFileHandle;
    chunkSize?: number;
    onProgress?: (progress: WorkspaceBackupProgress) => void;
}): Promise<void> {
    const writable = await fileHandle.createWritable();
    const writer: WorkspaceBackupWriter = {
        write: (chunk) => writable.write(chunk as unknown as Blob),
        close: () => writable.close().catch(() => undefined),
    };

    await streamWorkspaceExportCore({
        db,
        writer,
        chunkSize,
        onProgress,
    });
}

/**
 * `streamWorkspaceExportToWritable`
 *
 * Purpose:
 * Streams a workspace backup to an existing WritableStream writer.
 */
export async function streamWorkspaceExportToWritable({
    db,
    writable,
    chunkSize = DEFAULT_EXPORT_LIMIT,
    onProgress,
}: {
    db: Or3DB;
    writable: WritableStreamDefaultWriter<Uint8Array>;
    chunkSize?: number;
    onProgress?: (progress: WorkspaceBackupProgress) => void;
}): Promise<void> {
    const writer: WorkspaceBackupWriter = {
        write: (chunk) => writable.write(chunk),
        close: async () => {
            try {
                await writable.close();
            } catch {
                // close failed, just release the lock
            } finally {
                try {
                    writable.releaseLock();
                } catch {
                    // lock might already be released
                }
            }
        },
    };

    await streamWorkspaceExportCore({
        db,
        writer,
        chunkSize,
        onProgress,
    });
}

async function streamWorkspaceExportCore({
    db,
    writer,
    chunkSize,
    onProgress,
}: {
    db: Or3DB;
    writer: WorkspaceBackupWriter;
    chunkSize: number;
    onProgress?: (progress: WorkspaceBackupProgress) => void;
}) {
    const normalizedChunkSize =
        Number.isFinite(chunkSize) && chunkSize > 0
            ? Math.max(1, Math.floor(chunkSize))
            : DEFAULT_EXPORT_LIMIT;

    try {
        const summaries = await Promise.all(
            db.tables.map(async (table) => ({
                name: table.name,
                inbound: Boolean(table.schema.primKey.keyPath),
                rowCount: await table.count(),
            }))
        );

        const header: WorkspaceBackupHeaderLine = {
            type: 'meta',
            format: WORKSPACE_BACKUP_FORMAT,
            version: WORKSPACE_BACKUP_VERSION,
            databaseName: db.name,
            databaseVersion: db.verno,
            createdAt: new Date().toISOString(),
            tables: summaries,
        };

        const progress: WorkspaceBackupProgress = {
            completedTables: 0,
            totalTables: summaries.length,
            completedRows: 0,
            totalRows: summaries.reduce((sum, t) => sum + t.rowCount, 0),
        };

        await writeLine(writer, header);

        for (const summary of summaries) {
            const table = db.table(summary.name);
            await writeLine(writer, {
                type: 'table-start',
                table: summary.name,
            });

            let lastKey: IndexableType | null = null;
            let hasMore = true;

            const tableChunkSize =
                summary.name === 'file_blobs'
                    ? Math.max(
                          1,
                          Math.min(
                              normalizedChunkSize,
                              FILE_BLOBS_MAX_ROWS_PER_BATCH
                          )
                      )
                    : normalizedChunkSize;

            while (hasMore) {
                const collection =
                    lastKey == null
                        ? table.limit(tableChunkSize)
                        : table
                              .where(':id')
                              .above(lastKey)
                              .limit(tableChunkSize);

                const rows: unknown[] = await collection.toArray();
                if (rows.length === 0) {
                    hasMore = false;
                    break;
                }

                let keys: IndexableType[] | undefined;

                if (summary.name === 'file_blobs') {
                    let chunkPayload: Array<{
                        hash: string;
                        blob: { data: string; type: string };
                    }> = [];
                    let serializedBytes = 0;

                    const flushPayload = async () => {
                        if (!chunkPayload.length) return;
                        const rowsToWrite = chunkPayload;
                        chunkPayload = [];
                        serializedBytes = 0;
                        await writeLine(writer, {
                            type: 'rows',
                            table: summary.name,
                            rows: rowsToWrite,
                        });
                        progress.completedRows += rowsToWrite.length;
                        emitProgress(progress, onProgress);
                    };

                    for (const row of rows as Array<{
                        hash: string;
                        blob: Blob;
                    }>) {
                        const base64 = await blobToBase64(row.blob);
                        chunkPayload.push({
                            hash: row.hash,
                            blob: base64,
                        });
                        serializedBytes +=
                            base64.data.length +
                            base64.type.length +
                            row.hash.length;
                        if (
                            serializedBytes >= FILE_BLOBS_MAX_SERIALIZED_BYTES
                        ) {
                            await flushPayload();
                        }
                    }

                    await flushPayload();
                } else if (summary.inbound) {
                    await writeLine(writer, {
                        type: 'rows',
                        table: summary.name,
                        rows,
                    });
                    progress.completedRows += rows.length;
                    emitProgress(progress, onProgress);
                } else {
                    keys = await collection.primaryKeys();
                    await writeLine(writer, {
                        type: 'rows',
                        table: summary.name,
                        rows: keys.map((key, idx) => ({
                            key,
                            value: rows[idx],
                        })),
                    });
                    progress.completedRows += rows.length;
                    emitProgress(progress, onProgress);
                }

                if (summary.inbound) {
                    const pk = table.schema.primKey;
                    lastKey = Dexie.getByKeyPath(
                        rows[rows.length - 1] as Record<string, unknown>,
                        pk.keyPath ?? pk.name
                    ) as IndexableType;
                } else {
                    const keyList: IndexableType[] =
                        keys ?? (await collection.primaryKeys());
                    lastKey = keyList[keyList.length - 1] ?? null;
                }
                hasMore = rows.length === tableChunkSize;
            }

            await writeLine(writer, {
                type: 'table-end',
                table: summary.name,
            });

            progress.completedTables += 1;
            emitProgress(progress, onProgress);
        }

        await writeLine(writer, { type: 'end' });

        progress.completedRows = progress.totalRows;
        progress.completedTables = progress.totalTables;
        emitProgress(progress, onProgress);
    } finally {
        try {
            await writer.close();
        } catch (closeError) {
            console.warn(
                '[workspace-backup] Failed to close export stream',
                closeError
            );
        }
    }
}

export interface StreamImportOptions {
    clearTables: boolean;
    overwriteValues: boolean;
    onProgress?: (progress: WorkspaceBackupProgress) => void;
}

function isValidBackupFormat(
    format: string
): format is typeof WORKSPACE_BACKUP_FORMAT {
    return format === WORKSPACE_BACKUP_FORMAT;
}

function isValidBackupVersion(
    version: number
): version is typeof WORKSPACE_BACKUP_VERSION {
    return version === WORKSPACE_BACKUP_VERSION;
}

/**
 * `peekWorkspaceBackupMetadata`
 *
 * Purpose:
 * Reads the backup header metadata without importing the full file.
 */
export async function peekWorkspaceBackupMetadata(
    file: Blob
): Promise<WorkspaceBackupHeaderLine> {
    for await (const line of iterateLinesFromBlob(file)) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as WorkspaceBackupLine;
        if (parsed.type === 'meta') {
            if (
                !isValidBackupFormat(parsed.format) ||
                !isValidBackupVersion(parsed.version)
            ) {
                throw new Error('Unsupported backup format version.');
            }
            return parsed;
        }
    }
    throw new Error('Backup metadata not found.');
}

/**
 * `importWorkspaceStream`
 *
 * Purpose:
 * Imports a workspace backup stream into the provided Dexie database.
 *
 * Constraints:
 * - Throws when the backup targets a different DB name or newer schema
 */
export async function importWorkspaceStream({
    db,
    file,
    clearTables,
    overwriteValues,
    onProgress,
}: {
    db: Or3DB;
    file: Blob;
    clearTables: boolean;
    overwriteValues: boolean;
    onProgress?: (progress: WorkspaceBackupProgress) => void;
}): Promise<void> {
    const lineIterator = iterateLinesFromBlob(file);
    const firstEntry = await lineIterator.next();
    if (firstEntry.done || !firstEntry.value) {
        throw new Error('Backup file is empty.');
    }
    const header = JSON.parse(firstEntry.value) as WorkspaceBackupHeaderLine;
    if (
        (header.type as string) !== 'meta' ||
        !isValidBackupFormat(header.format) ||
        !isValidBackupVersion(header.version)
    ) {
        throw new Error('Unsupported backup format header.');
    }

    if (header.databaseName !== db.name) {
        throw new Error('Backup targets a different database.');
    }
    if (header.databaseVersion > db.verno) {
        throw new Error('Backup requires a newer app version.');
    }

    const tableByName = new Map(db.tables.map((table) => [table.name, table]));
    const inboundMap = new Map(
        header.tables.map((table) => [table.name, table.inbound])
    );

    const progress: WorkspaceBackupProgress = {
        completedRows: 0,
        completedTables: 0,
        totalRows: header.tables.reduce((sum, t) => sum + t.rowCount, 0),
        totalTables: header.tables.length,
    };
    emitProgress(progress, onProgress);

    const handleConflict = async <T>(
        tableName: string,
        operation: () => Promise<T>
    ) => {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof Dexie.BulkError) {
                const failureCount = error.failures.length;
                const firstFailure = error.failures[0];
                const detail = firstFailure
                    ? ` Example: ${String(
                          firstFailure instanceof Error
                              ? firstFailure.message
                              : firstFailure
                      )}`
                    : '';
                const message = `Import hit ${
                    failureCount || 'one or more'
                } key conflicts in table "${tableName}". Enable "Overwrite records on key conflict" or use Replace mode.`;
                const conflictError = new Error(`${message}${detail}`, {
                    cause: error,
                });
                throw conflictError;
            }
            throw error;
        }
    };

    await db.transaction('rw', db.tables, async () => {
        if (clearTables) {
            for (const table of db.tables) {
                await table.clear();
            }
        }

        let currentTable: string | null = null;

        try {
            for (;;) {
                const next = await Dexie.waitFor(lineIterator.next());
                if (next.done) break;
                const raw = next.value.trim();
                if (!raw) continue;

                const entry = JSON.parse(raw) as WorkspaceBackupLine;

                if (entry.type === 'table-start') {
                    currentTable = entry.table;
                    continue;
                }
                if (entry.type === 'table-end') {
                    currentTable = null;
                    progress.completedTables += 1;
                    emitProgress(progress, onProgress);
                    continue;
                }
                if (entry.type === 'rows') {
                    if (!currentTable) {
                        throw new Error('Encountered rows before table start.');
                    }
                    const table = tableByName.get(currentTable);
                    if (!table) {
                        throw new Error(
                            `Unknown table ${currentTable} in backup.`
                        );
                    }
                    const inbound = inboundMap.get(currentTable) ?? true;

                    if (currentTable === 'file_blobs') {
                        const typedRows = entry.rows as Array<{
                            hash: string;
                            blob: { data: string; type: string };
                        }>;
                        const payload = typedRows.map((row) => ({
                            hash: row.hash,
                            blob: base64ToBlob(row.blob),
                        }));
                        if (overwriteValues) {
                            await table.bulkPut(payload);
                        } else {
                            await handleConflict(currentTable, () =>
                                table.bulkAdd(payload)
                            );
                        }
                        progress.completedRows += payload.length;
                        emitProgress(progress, onProgress);
                        continue;
                    }

                    if (inbound) {
                        const payload = entry.rows as Array<
                            Record<string, unknown>
                        >;
                        if (overwriteValues) {
                            await table.bulkPut(payload);
                        } else {
                            await handleConflict(currentTable, () =>
                                table.bulkAdd(payload)
                            );
                        }
                        progress.completedRows += payload.length;
                        emitProgress(progress, onProgress);
                    } else {
                        // For outbound tables (no inbound key), tuples have explicit keys.
                        // However, we just extract values since they should contain the key property.
                        const tuples = entry.rows as Array<{
                            key: IndexableType;
                            value: Record<string, unknown>;
                        }>;
                        const values = tuples.map((tuple) => tuple.value);
                        if (overwriteValues) {
                            await table.bulkPut(values);
                        } else {
                            await handleConflict(currentTable, () =>
                                table.bulkAdd(values)
                            );
                        }
                        progress.completedRows += tuples.length;
                        emitProgress(progress, onProgress);
                    }
                    continue;
                }

                if (entry.type === 'end') {
                    break;
                }
            }
        } finally {
            try {
                await Dexie.waitFor(lineIterator.return(undefined));
            } catch {
                // ignore iterator cleanup errors
            }
        }
    });

    progress.completedRows = progress.totalRows;
    progress.completedTables = progress.totalTables;
    emitProgress(progress, onProgress);
}

async function readFirstLine(file: Blob): Promise<string> {
    const reader = file
        .stream()
        .pipeThrough(new TextDecoderStream())
        .getReader();
    let buffer = '';
    let done = false;
    try {
        do {
            const result = await reader.read();
            done = result.done;
            if (!done && result.value) {
                buffer += result.value;
                const newlineIndex = buffer.indexOf('\n');
                if (newlineIndex !== -1) {
                    return buffer.slice(0, newlineIndex).replace(/\r$/, '');
                }
            }
        } while (!done);
        return buffer.replace(/\r$/, '');
    } finally {
        reader.releaseLock();
    }
}

async function* iterateLinesFromBlob(blob: Blob): AsyncGenerator<string> {
    const reader = blob
        .stream()
        .pipeThrough(new TextDecoderStream())
        .getReader();
    let buffer = '';
    let done = false;
    try {
        do {
            const result = await reader.read();
            done = result.done;
            if (!done && result.value) {
                buffer += result.value;
                let newlineIndex = buffer.indexOf('\n');
                while (newlineIndex !== -1) {
                    const line = buffer
                        .slice(0, newlineIndex)
                        .replace(/\r$/, '');
                    buffer = buffer.slice(newlineIndex + 1);
                    yield line;
                    newlineIndex = buffer.indexOf('\n');
                }
            }
        } while (!done);
        if (buffer.length > 0) {
            yield buffer.replace(/\r$/, '');
        }
    } finally {
        reader.releaseLock();
    }
}
