<template>
    <div
        id="dashboard-workspace-backup-container"
        class="dashboard-page-frame workspace-backup text-sm"
    >
        <p ref="liveRegion" class="sr-only" aria-live="polite"></p>
        <!-- The dashboard header already shows the page title. -->
        <h1 class="dashboard-page-title sr-only">Backup and restore</h1>

        <section
            id="dashboard-workspace-export-section"
            class="dashboard-list-group"
            aria-labelledby="workspace-backup-export"
        >
            <h3 id="workspace-backup-export" class="dashboard-list-heading">
                Export
            </h3>
            <div class="dashboard-list">
                <DashboardListRow
                    static
                    :icon="iconBackup"
                    label="Export workspace"
                    :description="
                        cloud
                            ? 'Download an archive with original files'
                            : 'Download a backup of this browser’s data'
                    "
                >
                    <UProgress
                        v-if="exporting"
                        v-bind="progressProps"
                        class="mt-2"
                        size="xs"
                        :value="state.progress"
                        :max="100"
                    />
                    <template #trailing>
                        <UButton
                            v-bind="exportButtonProps"
                            :disabled="!canExport"
                            :loading="exporting"
                            @click="onExport"
                        >
                            Export
                        </UButton>
                    </template>
                </DashboardListRow>
            </div>
            <p
                v-if="exportStatusText"
                class="dashboard-list-footnote"
                :class="{ 'text-error': lastExportStatus === 'error' }"
                :role="lastExportStatus === 'error' ? 'alert' : 'status'"
            >
                {{ exportStatusText }}
            </p>
            <p v-if="cloud" class="dashboard-list-footnote">
                Finish syncing and uploading first.
            </p>
        </section>

        <section
            id="dashboard-workspace-import-section"
            class="dashboard-list-group"
            aria-labelledby="workspace-backup-import"
        >
            <h3 id="workspace-backup-import" class="dashboard-list-heading">
                {{ cloud ? 'Restore' : 'Import' }}
            </h3>
            <input
                ref="fileInput"
                type="file"
                :accept="cloud ? '.or3cloud' : 'application/json,.json,.jsonl,.or3.jsonl'"
                class="hidden"
                @change="onFilePicked"
            />
            <div class="dashboard-list">
                <DashboardListRow
                    static
                    :icon="iconUpload"
                    :label="selectedFile ? selectedFile.name : 'Backup file'"
                    :description="fileDescription"
                >
                    <template #trailing>
                        <div class="flex items-center gap-1.5">
                            <UButton
                                v-bind="browseButtonProps"
                                :disabled="importing || peeking"
                                @click="onBrowse"
                            >
                                {{ selectedFile ? 'Change' : 'Choose file' }}
                            </UButton>
                            <UButton
                                v-if="selectedFile"
                                :icon="iconClose"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                square
                                aria-label="Clear selected file"
                                :disabled="importing || peeking"
                                @click="clearSelection"
                            />
                        </div>
                    </template>
                </DashboardListRow>
            </div>
            <p
                v-if="peekErrorMessage"
                class="dashboard-list-footnote text-error"
                role="alert"
            >
                {{ peekErrorMessage }}
            </p>
            <p v-else-if="cloud" class="dashboard-list-footnote">
                Restores into a new workspace and keeps your current one. Keep
                this page open until it finishes.
            </p>
        </section>

        <section
            v-if="!cloud && backupMeta"
            id="dashboard-workspace-mode-section"
            class="dashboard-list-group"
            aria-labelledby="workspace-backup-mode"
        >
            <h3 id="workspace-backup-mode" class="dashboard-list-heading">
                Import mode
            </h3>
            <div class="dashboard-list" role="group" aria-labelledby="workspace-backup-mode">
                <DashboardListRow
                    v-for="option in importModeOptions"
                    :key="option.value"
                    :label="option.label"
                    :description="option.description"
                    :selected="importMode === option.value"
                    @click="importModeModel = option.value"
                />
                <DashboardListRow
                    v-if="importMode === 'append'"
                    static
                    label="Overwrite conflicts"
                    description="Replace records that already exist"
                >
                    <template #trailing>
                        <USwitch
                            v-model="overwriteValuesModel"
                            aria-label="Overwrite conflicting records"
                        />
                    </template>
                </DashboardListRow>
            </div>
            <p
                v-if="importWarningMessage"
                class="dashboard-list-footnote text-error"
                role="note"
            >
                {{ importWarningMessage }}
            </p>
        </section>

        <section
            v-if="selectedFile"
            id="dashboard-workspace-confirm-section"
            class="dashboard-list-group"
        >
            <UProgress
                v-if="importing"
                v-bind="progressProps"
                size="xs"
                :value="state.progress"
                :max="100"
            />
            <p
                v-if="importErrorMessage"
                class="dashboard-list-footnote text-error"
                role="alert"
            >
                {{ importErrorMessage }}
            </p>
            <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="dashboard-list-footnote tabular-nums">{{ importStatusText }}</span>
                <UButton
                    v-bind="importButtonProps"
                    :disabled="!canImport"
                    :loading="importing"
                    @click="onImport"
                >
                    {{ cloud ? 'Restore' : 'Import' }}
                </UButton>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
    useWorkspaceBackup,
    type WorkspaceImportMode,
} from '~/composables/core/useWorkspaceBackup';
import { useIcon } from '~/composables/useIcon';
import DashboardListRow from '../DashboardListRow.vue';
import { err, reportError, type AppError } from '~/utils/errors';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { isCloudWorkspaceBackupEnabled } from '~/core/storage/file-policy';
const cloud = isCloudWorkspaceBackupEnabled();

const iconBackup = useIcon('dashboard.backup');
const iconUpload = useIcon('ui.upload');
const iconClose = useIcon('ui.close');

const liveRegion = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);

const lastExportAt = ref<Date | null>(null);
const lastImportAt = ref<Date | null>(null);

const lastExportStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle');
const lastImportStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle');

const exportError = ref<AppError | null>(null);
const importError = ref<AppError | null>(null);
const peekError = ref<AppError | null>(null);

const pendingAction = ref<'export' | 'import' | 'peek' | null>(null);

const { state, exportWorkspace, peekBackup, importWorkspace, reset } =
    useWorkspaceBackup();

// Theme overrides for buttons
const exportButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.workspace.export',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        class: 'text-[var(--md-on-surface)]',
        ...(overrides.value as any),
    };
});

const browseButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.workspace.browse',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        ...(overrides.value as any),
    };
});

const importButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.workspace.import',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        color: 'primary' as const,
        type: 'button' as const,
        ...(overrides.value as any),
    };
});

const progressProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'progress',
        context: 'dashboard',
        identifier: 'dashboard.workspace.progress',
        isNuxtUI: true,
    });
    return overrides.value || {};
});

const importing = computed(() => state.isImporting.value);
const exporting = computed(() => state.isExporting.value);
const peeking = computed(() => state.currentStep.value === 'peeking');

const busy = computed(
    () => importing.value || exporting.value || peeking.value
);

const backupMeta = computed(() => state.backupMeta.value);
const importModeModel = computed<WorkspaceImportMode>({
    get: () => state.importMode.value,
    set: (value) => {
        state.importMode.value = value;
    },
});

const overwriteValuesModel = computed({
    get: () => state.overwriteValues.value,
    set: (value: boolean) => {
        state.overwriteValues.value = value;
    },
});

const importMode = computed(() => importModeModel.value);
const overwriteValues = computed(() => overwriteValuesModel.value);

const canExport = computed(
    () => !busy.value && !exporting.value && !importing.value
);
const canImport = computed(
    () =>
        !!backupMeta.value &&
        !!selectedFile.value &&
        !exporting.value &&
        !importing.value &&
        !peeking.value
);

const exportStatusText = computed(() => {
    if (exporting.value)
        return `Creating backup… ${Math.round(state.progress.value)}%`;
    if (lastExportStatus.value === 'done' && lastExportAt.value)
        return `Last export ${formatDate(lastExportAt.value)}`;
    if (lastExportStatus.value === 'error')
        return exportError.value?.message || 'Export failed';
    return '';
});

const importStatusText = computed(() => {
    if (importing.value)
        return `Applying backup… ${Math.round(state.progress.value)}%`;
    if (peeking.value) return 'Checking backup…';
    if (lastImportStatus.value === 'done' && lastImportAt.value)
        return `Last import ${formatDate(lastImportAt.value)}`;
    // The error alert above the button carries the details.
    if (lastImportStatus.value === 'error') return 'Import failed';
    return '';
});

const importWarning = computed(() =>
    !cloud && importMode.value === 'replace'
        ? 'Replace clears all current workspace data. Export first if you need it.'
        : ''
);

const importWarningMessage = computed(() => importWarning.value.trim());
const importErrorMessage = computed(
    () => importError.value?.message?.trim() ?? ''
);
const peekErrorMessage = computed(() => peekError.value?.message?.trim() ?? '');

const overwriteDisabled = computed(() => importMode.value !== 'append');

const importModeOptions: Array<{
    value: WorkspaceImportMode;
    label: string;
    description: string;
}> = [
    {
        value: 'append',
        label: 'Append & merge',
        description: 'Keep existing records and add the backup’s',
    },
    {
        value: 'replace',
        label: 'Replace workspace',
        description: 'Clear local data, then restore the backup',
    },
];

const fileDescription = computed(() => {
    const file = selectedFile.value;
    if (!file) return cloud ? 'An .or3cloud archive' : 'A .jsonl or .json backup';
    const size = formatBytes(file.size);
    if (peeking.value) return `${size} · Validating…`;
    if (peekError.value) return `${size} · Not a valid backup`;
    const tables = backupMeta.value?.tables ?? [];
    if (!backupMeta.value) return size;
    if (cloud || !tables.length) return `${size} · Valid backup`;
    const rows = tables.reduce((total, table) => total + table.rowCount, 0);
    return `${size} · ${formatNumber(rows)} saved items`;
});

const exportStatusFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});
const numberFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
});

const lastAnnouncement = ref('');

function announce(message: string) {
    if (!message || lastAnnouncement.value === message) return;
    lastAnnouncement.value = message;
    if (liveRegion.value) liveRegion.value.textContent = message;
}

function formatDate(value: Date) {
    return exportStatusFormatter.format(value);
}

function formatBytes(size: number) {
    if (!Number.isFinite(size) || size < 0) return '';
    if (size === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    let value = size;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    const digits = value < 10 && index > 0 ? 1 : 0;
    return `${value.toFixed(digits)} ${units[index]}`;
}

function formatNumber(value: number) {
    return numberFormatter.format(value);
}

function resetFileInputValue() {
    if (fileInput.value) fileInput.value.value = '';
}

function clearSelection() {
    resetFileInputValue();
    selectedFile.value = null;
    peekError.value = null;
    if (!importing.value && !exporting.value) {
        reset();
        if (pendingAction.value === 'peek') pendingAction.value = null;
    }
}

async function onFilePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || file === selectedFile.value) {
        if (!file) {
            announce('No file selected.');
            clearSelection();
        }
        return;
    }
    pendingAction.value = 'peek';
    selectedFile.value = file;
    peekError.value = null;
    // A previous file's import failure does not describe this one.
    importError.value = null;
    if (lastImportStatus.value === 'error') lastImportStatus.value = 'idle';
    announce(`Selected backup file ${file.name}. Validating…`);
    await peekBackup(file);
    if (pendingAction.value === 'peek' && !peeking.value) {
        pendingAction.value = null;
    }
}

function onBrowse() {
    resetFileInputValue();
    fileInput.value?.click();
}

async function onExport() {
    if (!canExport.value) return;
    pendingAction.value = 'export';
    lastExportStatus.value = 'running';
    exportError.value = null;
    announce('Starting workspace export.');
    await exportWorkspace();
    if (pendingAction.value === 'export' && !exporting.value) {
        // Operation likely aborted due to guard; reset pending flag.
        pendingAction.value = null;
        if (lastExportStatus.value === 'running') {
            lastExportStatus.value = 'idle';
        }
    }
}

async function onImport() {
    if (!canImport.value) {
        reportError(
            err(
                'ERR_VALIDATION',
                'Select and validate a backup before importing.',
                {
                    tags: { domain: 'db', action: 'import' },
                }
            ),
            { toast: true }
        );
        announce('Import aborted: no validated backup.');
        return;
    }
    const file = selectedFile.value;
    if (!file) return;
    pendingAction.value = 'import';
    lastImportStatus.value = 'running';
    importError.value = null;
    announce('Starting workspace import.');
    await importWorkspace(file);
    if (pendingAction.value === 'import' && !importing.value) {
        pendingAction.value = null;
        if (lastImportStatus.value === 'running') {
            lastImportStatus.value = 'idle';
        }
    }
}

watch(importModeModel, (mode, previous) => {
    if (mode !== previous) {
        const label =
            mode === 'replace'
                ? 'Replace workspace mode selected.'
                : 'Append & merge mode selected.';
        announce(label);
    }
    if (mode === 'replace') {
        overwriteValuesModel.value = false;
    }
});

watch(overwriteValuesModel, (value, previous) => {
    if (value === previous) return;
    if (overwriteDisabled.value) return;
    announce(
        value
            ? 'Overwrite conflicts enabled for append mode.'
            : 'Overwrite conflicts disabled; a conflict aborts the import.'
    );
});

watch(
    () => state.currentStep.value,
    (step, previous) => {
        if (step === 'error') {
            if (pendingAction.value === 'export') {
                lastExportStatus.value = 'error';
                exportError.value = state.error.value;
                announce(
                    `Workspace export failed${
                        state.error.value?.message
                            ? `: ${state.error.value.message}`
                            : ''
                    }`
                );
                pendingAction.value = null;
            } else if (pendingAction.value === 'import') {
                lastImportStatus.value = 'error';
                importError.value = state.error.value;
                announce(
                    `Workspace import failed${
                        state.error.value?.message
                            ? `: ${state.error.value.message}`
                            : ''
                    }`
                );
                pendingAction.value = null;
            } else if (previous === 'peeking') {
                peekError.value = state.error.value;
                announce(
                    `Backup validation failed${
                        state.error.value?.message
                            ? `: ${state.error.value.message}`
                            : ''
                    }`
                );
                pendingAction.value = null;
            }
            return;
        }

        if (pendingAction.value === 'peek' && step === 'confirm') {
            announce('Backup checked successfully.');
            pendingAction.value = null;
            peekError.value = null;
            return;
        }

        if (step === 'done' && pendingAction.value) {
            if (pendingAction.value === 'export') {
                lastExportStatus.value = 'done';
                lastExportAt.value = new Date();
                exportError.value = null;
                announce('Workspace export completed.');
            } else if (pendingAction.value === 'import') {
                lastImportStatus.value = 'done';
                lastImportAt.value = new Date();
                importError.value = null;
                announce('Workspace import completed.');
            }
            pendingAction.value = null;
        }
    }
);

watch(
    () => state.progress.value,
    (progress) => {
        const pct = Number.isFinite(progress) ? Math.round(progress) : 0;
        if (exporting.value) {
            announce(`Export progress ${pct} percent.`);
        } else if (importing.value) {
            announce(`Import progress ${pct} percent.`);
        }
    }
);

watch(
    () => state.error.value,
    (errValue) => {
        if (!errValue) return;
        if (!pendingAction.value) {
            announce(`Workspace backup error: ${errValue.message}`);
        }
    }
);

onBeforeUnmount(() => {
    reset();
    selectedFile.value = null;
    pendingAction.value = null;
});

defineExpose({
    clearSelection,
});
</script>

<style scoped>
.workspace-backup {
    gap: 28px;
}
</style>
