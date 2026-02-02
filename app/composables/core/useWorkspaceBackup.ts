import { ref, type Ref } from 'vue';
import { getDb } from '~/db/client';
import { reportError, err, asAppError, type AppError, type ErrorCode } from '~/utils/errors';
import { useHooks } from '~/core/hooks/useHooks';
import { useLazyBoundaries } from '~/composables/core/useLazyBoundaries';
import {
    detectWorkspaceBackupFormat,
    importWorkspaceStream,
    peekWorkspaceBackupMetadata,
    streamWorkspaceExport,
    streamWorkspaceExportToWritable,
    WORKSPACE_BACKUP_FORMAT,
    WORKSPACE_BACKUP_VERSION,
    type WorkspaceBackupHeaderLine,
    type WorkspaceBackupProgress,
} from '~/utils/workspace-backup-stream';

export type WorkspaceImportMode = 'replace' | 'append';

export interface WorkspaceBackupState {
    isExporting: Ref<boolean>;
    isImporting: Ref<boolean>;
    progress: Ref<number>; // 0-100
    currentStep: Ref<
        | 'idle'
        | 'peeking'
        | 'confirm'
        | 'importing'
        | 'exporting'
        | 'done'
        | 'error'
    >;
    importMode: Ref<WorkspaceImportMode>;
    overwriteValues: Ref<boolean>;
    backupMeta: Ref<ImportMetadata | null>;
    backupFormat: Ref<'stream' | 'dexie' | null>;
    error: Ref<AppError | null>;
}

export interface ImportMetadata {
    databaseName: string;
    databaseVersion: number;
    tables: Array<{ name: string; rowCount: number }>;
}

export interface WorkspaceBackupApi {
    state: WorkspaceBackupState;
    exportWorkspace(): Promise<void>;
    peekBackup(file: Blob): Promise<void>;
    importWorkspace(file: Blob): Promise<void>;
    reset(): void;
}

interface FilePickerOptions {
    suggestedName?: string;
    types?: Array<{
        description: string;
        accept: Record<string, string[]>;
    }>;
}

interface WindowWithFilePicker {
    showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;
}

const STREAM_CHUNK_SIZE = 500;
const DEFAULT_KILOBYTES_PER_CHUNK = 1024;

// Lazy loaders for workspace backup dependencies
function loadDexieExportImport() {
    if (typeof window === 'undefined') {
        throw err(
            'ERR_INTERNAL',
            'Workspace backup is only available in the browser.',
            { tags: { domain: 'db', action: 'ssr' } }
        );
    }

    const lazyBoundaries = useLazyBoundaries();
    return lazyBoundaries.load({
        key: 'workspace-import',
        loader: () => import('dexie-export-import'),
    });
}

async function loadStreamSaver() {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const lazyBoundaries = useLazyBoundaries();
        const module = await lazyBoundaries.load({
            key: 'workspace-export',
            loader: () => import('streamsaver'),
        });
        return module;
    } catch (error) {
        console.warn('[workspace-backup] Failed to load StreamSaver', error);
        // Reset the boundary so retry is possible
        const lazyBoundaries = useLazyBoundaries();
        lazyBoundaries.reset('workspace-export');
        return null;
    }
}

interface DexieBackupMeta {
    formatName: string;
    formatVersion: number;
    data: ImportMetadata;
}

function validateBackupMeta(meta: unknown): ImportMetadata {
    const backupMeta = meta as DexieBackupMeta;
    if (backupMeta.formatName !== 'dexie') {
        throw err(
            'ERR_VALIDATION',
            'Invalid backup format. Expected Dexie format.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
    if (backupMeta.formatVersion !== 1) {
        throw err(
            'ERR_VALIDATION',
            'Unsupported backup version. Please update the app.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
    if (backupMeta.data.databaseName !== 'or3-db') {
        throw err('ERR_VALIDATION', 'Backup is for a different database.', {
            tags: { domain: 'db', action: 'validate' },
        });
    }
    if (backupMeta.data.databaseVersion > getDb().verno) {
        throw err(
            'ERR_VALIDATION',
            'Backup is from a newer app version. Please update.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
    return backupMeta.data;
}

export function useWorkspaceBackup(): WorkspaceBackupApi {
    const hooks = useHooks();

    const state: WorkspaceBackupState = {
        isExporting: ref(false),
        isImporting: ref(false),
        progress: ref(0),
        currentStep: ref('idle'),
        importMode: ref('replace'),
        overwriteValues: ref(false),
        backupMeta: ref(null),
        backupFormat: ref(null),
        error: ref(null),
    };

    function reset() {
        state.isExporting.value = false;
        state.isImporting.value = false;
        state.progress.value = 0;
        state.currentStep.value = 'idle';
        state.backupMeta.value = null;
        state.backupFormat.value = null;
        state.error.value = null;
    }

    async function exportWorkspace(): Promise<void> {
        if (state.isExporting.value || state.isImporting.value) return;
        if (typeof window === 'undefined') {
            state.error.value = err(
                'ERR_INTERNAL',
                'Workspace export requires a browser environment.',
                { tags: { domain: 'db', action: 'export' } }
            );
            return;
        }
        state.isExporting.value = true;
        state.currentStep.value = 'exporting';
        state.progress.value = 0;
        state.error.value = null;

        const exportStartedAt = Date.now();
        let exportTelemetry: {
            format: 'stream';
            filenameBase: string;
            suggestedName: string;
        } = {
            format: 'stream',
            filenameBase: '',
            suggestedName: '',
        };

        try {
            const showSaveFilePicker =
                typeof window !== 'undefined'
                    ? (window as unknown as WindowWithFilePicker).showSaveFilePicker
                    : undefined;

            const filenameBase = `or3-workspace-${new Date()
                .toISOString()
                .slice(0, 19)
                .replace(/:/g, '-')}`;
            const suggestedName = `${filenameBase}.or3.jsonl`;

            exportTelemetry = {
                format: 'stream',
                filenameBase,
                suggestedName,
            };

            await hooks.doAction(
                'workspace.backup.export:action:before',
                exportTelemetry
            );

            const updateStreamProgress = (
                progress: WorkspaceBackupProgress
            ) => {
                const total = progress.totalTables + progress.totalRows;
                const completed =
                    progress.completedTables + progress.completedRows;
                state.progress.value =
                    total > 0 ? Math.round((completed / total) * 100) : 0;
            };

            if (typeof showSaveFilePicker === 'function') {
                const fileHandle = await showSaveFilePicker({
                    suggestedName,
                    types: [
                        {
                            description: 'OR3 Workspace Backup',
                            accept: {
                                'application/json': ['.or3.jsonl', '.jsonl'],
                            },
                        },
                    ],
                });

                await streamWorkspaceExport({
                    db: getDb(),
                    fileHandle,
                    chunkSize: STREAM_CHUNK_SIZE,
                    onProgress: updateStreamProgress,
                });
            } else {
                const hasWindow = typeof window !== 'undefined';
                const hasWritableStream =
                    hasWindow && 'WritableStream' in window;
                const hasNavigator = typeof navigator !== 'undefined';
                const hasServiceWorker =
                    hasNavigator && 'serviceWorker' in navigator;

                if (!(hasWindow && hasWritableStream && hasServiceWorker)) {
                    throw err(
                        'ERR_INTERNAL',
                        'Streaming export requires File System Access API or StreamSaver support.',
                        { tags: { domain: 'db', action: 'export' } }
                    );
                }

                const streamSaverModule = await loadStreamSaver();
                // StreamSaver module may have default export or direct export
                const streamSaverModuleWithDefault = streamSaverModule as { default?: typeof import('streamsaver') } | typeof import('streamsaver') | null;
                const streamSaver = streamSaverModuleWithDefault && 'default' in streamSaverModuleWithDefault 
                    ? streamSaverModuleWithDefault.default 
                    : streamSaverModuleWithDefault;

                if (!streamSaver) {
                    throw err(
                        'ERR_INTERNAL',
                        'StreamSaver is unavailable; streaming export cannot continue.',
                        { tags: { domain: 'db', action: 'export' } }
                    );
                }

                const streamSaverApi =
                    streamSaver as typeof import('streamsaver');

                const localMitmUrl = `${window.location.origin}/streamsaver/mitm.html?version=2.0.0`;
                if (streamSaverApi.mitm !== localMitmUrl) {
                    streamSaverApi.mitm = localMitmUrl;
                }
                const fileStream = streamSaverApi.createWriteStream(
                    suggestedName,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Disposition': `attachment; filename="${suggestedName}"`,
                        },
                    } as unknown as Parameters<typeof streamSaverApi.createWriteStream>[1]
                );

                const writer =
                    typeof fileStream.getWriter === 'function'
                        ? fileStream.getWriter()
                        : null;

                if (!writer) {
                    throw err(
                        'ERR_INTERNAL',
                        'StreamSaver returned an unsupported stream writer.',
                        { tags: { domain: 'db', action: 'export' } }
                    );
                }

                await streamWorkspaceExportToWritable({
                    db: getDb(),
                    writable: writer,
                    chunkSize: STREAM_CHUNK_SIZE,
                    onProgress: updateStreamProgress,
                });
            }

            state.currentStep.value = 'done';
            state.progress.value = 100;

            await hooks.doAction('workspace.backup.export:action:after', {
                ...exportTelemetry,
                durationMs: Date.now() - exportStartedAt,
            });
        } catch (e) {
            const error = e as DOMException;
            if (error.name === 'AbortError') {
                state.currentStep.value = 'idle';
                state.progress.value = 0;
                await hooks.doAction(
                    'workspace.backup.export:action:cancelled',
                    {
                        ...exportTelemetry,
                        durationMs: Date.now() - exportStartedAt,
                    }
                );
            } else {
                state.error.value = asAppError(e);
                state.currentStep.value = 'error';
                reportError(state.error.value, {
                    code: 'ERR_DB_READ_FAILED',
                    message: 'Failed to export workspace.',
                    tags: { domain: 'db', action: 'export' },
                });
                await hooks.doAction('workspace.backup.export:action:error', {
                    ...exportTelemetry,
                    durationMs: Date.now() - exportStartedAt,
                    error: state.error.value,
                });
            }
        } finally {
            state.isExporting.value = false;
        }
    }

    async function peekBackup(file: Blob): Promise<void> {
        if (typeof window === 'undefined') {
            state.error.value = err(
                'ERR_INTERNAL',
                'Workspace backup inspection requires a browser environment.',
                { tags: { domain: 'db', action: 'peek' } }
            );
            state.currentStep.value = 'error';
            return;
        }
        state.currentStep.value = 'peeking';
        state.error.value = null;

        const fileWithName = file as Blob & { name?: string };
        const fileName =
            typeof fileWithName.name === 'string' ? fileWithName.name : null;
        const peekStartedAt = Date.now();
        const peekTelemetryBase = {
            fileName,
        };

        await hooks.doAction('workspace.backup.peek:action:before', {
            ...peekTelemetryBase,
        });

        try {
            const format = await detectWorkspaceBackupFormat(file);
            let metadata!: ImportMetadata;
            let resolvedFormat!: 'stream' | 'dexie';

            if (format === 'dexie') {
                const { peakImportFile } = await loadDexieExportImport();
                const meta = await peakImportFile(file);
                metadata = validateBackupMeta(meta);
                resolvedFormat = 'dexie';
            } else if (format === 'stream') {
                const header = await peekWorkspaceBackupMetadata(file);
                validateStreamHeader(header);
                metadata = {
                    databaseName: header.databaseName,
                    databaseVersion: header.databaseVersion,
                    tables: header.tables.map((table) => ({
                        name: table.name,
                        rowCount: table.rowCount,
                    })),
                };
                resolvedFormat = 'stream';
            } else {
                throw err('ERR_VALIDATION', 'Unrecognized backup format.', {
                    tags: { domain: 'db', action: 'peek' },
                });
            }

            state.backupMeta.value = metadata;
            state.backupFormat.value = resolvedFormat;
            state.currentStep.value = 'confirm';

            await hooks.doAction('workspace.backup.peek:action:after', {
                ...peekTelemetryBase,
                format: resolvedFormat,
                metadata,
                durationMs: Date.now() - peekStartedAt,
            });
        } catch (e) {
            state.error.value = asAppError(e);
            state.currentStep.value = 'error';
            reportError(state.error.value, {
                code: 'ERR_VALIDATION',
                message: 'Invalid backup file.',
                tags: { domain: 'db', action: 'peek' },
            });
            await hooks.doAction('workspace.backup.peek:action:error', {
                ...peekTelemetryBase,
                error: state.error.value,
                durationMs: Date.now() - peekStartedAt,
            });
        }
    }

    async function importWorkspace(file: Blob): Promise<void> {
        if (state.isImporting.value || state.isExporting.value) return;
        if (typeof window === 'undefined') {
            state.error.value = err(
                'ERR_INTERNAL',
                'Workspace import requires a browser environment.',
                { tags: { domain: 'db', action: 'import' } }
            );
            return;
        }
        state.isImporting.value = true;
        state.currentStep.value = 'importing';
        state.progress.value = 0;
        state.error.value = null;

        const fileWithName = file as Blob & { name?: string };
        const fileName =
            typeof fileWithName.name === 'string' ? fileWithName.name : null;
        const baseImportTelemetry = {
            fileName,
            mode: state.importMode.value,
            overwrite: state.overwriteValues.value,
        };
        let importTelemetry = {
            ...baseImportTelemetry,
            format: 'unknown' as 'stream' | 'dexie' | 'unknown',
        };
        const importStartedAt = Date.now();

        try {
            const format =
                state.backupFormat.value ??
                (await detectWorkspaceBackupFormat(file));

            importTelemetry = { ...baseImportTelemetry, format };

            await hooks.doAction(
                'workspace.backup.import:action:before',
                importTelemetry
            );

            if (format === 'stream') {
                await importWorkspaceStream({
                    db: getDb(),
                    file,
                    clearTables: state.importMode.value === 'replace',
                    overwriteValues:
                        state.importMode.value === 'replace'
                            ? true
                            : state.overwriteValues.value,
                    onProgress: (progress: WorkspaceBackupProgress) => {
                        const total = progress.totalTables + progress.totalRows;
                        const completed =
                            progress.completedTables + progress.completedRows;
                        state.progress.value =
                            total > 0
                                ? Math.round((completed / total) * 100)
                                : 0;
                    },
                });
            } else if (format === 'dexie') {
                const { importInto } = await loadDexieExportImport();
                interface DexieImportProgress {
                    totalTables: number;
                    totalRows?: number;
                    completedTables: number;
                    completedRows?: number;
                }
                const baseOptions = {
                    chunkSizeBytes: DEFAULT_KILOBYTES_PER_CHUNK,
                    progressCallback: (progress: DexieImportProgress) => {
                        const total =
                            progress.totalTables + (progress.totalRows ?? 0);
                        const completed =
                            progress.completedTables +
                            (progress.completedRows ?? 0);
                        state.progress.value =
                            total > 0
                                ? Math.round((completed / total) * 100)
                                : 0;
                        return false; // continue
                    },
                };

                if (state.importMode.value === 'replace') {
                    await importInto(getDb(), file, {
                        ...baseOptions,
                        clearTablesBeforeImport: true,
                    });
                } else {
                    await importInto(getDb(), file, {
                        ...baseOptions,
                        clearTablesBeforeImport: false,
                        overwriteValues: state.overwriteValues.value,
                    });
                }
            } else {
                throw err('ERR_VALIDATION', 'Unsupported backup format.', {
                    tags: { domain: 'db', action: 'import' },
                });
            }

            state.currentStep.value = 'done';
            state.progress.value = 100;

            await hooks.doAction('workspace.backup.import:action:after', {
                ...importTelemetry,
                durationMs: Date.now() - importStartedAt,
            });

            await hooks.doAction('workspace:reloaded');
        } catch (e) {
            const error = asAppError(e);
            state.error.value = error;
            state.currentStep.value = 'error';
            
            // Categorize error type for better user feedback
            let errorCode: ErrorCode = 'ERR_DB_WRITE_FAILED';
            const errorMessage = error.message.toLowerCase();
            
            if (
                errorMessage.includes('quota') ||
                errorMessage.includes('storage') ||
                errorMessage.includes('exceeded')
            ) {
                errorCode = 'ERR_DB_QUOTA_EXCEEDED';
            } else if (
                errorMessage.includes('validation') ||
                errorMessage.includes('invalid') ||
                errorMessage.includes('schema') ||
                errorMessage.includes('parse')
            ) {
                errorCode = 'ERR_VALIDATION';
            } else if (
                errorMessage.includes('permission') ||
                errorMessage.includes('denied')
            ) {
                errorCode = 'ERR_AUTH';
            }
            
            reportError(error, {
                code: errorCode,
                message: 'Failed to import workspace.',
                tags: { domain: 'db', action: 'import' },
            });
            await hooks.doAction('workspace.backup.import:action:error', {
                ...importTelemetry,
                durationMs: Date.now() - importStartedAt,
                error: state.error.value,
            });
        } finally {
            state.isImporting.value = false;
        }
    }

    return {
        state,
        exportWorkspace,
        peekBackup,
        importWorkspace,
        reset,
    };
}

function validateStreamHeader(header: WorkspaceBackupHeaderLine) {
    // These comparisons validate external data against known constants
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (header.format !== WORKSPACE_BACKUP_FORMAT) {
        throw err('ERR_VALIDATION', 'Invalid backup format.', {
            tags: { domain: 'db', action: 'validate' },
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (header.version !== WORKSPACE_BACKUP_VERSION) {
        throw err(
            'ERR_VALIDATION',
            'Unsupported backup version. Please update the app.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
    if (header.databaseName !== 'or3-db') {
        throw err('ERR_VALIDATION', 'Backup is for a different database.', {
            tags: { domain: 'db', action: 'validate' },
        });
    }
    if (header.databaseVersion > getDb().verno) {
        throw err(
            'ERR_VALIDATION',
            'Backup is from a newer app version. Please update.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
}
