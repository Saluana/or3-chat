import Dexie from 'dexie';
import type { IndexableType } from 'dexie';
import type { Or3DB } from '~/db/client';

export const WORKSPACE_BACKUP_FORMAT = 'or3-backup-stream';
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
    const chunk = textEncoder.encode(text);

    const summary =
        line.type === 'meta'
            ? {
                  type: line.type,
                  tables: line.tables.length,
                  createdAt: line.createdAt,
              }
            : line.type === 'rows'
              ? {
                    type: line.type,
                    table: line.table,
                    rows: line.rows.length,
                    bytes: chunk.byteLength,
                }
              : line.type === 'table-start' || line.type === 'table-end'
                ? { type: line.type, table: line.table }
                : { type: line.type };

    if (line.type !== 'rows') {
        console.info('[workspace-backup] writeLine begin', summary);
    } else {
        console.debug('[workspace-backup] writeLine enqueue rows', summary);
    }

    const writeResult = writer.write(chunk);
    const warnLabel = `[workspace-backup] writeLine waiting (${summary.type}${
        'table' in summary ? `:${(summary as any).table}` : ''
    })`;
    const warnTimeout =
        line.type !== 'rows'
            ? setTimeout(() => {
                  console.warn(warnLabel, summary);
              }, 5000)
            : undefined;

    try {
        if (writeResult && typeof (writeResult as PromiseLike<void>).then === 'function') {
            await writeResult;
        }
    } finally {
        if (warnTimeout) {
            clearTimeout(warnTimeout);
        }
    }

    if (line.type !== 'rows') {
        console.info('[workspace-backup] writeLine complete', summary);
    }
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
            parsed &&
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
    console.info('[workspace-backup] stream export via File System Access API', {
        chunkSize,
    });
    const writable = await fileHandle.createWritable();
    const writer: WorkspaceBackupWriter = {
        write: (chunk) => writable.write(chunk as any),
        close: () => writable.close().catch(() => undefined),
    };

    await streamWorkspaceExportCore({
        db,
        writer,
        chunkSize,
        onProgress,
    });
}

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
                console.info('[workspace-backup] writable stream closed');
            } catch (error) {
                try {
                    await (writable as any).abort?.();
                } catch {
                    // ignore secondary abort failures
                }
            } finally {
                try {
                    writable.releaseLock();
                } catch {
                    // lock might already be released
                }
            }
        },
    };

    console.info('[workspace-backup] stream export to writable', {
        chunkSize,
        hasReleaseLock: typeof writable.releaseLock === 'function',
    });

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

        console.info('[workspace-backup] export will process tables', {
            tables: summaries.map((t) => ({ name: t.name, rows: t.rowCount })),
        });

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
            console.info('[workspace-backup] table export start', {
                table: summary.name,
                rows: summary.rowCount,
            });
            await writeLine(writer, {
                type: 'table-start',
                table: summary.name,
            });

            let lastKey: unknown | null = null;
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

                const rows = await collection.toArray();
                if (rows.length === 0) {
                    hasMore = false;
                    break;
                }

                console.debug('[workspace-backup] rows batch ready', {
                    table: summary.name,
                    batchSize: rows.length,
                });

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
                    keys = (await collection.primaryKeys()) as IndexableType[];
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
                        rows[rows.length - 1],
                        pk.keyPath ?? pk.name
                    );
                } else {
                    const keyList =
                        keys ??
                        ((await collection.primaryKeys()) as IndexableType[]);
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

            console.info('[workspace-backup] table export completed', {
                table: summary.name,
                processedRows: progress.completedRows,
                completedTables: progress.completedTables,
            });
        }

        await writeLine(writer, { type: 'end' });

        progress.completedRows = progress.totalRows;
        progress.completedTables = progress.totalTables;
        emitProgress(progress, onProgress);
        console.info('[workspace-backup] export finished', {
            totalTables: progress.totalTables,
            totalRows: progress.totalRows,
        });
    } finally {
        try {
            await writer.close();
            console.info('[workspace-backup] writer closed');
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

export async function peekWorkspaceBackupMetadata(
    file: Blob
): Promise<WorkspaceBackupHeaderLine> {
    for await (const line of iterateLinesFromBlob(file)) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as WorkspaceBackupLine;
        if (parsed.type === 'meta') {
            if (
                parsed.format !== WORKSPACE_BACKUP_FORMAT ||
                parsed.version !== WORKSPACE_BACKUP_VERSION
            ) {
                throw new Error('Unsupported backup format version.');
            }
            return parsed;
        }
    }
    throw new Error('Backup metadata not found.');
}

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
        header.type !== 'meta' ||
        header.format !== WORKSPACE_BACKUP_FORMAT ||
        header.version !== WORKSPACE_BACKUP_VERSION
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
                const failureCount = error.failures?.length ?? 0;
                const firstFailure = error.failures?.[0];
                const detail = firstFailure
                    ? ` Example: ${String(
                          (firstFailure as any)?.message ?? firstFailure
                      )}`
                    : '';
                const message = `Import hit ${
                    failureCount || 'one or more'
                } key conflicts in table "${tableName}". Enable "Overwrite records on key conflict" or use Replace mode.`;
                const conflictError = new Error(`${message}${detail}`);
                (conflictError as any).cause = error;
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
            while (true) {
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
                            await table.bulkPut(payload as any[]);
                        } else {
                            await handleConflict(currentTable, () =>
                                table.bulkAdd(payload as any[])
                            );
                        }
                        progress.completedRows += payload.length;
                        emitProgress(progress, onProgress);
                    } else {
                        const tuples = entry.rows as Array<{
                            key: IndexableType;
                            value: unknown;
                        }>;
                        if (overwriteValues) {
                            await table.bulkPut(
                                tuples.map((tuple) => tuple.value as any),
                                tuples.map((tuple) => tuple.key) as any
                            );
                        } else {
                            await handleConflict(currentTable, () =>
                                table.bulkAdd(
                                    tuples.map((tuple) => tuple.value as any),
                                    tuples.map((tuple) => tuple.key) as any
                                )
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
            if (typeof lineIterator.return === 'function') {
                try {
                    await Dexie.waitFor(lineIterator.return(undefined));
                } catch {
                    // ignore iterator cleanup errors
                }
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
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex !== -1) {
                const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                return line;
            }
        }
    } finally {
        reader.releaseLock();
    }
    return buffer.replace(/\r$/, '');
}

async function* iterateLinesFromBlob(blob: Blob): AsyncGenerator<string> {
    const reader = blob
        .stream()
        .pipeThrough(new TextDecoderStream())
        .getReader();
    let buffer = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let newlineIndex = buffer.indexOf('\n');
            while (newlineIndex !== -1) {
                const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                buffer = buffer.slice(newlineIndex + 1);
                yield line;
                newlineIndex = buffer.indexOf('\n');
            }
        }
        if (buffer.length > 0) {
            yield buffer.replace(/\r$/, '');
        }
    } finally {
        reader.releaseLock();
    }
}
