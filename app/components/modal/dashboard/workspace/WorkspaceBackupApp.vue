<template>
    <div class="px-4 py-4 space-y-10 text-sm">
        <p ref="liveRegion" class="sr-only" aria-live="polite"></p>

        <section
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
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-btn"
                    :href="docsHref"
                    target="_blank"
                    rel="noreferrer"
                >
                    Backup guide
                </UButton>
            </div>
            <UAlert
                color="warning"
                variant="subtle"
                icon="pixelarticons:warning"
                class="text-xs"
            >
                Always create a fresh export before importing a backup—replace
                mode wipes current data.
            </UAlert>
        </section>

        <section
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
                <span class="text-xs opacity-70 tabular-nums">
                    {{ exportStatusText }}
                </span>
            </div>
            <p class="supporting-text">
                Downloads a timestamped JSONL backup of the entire IndexedDB.
                Large workspaces stream directly to disk to avoid freezing the
                UI.
            </p>
            <div class="space-y-2">
                <UProgress
                    v-if="exporting"
                    size="xs"
                    :value="state.progress"
                    :max="100"
                />
                <div class="flex items-center gap-3 flex-wrap text-xs">
                    <span class="font-medium">Status:</span>
                    <span>
                        <template v-if="exporting">
                            Exporting… {{ state.progress }}%
                        </template>
                        <template v-else-if="lastExportStatus === 'done'">
                            Last export {{ lastExportLabel }}
                        </template>
                        <template v-else-if="lastExportStatus === 'error'">
                            {{ exportError?.message || 'Export failed' }}
                        </template>
                        <template v-else> Ready to export </template>
                    </span>
                </div>
            </div>
            <div class="flex flex-wrap gap-3">
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-btn"
                    :disabled="!canExport"
                    :loading="exporting"
                    @click="onExport"
                >
                    Export workspace
                </UButton>
            </div>
        </section>

        <section
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
            <div class="space-y-3">
                <div class="flex flex-wrap gap-3 items-center">
                    <input
                        ref="fileInput"
                        type="file"
                        accept="application/json,.json,.jsonl,.or3.jsonl"
                        class="hidden"
                        @change="onFilePicked"
                    />
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-btn"
                        :disabled="importing || peeking"
                        @click="onBrowse"
                    >
                        Choose backup file
                    </UButton>
                    <span class="text-xs opacity-70">
                        <template v-if="selectedFile">
                            {{ selectedFile.name }}
                            ({{ formatBytes(selectedFile.size) }})
                        </template>
                        <template v-else> No file selected yet </template>
                    </span>
                    <UButton
                        v-if="selectedFile"
                        size="sm"
                        variant="subtle"
                        class="retro-btn"
                        @click="clearSelection"
                    >
                        Clear
                    </UButton>
                </div>

                <UAlert
                    v-if="peeking"
                    color="primary"
                    variant="subtle"
                    icon="pixelarticons:hourglass"
                    class="text-xs"
                >
                    Validating backup metadata…
                </UAlert>
                <UAlert
                    v-if="peekError"
                    color="error"
                    variant="subtle"
                    icon="pixelarticons:warning"
                    class="text-xs"
                >
                    {{ peekError.message }}
                </UAlert>

                <div
                    v-if="backupMeta"
                    class="border-2 border-[var(--md-inverse-surface)] rounded-[3px] p-3 space-y-2 bg-[color-mix(in_oklab,var(--md-surface) 96%,var(--md-surface-variant) 4%)]"
                    aria-live="polite"
                >
                    <div class="flex flex-wrap justify-between text-xs">
                        <span class="font-medium">Database</span>
                        <span class="tabular-nums">{{
                            backupMeta.databaseName
                        }}</span>
                    </div>
                    <div class="flex flex-wrap justify-between text-xs">
                        <span class="font-medium">Schema version</span>
                        <span class="tabular-nums">{{
                            backupMeta.databaseVersion
                        }}</span>
                    </div>
                    <div class="text-xs font-medium">Tables</div>
                    <div
                        class="max-h-40 overflow-auto border-2 border-dashed border-[var(--md-outline-variant)] rounded-[3px] p-2 space-y-1"
                    >
                        <div
                            v-for="table in backupMeta.tables"
                            :key="table.name"
                            class="flex justify-between text-xs"
                        >
                            <span>{{ table.name }}</span>
                            <span class="tabular-nums">
                                {{ formatNumber(table.rowCount) }} rows
                            </span>
                        </div>
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="flex flex-wrap gap-2" role="radiogroup">
                        <UButton
                            size="sm"
                            variant="basic"
                            class="retro-chip"
                            :class="importMode === 'replace' ? 'active' : ''"
                            :aria-pressed="importMode === 'replace'"
                            :disabled="importMode === 'replace'"
                            @click="setImportMode('replace')"
                        >
                            Replace (wipe current data)
                        </UButton>
                        <UButton
                            size="sm"
                            variant="basic"
                            class="retro-chip"
                            :class="importMode === 'append' ? 'active' : ''"
                            :aria-pressed="importMode === 'append'"
                            :disabled="importMode === 'append'"
                            @click="setImportMode('append')"
                        >
                            Append (keep existing)
                        </UButton>
                    </div>
                    <label
                        class="flex items-center gap-2 text-xs"
                        :class="importMode === 'append' ? '' : 'opacity-60'"
                    >
                        <input
                            type="checkbox"
                            :checked="overwriteValues"
                            :disabled="importMode !== 'append'"
                            @change="toggleOverwrite"
                        />
                        Overwrite records on key conflict when appending
                    </label>
                </div>

                <UAlert
                    v-if="importWarning"
                    color="warning"
                    variant="subtle"
                    icon="pixelarticons:alert"
                    class="text-xs"
                >
                    {{ importWarning }}
                </UAlert>
                <UAlert
                    v-if="importError"
                    color="error"
                    variant="subtle"
                    icon="pixelarticons:warning"
                    class="text-xs"
                >
                    {{ importError.message }}
                </UAlert>

                <div class="space-y-2">
                    <UProgress
                        v-if="importing"
                        size="xs"
                        :value="state.progress"
                        :max="100"
                    />
                    <div class="flex items-center gap-3 text-xs flex-wrap">
                        <span class="font-medium">Status:</span>
                        <span>
                            <template v-if="importing">
                                Importing workspace… {{ state.progress }}%
                            </template>
                            <template v-else-if="lastImportStatus === 'done'">
                                Last import {{ lastImportLabel }}
                            </template>
                            <template v-else-if="lastImportStatus === 'error'">
                                {{ importError?.message || 'Import failed' }}
                            </template>
                            <template v-else>
                                Select a file and validate metadata
                            </template>
                        </span>
                    </div>
                </div>

                <div class="flex flex-wrap gap-3">
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-btn"
                        :disabled="!canImport"
                        :loading="importing"
                        @click="onImport"
                    >
                        Import workspace
                    </UButton>
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
} from '~/composables/useWorkspaceBackup';
import { err, reportError, type AppError } from '~/utils/errors';

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

const importing = computed(() => state.isImporting.value);
const exporting = computed(() => state.isExporting.value);
const peeking = computed(() => state.currentStep.value === 'peeking');

const busy = computed(
    () => importing.value || exporting.value || peeking.value
);

const backupMeta = computed(() => state.backupMeta.value);
const importMode = computed(() => state.importMode.value);
const overwriteValues = computed(() => state.overwriteValues.value);

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
    if (exporting.value) return 'Exporting…';
    if (lastExportStatus.value === 'done' && lastExportAt.value)
        return `Last export ${formatDate(lastExportAt.value)}`;
    if (lastExportStatus.value === 'error')
        return exportError.value?.message || 'Export failed';
    return 'Ready';
});

const importStatusText = computed(() => {
    if (importing.value) return 'Importing…';
    if (peeking.value) return 'Validating backup…';
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

const exportStatusFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});
const numberFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
});

const lastExportLabel = computed(() =>
    lastExportAt.value ? formatDate(lastExportAt.value) : 'never'
);
const lastImportLabel = computed(() =>
    lastImportAt.value ? formatDate(lastImportAt.value) : 'never'
);

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

function setImportMode(mode: WorkspaceImportMode) {
    if (state.importMode.value === mode) return;
    state.importMode.value = mode;
    if (mode === 'replace') {
        state.overwriteValues.value = false;
    }
}

function toggleOverwrite(event: Event) {
    const target = event.target as HTMLInputElement;
    state.overwriteValues.value = !!target.checked;
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
.section-card {
    position: relative;
    padding: 1.25rem 1rem 1rem 1rem;
    border: 2px solid var(--md-inverse-surface);
    background: linear-gradient(
        0deg,
        color-mix(
            in oklab,
            var(--md-surface) 94%,
            var(--md-surface-variant) 6%
        ),
        color-mix(
            in oklab,
            var(--md-surface) 90%,
            var(--md-surface-variant) 10%
        )
    );
    border-radius: 6px;
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
}

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

.retro-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    user-select: none;
    transition: background-color 120ms ease, color 120ms ease;
    border: 2px solid var(--md-inverse-surface);
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
    border-radius: 3px;
    background: var(--md-surface);
    line-height: 1;
}

.retro-chip:hover {
    background: var(--md-secondary-container);
    color: var(--md-on-secondary-container);
}

.retro-chip:active {
    transform: translate(2px, 2px);
    box-shadow: 0 0 0 var(--md-inverse-surface);
}

.retro-chip.active {
    background: var(--md-primary-container);
    color: var(--md-on-primary-container);
}

.retro-chip:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
}

@media (prefers-reduced-motion: reduce) {
    .retro-chip,
    .section-card {
        transition: none;
    }
}
</style>
