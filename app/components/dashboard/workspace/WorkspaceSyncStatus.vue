<template>
    <div
        id="dashboard-workspace-sync-container"
        ref="root"
        class="dashboard-page-frame workspace-sync text-sm"
    >
        <p ref="liveRegion" class="sr-only" aria-live="polite"></p>
        <h1 class="dashboard-page-title sr-only">Sync status</h1>

        <section class="dashboard-list-group" aria-labelledby="workspace-sync-status">
            <h3 id="workspace-sync-status" ref="statusHeading" tabindex="-1" class="dashboard-list-heading">
                Status
            </h3>
            <div class="dashboard-list">
                <DashboardListRow
                    static
                    :icon="snapshot?.total ? iconWarning : iconSync"
                    :label="statusLabel"
                    :description="statusDescription"
                />
            </div>
            <p v-if="loadError" class="dashboard-list-footnote text-error" role="alert">
                {{ loadError }}
            </p>
            <p v-else-if="scope && paused" class="dashboard-list-footnote">
                Cloud sync is paused for this account. Your changes stay saved in
                this browser and sync when access returns.
            </p>
        </section>

        <section
            v-if="snapshot?.total"
            class="dashboard-list-group"
            aria-labelledby="workspace-sync-failed"
        >
            <h3 id="workspace-sync-failed" class="dashboard-list-heading">
                Changes that didn’t sync
            </h3>
            <div class="dashboard-list" role="list" aria-labelledby="workspace-sync-failed">
                <DashboardListRow
                    v-for="item in items"
                    :key="item.id"
                    static
                    role="listitem"
                    :label="item.label"
                    :description="item.description"
                    :danger="confirming === item.id"
                >
                    <span v-if="confirming === item.id" class="dashboard-list-description">
                        Stop syncing this change? It stays saved in this browser,
                        but other devices won’t receive it.
                    </span>
                    <template #trailing>
                        <div class="flex items-center gap-1.5">
                            <template v-if="confirming === item.id">
                                <UButton
                                    data-sync-cancel
                                    v-bind="secondaryButtonProps"
                                    :disabled="!!busyId"
                                    @click="confirming = null"
                                >
                                    Cancel
                                </UButton>
                                <UButton
                                    v-bind="discardButtonProps"
                                    :disabled="!!busyId"
                                    :loading="busyId === item.id"
                                    @click="discard(item)"
                                >
                                    Discard change
                                </UButton>
                            </template>
                            <template v-else>
                                <UButton
                                    v-bind="secondaryButtonProps"
                                    :disabled="!!busyId"
                                    :loading="busyId === item.id"
                                    @click="retry(item)"
                                >
                                    Retry
                                </UButton>
                                <UButton
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :disabled="!!busyId"
                                    @click="askDiscard(item)"
                                >
                                    Discard
                                </UButton>
                            </template>
                        </div>
                    </template>
                </DashboardListRow>
            </div>
            <p v-if="actionError" class="dashboard-list-footnote text-error" role="alert">
                {{ actionError }}
            </p>
            <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="dashboard-list-footnote">
                    {{
                        snapshot.total > items.length
                            ? `Showing ${items.length} of ${snapshot.total}.`
                            : 'Retrying sends the saved change again.'
                    }}
                </span>
                <UButton
                    v-bind="primaryButtonProps"
                    :disabled="!!busyId"
                    :loading="busyId === 'all'"
                    @click="retry()"
                >
                    Retry all
                </UButton>
            </div>
        </section>

        <section
            v-if="scope && backupEnabled"
            class="dashboard-list-group"
            aria-labelledby="workspace-sync-copy"
        >
            <h3 id="workspace-sync-copy" class="dashboard-list-heading">
                Browser copy
            </h3>
            <div class="dashboard-list">
                <DashboardListRow
                    static
                    :icon="iconDownload"
                    label="This browser’s data"
                    description="Works without syncing. Includes files stored in this browser, not files kept only in the cloud."
                >
                    <template #trailing>
                        <UButton
                            v-bind="secondaryButtonProps"
                            :disabled="backup.state.isExporting.value || backup.state.isImporting.value"
                            :loading="backup.state.isExporting.value"
                            @click="saveCopy"
                        >
                            Save copy
                        </UButton>
                    </template>
                </DashboardListRow>
            </div>
            <p v-if="copyError" class="dashboard-list-footnote text-error" role="alert">
                {{ copyError }}
            </p>
            <p v-else-if="copiedAt" class="dashboard-list-footnote" role="status">
                Browser copy saved {{ formatDate(copiedAt) }}
            </p>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import type { PendingOp } from '~~/shared/sync/types';
import {
    getActiveWorkspaceId,
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
    type Or3DB,
} from '~/db/client';
import {
    discardFailedOp,
    listFailedOps,
    retryFailedOps,
} from '~/core/sync/outbox-manager';
import { useCloudAccess } from '~/core/cloud/access';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useWorkspaceBackup } from '~/composables/core/useWorkspaceBackup';
import { isFeatureEnabled } from '~/composables/useOr3Config';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import DashboardListRow from '../DashboardListRow.vue';

/** Failed items shown at once; the count still covers every failed change. */
const LIST_LIMIT = 50;
const WAITING_STATUSES = ['pending', 'retry_wait', 'in_flight', 'syncing'] as const;

interface FailedItem {
    id: string;
    opId: string;
    label: string;
    description: string;
}

const KIND_LABELS: Record<string, string> = {
    threads: 'Chat',
    messages: 'Message',
    projects: 'Project',
    posts: 'Document',
    kv: 'Setting',
    file_meta: 'File',
    notifications: 'Notification',
};

const iconSync = useIcon('ui.sync');
const iconWarning = useIcon('ui.warning');
const iconDownload = useIcon('ui.download');
const backupEnabled = isFeatureEnabled('backup');
const cloudAccess = useCloudAccess();
const paused = computed(() => !cloudAccess.value);
const session = useSessionContext();
const backup = useWorkspaceBackup();

const root = ref<HTMLElement | null>(null);
const liveRegion = ref<HTMLElement | null>(null);
const statusHeading = ref<HTMLElement | null>(null);

const scope = shallowRef<{ db: Or3DB; generation: number } | null>(null);
const snapshot = shallowRef<{ ops: PendingOp[]; total: number; waiting: number } | null>(null);
const loadError = ref('');
const actionError = ref('');
const busyId = ref<string | null>(null);
const confirming = ref<string | null>(null);
const copyError = ref('');
const copiedAt = ref<Date | null>(null);

let subscription: Subscription | undefined;
let revision = 0;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});

function formatDate(value: Date) {
    return dateFormatter.format(value);
}

function themedButton(identifier: string, base: object) {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier,
        isNuxtUI: true,
    });
    // Same override merge as the backup page's buttons.
    return computed(() => ({ size: 'sm' as const, ...base, ...(overrides.value as any) }));
}

const primaryButtonProps = themedButton('dashboard.workspace.sync.retry-all', { color: 'primary' });
const secondaryButtonProps = themedButton('dashboard.workspace.sync.action', { variant: 'outline' });
const discardButtonProps = themedButton('dashboard.workspace.sync.discard', { color: 'error' });

function plural(count: number, one: string, many: string) {
    return `${count} ${count === 1 ? one : many}`;
}

const statusLabel = computed(() => {
    if (!scope.value) return 'No workspace selected';
    const current = snapshot.value;
    if (!current) return loadError.value ? 'Sync status unavailable' : 'Checking sync…';
    if (current.total) return plural(current.total, 'change needs attention', 'changes need attention');
    if (current.waiting) return plural(current.waiting, 'change waiting to sync', 'changes waiting to sync');
    return 'No changes waiting to sync';
});

const statusDescription = computed(() => {
    const current = snapshot.value;
    if (!scope.value || !current) return '';
    if (current.total) return 'Saved in this browser. Retry them, or discard ones you don’t need on other devices.';
    if (current.waiting) return paused.value
        ? 'Saved in this browser, waiting for Cloud access to return.'
        : 'Saved in this browser and queued to send.';
    return 'No queued record changes need attention. Files have separate upload status.';
});

/** Plain-language reason from structured fields only; raw errors may hold provider detail. */
function reasonFor(op: PendingOp): string {
    switch (op.lastErrorCode) {
        case 'OVERSIZED':
            return 'Too large to sync.';
        case 'UNAUTHORIZED':
            return 'Your account can’t sync this workspace right now.';
        case 'VALIDATION_ERROR':
            return 'The server didn’t accept this change.';
    }
    if (op.status === 'failed_retryable' || op.failureKind === 'retry_exhausted') {
        return 'The server couldn’t be reached after several tries.';
    }
    if (op.status === 'failed_permanent') return 'The server didn’t accept this change.';
    return 'This change didn’t sync.';
}

/** A record's own title or name (never its content), so the user can recognize it. */
function labelFor(op: PendingOp): string {
    const kind = KIND_LABELS[op.tableName] ?? 'Change';
    const payload = op.payload as { title?: unknown; name?: unknown } | undefined;
    const name = typeof payload?.title === 'string' && payload.title.trim()
        ? payload.title
        : typeof payload?.name === 'string' ? payload.name : '';
    const trimmed = name.trim();
    if (!trimmed) return op.operation === 'delete' ? `Deleted ${kind.toLowerCase()}` : kind;
    return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

const items = computed<FailedItem[]>(() =>
    (snapshot.value?.ops ?? []).map((op) => {
        const kind = KIND_LABELS[op.tableName] ?? 'Change';
        const when = formatDate(new Date(op.failedAt ?? op.createdAt));
        return {
            id: op.id,
            opId: op.stamp?.opId ?? '',
            label: labelFor(op),
            description: `${kind} · ${reasonFor(op)} · ${when}`,
        };
    })
);

function announce(message: string) {
    if (liveRegion.value) liveRegion.value.textContent = message;
}

function isCurrent(token: number, db: Or3DB): boolean {
    const current = scope.value;
    return token === revision && !!current && current.db === db && db === getDb()
        && current.generation === getWorkspaceGeneration();
}

async function countWaiting(db: Or3DB): Promise<number> {
    const counts = await Promise.all(
        WAITING_STATUSES.map((status) => db.pending_ops.where('status').equals(status).count())
    );
    return counts.reduce((sum, count) => sum + count, 0);
}

/** Follow the active workspace DB; a switch drops the old list and any in-progress confirmation. */
function bind() {
    revision += 1;
    subscription?.unsubscribe();
    subscription = undefined;
    snapshot.value = null;
    loadError.value = '';
    actionError.value = '';
    busyId.value = null;
    confirming.value = null;
    copyError.value = '';
    copiedAt.value = null;
    if (!getActiveWorkspaceId()) {
        scope.value = null;
        return;
    }
    const db = getDb();
    const token = revision;
    scope.value = { db, generation: getWorkspaceGeneration() };
    subscription = liveQuery(async () => {
        const [failed, waiting] = await Promise.all([listFailedOps(db, LIST_LIMIT), countWaiting(db)]);
        return { ...failed, waiting };
    }).subscribe({
        next: (value) => {
            if (!isCurrent(token, db)) return;
            snapshot.value = value;
            loadError.value = '';
            if (confirming.value && !value.ops.some((op) => op.id === confirming.value)) {
                confirming.value = null;
            }
        },
        error: () => {
            if (isCurrent(token, db)) loadError.value = 'Sync status couldn’t be read. Reload the page to try again.';
        },
    });
}

/** Run one recovery action against the workspace the list belongs to. */
async function run(key: string, action: (db: Or3DB) => Promise<boolean | number>, done: string) {
    const current = scope.value;
    const token = revision;
    if (!current || busyId.value || !isCurrent(token, current.db)) return;
    busyId.value = key;
    actionError.value = '';
    try {
        const changed = Boolean(await action(current.db));
        if (!isCurrent(token, current.db)) return;
        announce(changed ? done : 'This change was already handled, possibly in another tab.');
    } catch {
        if (isCurrent(token, current.db)) actionError.value = 'That didn’t work. Your changes are still saved in this browser; try again.';
    } finally {
        if (token === revision) busyId.value = null;
    }
}

function retry(item?: FailedItem) {
    confirming.value = null;
    return run(
        item?.id ?? 'all',
        (db) => retryFailedOps(db, item ? { id: item.id, opId: item.opId } : undefined),
        item ? 'Retrying this change.' : 'Retrying every change that didn’t sync.'
    );
}

async function askDiscard(item: FailedItem) {
    confirming.value = item.id;
    await nextTick();
    // The safe choice takes focus when the buttons swap.
    root.value?.querySelector<HTMLElement>('[data-sync-cancel]')?.focus();
}

async function discard(item: FailedItem) {
    await run(
        item.id,
        (db) => discardFailedOp(db, { id: item.id, opId: item.opId }, 'user_discarded'),
        'Change discarded. It is still saved in this browser.'
    );
    if (confirming.value === item.id) confirming.value = null;
    statusHeading.value?.focus();
}

async function saveCopy() {
    const token = revision;
    copyError.value = '';
    copiedAt.value = null;
    announce('Saving a copy of this browser’s data.');
    await backup.exportWorkspace({ localOnly: true });
    if (token !== revision) return;
    if (backup.state.currentStep.value === 'error') {
        copyError.value = backup.state.error.value?.message || 'The browser copy couldn’t be saved.';
        announce(copyError.value);
    } else if (backup.state.currentStep.value === 'done') {
        copiedAt.value = new Date();
        announce('Browser copy saved.');
    }
}

bind();
const stopWorkspace = subscribeActiveWorkspaceDb(bind);
// An account change can keep the workspace id but not its authority.
watch(() => session.data.value?.session?.user?.id, (next, previous) => {
    if (next !== previous) bind();
});

onBeforeUnmount(() => {
    revision += 1;
    subscription?.unsubscribe();
    stopWorkspace();
});
</script>

<style scoped>
.workspace-sync {
    gap: 28px;
}
</style>
