<template>
    <div
        id="dashboard-workspace-backup-container"
        class="px-4 py-4 space-y-10 text-sm"
    >
        <p ref="liveRegion" class="sr-only" aria-live="polite"></p>

        <section
            id="dashboard-workspace-guidance-section"
            class="section-card space-y-3"
            role="group"
            aria-labelledby="workspace-backup-guidance"
        >
            <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="space-y-2 max-w-prose">
                    <h2
                        id="workspace-backup-guidance"
                        class="font-heading text-base uppercase tracking-wide group-heading"
                    >
                        Workspace backup
                    </h2>
                    <p class="supporting-text">
                        Export your entire on-device workspace before making
                        risky changes, and keep the backup in a safe location.
                        Restoring a backup replaces or merges everything in the
                        app, so double-check selections before importing.
                    </p>
                </div>
                <div></div>
            </div>
            <UAlert
                v-bind="alertProps"
                color="warning"
                variant="subtle"
                icon="pixelarticons:warning-box"
                class="text-xs"
                title="Always create a fresh export before importing a backup—replace mode wipes current data."
            />
        </section>

        <section
            id="dashboard-workspace-export-section"
            class="section-card space-y-4"
            role="group"
            aria-labelledby="workspace-backup-export"
        >
            <div class="flex items-center justify-between gap-3 flex-wrap">
                <h3
                    id="workspace-backup-export"
                    class="font-heading text-base uppercase tracking-wide group-heading"
                >
                    Export workspace
                </h3>
                <div></div>
            </div>
            <p class="supporting-text">
                Downloads a timestamped JSONL backup of the entire IndexedDB.
                Large workspaces stream directly to disk to avoid freezing the
                UI.
            </p>
            <div class="space-y-2">
                <UProgress
                    v-bind="progressProps"
                    v-if="exporting"
                    size="xs"
                    :value="state.progress"
                    :max="100"
                />
            </div>
            <div class="flex items-center flex-wrap justify-between gap-3">
                <UButton
                    v-bind="exportButtonProps"
                    :disabled="!canExport"
                    :loading="exporting"
                    @click="onExport"
                >
                    <UIcon
                        name="pixelarticons:briefcase-download"
                        class="h-4 w-4 mr-0.5"
                    />
                    Export workspace
                </UButton>
                <span class="opacity-80 text-xs">{{ exportStatusText }}</span>
            </div>
        </section>

        <section
            id="dashboard-workspace-import-section"
            class="section-card space-y-4"
            role="group"
            aria-labelledby="workspace-backup-import"
        >
            <div class="flex items-center justify-between gap-3 flex-wrap">
                <h3
                    id="workspace-backup-import"
                    class="font-heading text-base uppercase tracking-wide group-heading"
                >
                    Import workspace
                </h3>
                <span class="text-xs opacity-70 tabular-nums">
                    {{ importStatusText }}
                </span>
            </div>
            <p class="supporting-text">
                Validate a backup file, choose an import mode, and restore your
                data. Append keeps current records; replace wipes everything
                first.
            </p>
            <div class="space-y-4">
                <div class="theme-upload-panel">
                    <input
                        ref="fileInput"
                        type="file"
                        accept="application/json,.json,.jsonl,.or3.jsonl"
                        class="hidden"
                        @change="onFilePicked"
                    />
                    <div
                        class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                        <div
                            class="flex items-start gap-3 text-left cursor-pointer"
                            role="button"
                            tabindex="0"
                            @click="handleUploadPanelClick"
                            @keydown.enter.prevent="handleUploadPanelClick"
                            @keydown.space.prevent="handleUploadPanelClick"
                        >
                            <UIcon
                                name="pixelarticons:cloud-upload"
                                class="theme-upload-icon"
                                aria-hidden="true"
                            />
                            <div class="space-y-1">
                                <p
                                    class="font-heading text-xs uppercase tracking-[0.14em] text-[var(--md-on-surface)]"
                                >
                                    Select backup file
                                </p>
                                <p class="text-xs opacity-70 leading-snug">
                                    {{ selectedFileSummary }}
                                </p>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                v-bind="browseButtonProps"
                                :disabled="importing || peeking"
                                @click="onBrowse"
                            >
                                Browse
                            </UButton>
                            <UButton
                                v-if="selectedFile"
                                v-bind="clearFileButtonProps"
                                :disabled="importing || peeking"
                                @click="clearSelection"
                            >
                                Clear
                            </UButton>
                        </div>
                    </div>

                    <Transition name="fade">
                        <div
                            v-if="selectedFile"
                            class="theme-file-card"
                            aria-live="polite"
                        >
                            <div class="space-y-1">
                                <p class="font-semibold text-sm leading-tight">
                                    {{ selectedFile.name }}
                                </p>
                                <p class="text-xs opacity-70">
                                    Size • {{ formatBytes(selectedFile.size) }}
                                </p>
                            </div>
                            <UBadge
                                v-bind="badgeProps"
                                icon="i-ph-file-duotone"
                                :class="[
                                    'theme-badge',
                                    badgeToneClass(fileBadgeColor),
                                ]"
                            >
                                {{ fileBadgeLabel }}
                            </UBadge>
                        </div>
                    </Transition>
                </div>

                <UAlert
                    v-bind="alertProps"
                    v-if="peeking"
                    color="primary"
                    variant="subtle"
                    icon="pixelarticons:hourglass"
                    class="text-xs"
                    title="Validating backup metadata…"
                />
                <UAlert
                    v-bind="alertProps"
                    v-if="peekErrorMessage"
                    color="error"
                    variant="subtle"
                    icon="pixelarticons:warning-box"
                    class="text-xs"
                    :title="peekErrorMessage"
                />

                <Transition name="fade">
                    <div
                        v-if="backupMeta"
                        class="theme-meta-panel"
                        aria-live="polite"
                    >
                        <div class="flex items-center justify-between">
                            <div class="space-y-1">
                                <p
                                    class="text-xs font-semibold uppercase tracking-wide"
                                >
                                    {{ backupMeta.databaseName }}
                                </p>
                                <p class="text-[11px] opacity-70">
                                    Schema version
                                    {{ backupMeta.databaseVersion }}
                                </p>
                            </div>
                            <UBadge
                                icon="i-ph-database-duotone"
                                :class="[
                                    'theme-badge',
                                    badgeToneClass('primary'),
                                ]"
                            >
                                {{ formatNumber(backupMeta.tables.length) }}
                                tables
                            </UBadge>
                        </div>
                        <div
                            class="theme-meta-table"
                            role="list"
                            aria-label="Tables included in backup"
                        >
                            <div
                                v-for="table in backupMeta.tables"
                                :key="table.name"
                                class="theme-meta-row"
                                role="listitem"
                            >
                                <span>{{ table.name }}</span>
                                <span class="tabular-nums">
                                    {{ formatNumber(table.rowCount) }} rows
                                </span>
                            </div>
                        </div>
                    </div>
                </Transition>

                <div class="space-y-3">
                    <div class="space-y-2">
                        <p
                            class="text-xs font-semibold uppercase tracking-wide text-[var(--md-on-surface-variant)]"
                        >
                            Import mode
                        </p>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <UButton
                                v-for="option in importModeOptions"
                                :key="option.value"
                                v-bind="importModeButtonProps"
                                class="h-fit"
                                :class="{
                                    'bg-primary/20 hover:bg-primary/20':
                                        importMode === option.value,
                                }"
                                block
                                @click="importModeModel = option.value"
                                :aria-pressed="importMode === option.value"
                            >
                                <div class="flex items-start gap-3 w-full">
                                    <UIcon
                                        :name="option.icon"
                                        class="theme-choice-icon"
                                        aria-hidden="true"
                                    />
                                    <div class="space-y-1 text-left">
                                        <p
                                            class="font-semibold text-sm leading-tight"
                                        >
                                            {{ option.label }}
                                        </p>
                                        <p
                                            class="text-xs opacity-80 leading-snug"
                                        >
                                            {{ option.description }}
                                        </p>
                                    </div>
                                    <UIcon
                                        v-if="importMode === option.value"
                                        name="i-ph-check-circle-duotone"
                                        class="ml-auto text-lg text-[var(--md-primary)]"
                                    />
                                </div>
                            </UButton>
                        </div>
                    </div>

                    <UCheckbox
                        v-bind="importCheckboxProps"
                        v-model="overwriteValuesModel"
                        size="sm"
                        :disabled="overwriteDisabled"
                        class="theme-checkbox"
                        label="Overwrite records on key conflict"
                        description="When disabled, conflicting rows are skipped and reported."
                    />
                </div>

                <UAlert
                    v-bind="alertProps"
                    v-if="importWarningMessage"
                    color="warning"
                    variant="subtle"
                    icon="pixelarticons:warning-box"
                    class="text-xs"
                    :title="importWarningMessage"
                />
                <UAlert
                    v-bind="alertProps"
                    v-if="importErrorMessage"
                    color="error"
                    variant="subtle"
                    icon="pixelarticons:warning-box"
                    class="text-xs"
                    :title="importErrorMessage"
                />

                <div class="space-y-2">
                    <UProgress
                        v-bind="progressProps"
                        v-if="importing"
                        size="xs"
                        :value="state.progress"
                        :max="100"
                    />
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3">
                    <UButton
                        v-bind="importButtonProps"
                        :disabled="!canImport"
                        :loading="importing"
                        @click="onImport"
                    >
                        <UIcon
                            name="pixelarticons:briefcase-upload"
                            class="h-4 w-4 mr-0.5"
                        />
                        Import workspace
                    </UButton>
                    <span class="text-xs opacity-70 tabular-nums">
                        {{ importStatusText }}
                    </span>
                </div>
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
import { err, reportError, type AppError } from '~/utils/errors';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const docsHref =
    'https://github.com/Saluana/or3-chat/blob/main/docs/UI/workspace-backup.md';

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

type BadgeTone =
    | 'neutral'
    | 'primary'
    | 'success'
    | 'error'
    | 'info'
    | 'warning';

function badgeToneClass(tone?: BadgeTone | null) {
    return tone ? `theme-badge--${tone}` : 'theme-badge--neutral';
}

// Theme overrides for buttons
const exportButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.workspace.export',
        isNuxtUI: true,
    });
    return {
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

const clearFileButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.workspace.clear-file',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        color: 'error' as const,
        variant: 'basic' as const,
        type: 'button' as const,
        ...(overrides.value as any),
    };
});

const importModeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.workspace.import-mode',
        isNuxtUI: true,
    });
    return {
        variant: 'ghost' as const,
        color: 'primary' as const,
        type: 'button' as const,
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
        variant: 'outline' as const,
        class: 'text-[var(--md-on-surface)]',
        type: 'button' as const,
        ...(overrides.value as any),
    };
});

const alertProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'alert',
        context: 'dashboard',
        identifier: 'dashboard.workspace.alert',
        isNuxtUI: true,
    });
    return overrides.value || {};
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

const badgeProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'badge',
        context: 'dashboard',
        identifier: 'dashboard.workspace.badge',
        isNuxtUI: true,
    });
    return overrides.value || {};
});

const importCheckboxProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'checkbox',
        context: 'dashboard',
        identifier: 'dashboard.workspace.checkbox',
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
        return `Streaming backup… ${Math.round(state.progress.value)}%`;
    if (lastExportStatus.value === 'done' && lastExportAt.value)
        return `Last export ${formatDate(lastExportAt.value)}`;
    if (lastExportStatus.value === 'error')
        return exportError.value?.message || 'Export failed';
    return 'Ready';
});

const importStatusText = computed(() => {
    if (importing.value)
        return `Applying backup… ${Math.round(state.progress.value)}%`;
    if (peeking.value) return 'Validating backup metadata…';
    if (lastImportStatus.value === 'done' && lastImportAt.value)
        return `Last import ${formatDate(lastImportAt.value)}`;
    if (lastImportStatus.value === 'error')
        return importError.value?.message || 'Import failed';
    return 'Awaiting backup';
});

const importWarning = computed(() => {
    if (importMode.value === 'replace')
        return 'Replace mode clears all existing workspace data before importing.';
    if (importMode.value === 'append' && !overwriteValues.value)
        return 'Append mode keeps existing data; enable overwrite to update conflicting records.';
    return '';
});

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
    icon: string;
}> = [
    {
        value: 'replace',
        label: 'Replace workspace',
        description: 'Clear all local data, then restore from the backup.',
        icon: 'i-ph-warning-diamond-duotone',
    },
    {
        value: 'append',
        label: 'Append & merge',
        description: 'Keep existing records and add new rows from the backup.',
        icon: 'i-ph-arrows-merge-duotone',
    },
];

const selectedFileSummary = computed(() => {
    if (!selectedFile.value)
        return 'Accepted formats: .or3.jsonl, .jsonl, .json';
    return `${selectedFile.value.name} • ${formatBytes(
        selectedFile.value.size
    )}`;
});

const fileBadgeLabel = computed(() => {
    if (!selectedFile.value) return '';
    if (peeking.value) return 'Validating…';
    if (backupMeta.value) return 'Metadata validated';
    return 'Ready to validate';
});

const fileBadgeColor = computed(() => {
    if (!selectedFile.value) return 'neutral' as const;
    if (peeking.value) return 'info' as const;
    if (backupMeta.value) return 'success' as const;
    return 'primary' as const;
});

const exportStatusBadge = computed(() => {
    if (exporting.value) {
        return {
            color: 'primary' as const,
            icon: 'i-ph-cloud-arrow-down-duotone',
            label: `Streaming… ${state.progress.value}%`,
        };
    }
    if (lastExportStatus.value === 'done') {
        return {
            color: 'success' as const,
            icon: 'i-ph-check-circle-duotone',
            label: 'Export complete',
        };
    }
    if (lastExportStatus.value === 'error') {
        return {
            color: 'error' as const,
            icon: 'i-ph-x-circle-duotone',
            label: 'Export failed',
        };
    }
    return {
        color: 'neutral' as const,
        icon: 'i-ph-floppy-disk-duotone',
        label: 'Ready to export',
    };
});

const importStatusBadge = computed(() => {
    if (importing.value) {
        return {
            color: 'primary' as const,
            icon: 'i-ph-cloud-arrow-up-duotone',
            label: `Importing… ${state.progress.value}%`,
        };
    }
    if (peeking.value) {
        return {
            color: 'info' as const,
            icon: 'i-ph-magnifying-glass-duotone',
            label: 'Validating backup…',
        };
    }
    if (lastImportStatus.value === 'done') {
        return {
            color: 'success' as const,
            icon: 'i-ph-check-circle-duotone',
            label: 'Import complete',
        };
    }
    if (lastImportStatus.value === 'error') {
        return {
            color: 'error' as const,
            icon: 'i-ph-x-circle-duotone',
            label: 'Import failed',
        };
    }
    return {
        color: 'neutral' as const,
        icon: 'i-ph-folder-open-duotone',
        label: 'Awaiting backup',
    };
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
        state.backupMeta.value = null;
        if (
            state.currentStep.value !== 'exporting' &&
            state.currentStep.value !== 'importing'
        ) {
            state.currentStep.value = 'idle';
        }
        state.error.value = null;
        state.progress.value = 0;
    }
}

function handleUploadPanelClick(event: Event) {
    const element = event.target as HTMLElement;
    if (element.closest('button')) return;
    onBrowse();
}

async function onFilePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
        announce('No file selected.');
        clearSelection();
        return;
    }
    pendingAction.value = 'peek';
    selectedFile.value = file;
    peekError.value = null;
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
            : 'Overwrite conflicts disabled; conflicting rows will be skipped.'
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
            announce('Backup metadata validated successfully.');
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
/* Component-specific layout and typography (non-decorative) */
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}

.supporting-text {
    font-size: 15px;
    line-height: 1.25;
    max-width: 82ch;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.75;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 150ms ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
