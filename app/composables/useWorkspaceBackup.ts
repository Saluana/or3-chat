import { ref, type Ref } from 'vue';
import { db } from '~/db/client';
import { reportError, err, asAppError } from '~/utils/errors';
import { useHooks } from '~/composables/useHooks';
import type { ExportProgress } from 'dexie-export-import';

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

const DEFAULT_ROWS_PER_CHUNK = 2000;
const DEFAULT_KILOBYTES_PER_CHUNK = 1024;

let dexieExportImportPromise: Promise<
    typeof import('dexie-export-import')
> | null = null;

function loadDexieExportImport() {
    if (!import.meta.client) {
        throw err(
            'ERR_INTERNAL',
            'Workspace backup is only available in the browser.',
            { tags: { domain: 'db', action: 'ssr' } }
        );
    }
    if (!dexieExportImportPromise) {
        dexieExportImportPromise = import('dexie-export-import');
    }
    return dexieExportImportPromise;
}

function validateBackupMeta(meta: any): ImportMetadata {
    if (meta.formatName !== 'dexie') {
        throw err(
            'ERR_VALIDATION',
            'Invalid backup format. Expected Dexie format.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
    if (meta.formatVersion !== 1) {
        throw err(
            'ERR_VALIDATION',
            'Unsupported backup version. Please update the app.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
    if (meta.data.databaseName !== 'or3-db') {
        throw err('ERR_VALIDATION', 'Backup is for a different database.', {
            tags: { domain: 'db', action: 'validate' },
        });
    }
    if (meta.data.databaseVersion > db.verno) {
        throw err(
            'ERR_VALIDATION',
            'Backup is from a newer app version. Please update.',
            {
                tags: { domain: 'db', action: 'validate' },
            }
        );
    }
    return meta.data;
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
        error: ref(null),
    };

    function reset() {
        state.isExporting.value = false;
        state.isImporting.value = false;
        state.progress.value = 0;
        state.currentStep.value = 'idle';
        state.backupMeta.value = null;
        state.error.value = null;
    }

    async function exportWorkspace(): Promise<void> {
        if (state.isExporting.value || state.isImporting.value) return;
        if (!import.meta.client) {
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

        try {
            const { exportDB } = await loadDexieExportImport();
            const blob = await exportDB(db, {
                numRowsPerChunk: DEFAULT_ROWS_PER_CHUNK,
                progressCallback: (progress: ExportProgress) => {
                    const total =
                        progress.totalTables + (progress.totalRows || 0);
                    const completed =
                        progress.completedTables +
                        (progress.completedRows || 0);
                    state.progress.value =
                        total > 0 ? Math.round((completed / total) * 100) : 0;
                    return false; // continue
                },
            });

            // Trigger download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `or3-workspace-${new Date()
                .toISOString()
                .slice(0, 19)
                .replace(/:/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            state.currentStep.value = 'done';
            state.progress.value = 100;
        } catch (e) {
            state.error.value = asAppError(e);
            state.currentStep.value = 'error';
            reportError(state.error.value, {
                code: 'ERR_DB_READ_FAILED',
                message: 'Failed to export workspace.',
                tags: { domain: 'db', action: 'export' },
            });
        } finally {
            state.isExporting.value = false;
        }
    }

    async function peekBackup(file: Blob): Promise<void> {
        if (!import.meta.client) {
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
        try {
            const { peakImportFile } = await loadDexieExportImport();
            const meta = await peakImportFile(file);
            state.backupMeta.value = validateBackupMeta(meta);
            state.currentStep.value = 'confirm';
        } catch (e) {
            state.error.value = asAppError(e);
            state.currentStep.value = 'error';
            reportError(state.error.value, {
                code: 'ERR_VALIDATION',
                message: 'Invalid backup file.',
                tags: { domain: 'db', action: 'peek' },
            });
        }
    }

    async function importWorkspace(file: Blob): Promise<void> {
        if (state.isImporting.value || state.isExporting.value) return;
        if (!import.meta.client) {
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

        try {
            const { importInto } = await loadDexieExportImport();
            const baseOptions = {
                chunkSizeBytes: DEFAULT_KILOBYTES_PER_CHUNK,
                progressCallback: (progress: any) => {
                    const total =
                        progress.totalTables + (progress.totalRows || 0);
                    const completed =
                        progress.completedTables +
                        (progress.completedRows || 0);
                    state.progress.value =
                        total > 0 ? Math.round((completed / total) * 100) : 0;
                    return false; // continue
                },
            };

            if (state.importMode.value === 'replace') {
                await importInto(db, file, {
                    ...baseOptions,
                    clearTablesBeforeImport: true,
                });
            } else {
                await importInto(db, file, {
                    ...baseOptions,
                    clearTablesBeforeImport: false,
                    overwriteValues: state.overwriteValues.value,
                });
            }

            // Invalidate caches
            hooks.doAction('workspace:reloaded');

            state.currentStep.value = 'done';
            state.progress.value = 100;
        } catch (e) {
            state.error.value = asAppError(e);
            state.currentStep.value = 'error';
            reportError(state.error.value, {
                code: 'ERR_DB_WRITE_FAILED',
                message: 'Failed to import workspace.',
                tags: { domain: 'db', action: 'import' },
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
