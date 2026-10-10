import { onScopeDispose, readonly, ref, type Ref } from 'vue';
import {
    migrateWorkspaceTabsSnapshot,
} from '~/core/workspace-tabs/snapshot-schema';
import type {
    WorkspaceTabsSnapshotV1,
    WorkspaceTabsState,
} from '~/core/workspace-tabs/types';

export const WORKSPACE_TABS_STORAGE_PREFIX = 'or3:workspace-tabs:v1';

export interface WorkspaceTabStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
}

export type WorkspaceTabPersistenceStatus =
    | 'ok'
    | 'unavailable'
    | 'write_failed'
    | 'corrupt';

export interface WorkspaceTabPersistenceIssue {
    kind: 'unavailable' | 'write_failed' | 'corrupt_layout';
    key: string;
    message: string;
    error?: unknown;
    /** `corrupt_layout` only: whether the unreadable original was copied aside and can be exported. */
    backupKept?: boolean;
}

export type WorkspaceTabsSnapshotRead =
    | { status: 'missing' }
    | { status: 'ok'; snapshot: WorkspaceTabsSnapshotV1 }
    | { status: 'corrupt'; reason: 'invalid_json' | 'invalid_schema'; raw: string }
    | { status: 'unavailable'; error: unknown };

const UNAVAILABLE_MESSAGE =
    'Browser storage is blocked, so open tabs cannot be saved or restored.';
const WRITE_FAILED_MESSAGE =
    'Open tabs could not be written to browser storage.';
const CORRUPT_KEPT_MESSAGE =
    'The saved tab layout could not be read. A fresh layout is being used, and the original was kept for diagnostics.';
const CORRUPT_NOT_KEPT_MESSAGE =
    'The saved tab layout could not be read or copied aside. A fresh layout is being used, and the original was left in place.';

export function getWorkspaceTabsStorageKey(
    workspaceId: string | null | undefined,
    profileId: string | null | undefined
): string {
    const workspace = workspaceId?.trim() || 'local';
    const profile = profileId?.trim() || 'default';
    return `${WORKSPACE_TABS_STORAGE_PREFIX}:${encodeURIComponent(workspace)}:${encodeURIComponent(profile)}`;
}

export function createWorkspaceTabsSnapshot(
    state: WorkspaceTabsState,
    paneIds: readonly string[],
    savedAt = Date.now()
): WorkspaceTabsSnapshotV1 {
    const visibleTabIds = paneIds.flatMap((paneId) => {
        const tabId = state.paneBindings.get(paneId);
        return tabId ? [tabId] : [];
    });
    const activeVisibleIndex = Math.max(
        0,
        state.activePaneId ? paneIds.indexOf(state.activePaneId) : 0
    );
    return {
        schemaVersion: 1,
        tabs: state.tabs.map((tab) => ({
            ...tab,
            resource: { ...tab.resource },
        })),
        activeTabId: state.activeTabId,
        visibleTabIds,
        activeVisibleIndex,
        savedAt,
    };
}

function corruptBackupKey(key: string): string {
    return `${key}:corrupt`;
}

/** Missing data, unreadable storage and bad data are distinct outcomes. */
export function readWorkspaceTabsSnapshot(
    storage: Pick<WorkspaceTabStorage, 'getItem'>,
    key: string
): WorkspaceTabsSnapshotRead {
    let raw: string | null;
    try {
        raw = storage.getItem(key);
    } catch (error) {
        return { status: 'unavailable', error };
    }
    if (!raw) return { status: 'missing' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { status: 'corrupt', reason: 'invalid_json', raw };
    }
    const snapshot = migrateWorkspaceTabsSnapshot(parsed);
    return snapshot
        ? { status: 'ok', snapshot }
        : { status: 'corrupt', reason: 'invalid_schema', raw };
}

/** Copies an unreadable layout aside. Only the latest one is kept. */
function writeCorruptBackup(
    storage: Pick<WorkspaceTabStorage, 'setItem'>,
    key: string,
    raw: string
): boolean {
    try {
        storage.setItem(corruptBackupKey(key), raw);
        return true;
    } catch {
        return false;
    }
}

export function readCorruptWorkspaceTabsBackup(
    storage: Pick<WorkspaceTabStorage, 'getItem'>,
    key: string
): string | null {
    try {
        return storage.getItem(corruptBackupKey(key));
    } catch {
        return null;
    }
}

export function discardCorruptWorkspaceTabsBackup(
    storage: Pick<WorkspaceTabStorage, 'removeItem'>,
    key: string
): void {
    try {
        storage.removeItem?.(corruptBackupKey(key));
    } catch {
        // Best effort: storage that cannot be read holds no backup to discard.
    }
}

export function writeWorkspaceTabsSnapshot(
    storage: Pick<WorkspaceTabStorage, 'setItem'>,
    key: string,
    snapshot: WorkspaceTabsSnapshotV1
): boolean {
    try {
        storage.setItem(key, JSON.stringify(snapshot));
        return true;
    } catch {
        return false;
    }
}

/**
 * Local-only tab manifest persistence. State changes call `schedule`; pagehide
 * calls `flush` so normal tab switching never synchronously writes storage.
 * Storage failures never throw: they set `status` and call `onIssue` once per
 * failure episode.
 */
export function useWorkspaceTabPersistence(options: {
    state: Ref<WorkspaceTabsState>;
    paneIds: () => readonly string[];
    workspaceId: () => string | null | undefined;
    profileId: () => string | null | undefined;
    storage?: WorkspaceTabStorage | null;
    debounceMs?: number;
    onIssue?: (issue: WorkspaceTabPersistenceIssue) => void;
}) {
    const debounceMs = options.debounceMs ?? 180;
    const status = ref<WorkspaceTabPersistenceStatus>('ok');
    // A successful write ends a failure episode, so the next failure notifies again.
    let episodeReported = false;
    let dirty = false;
    // A corrupt original that could not be copied aside; it is never replaced until it is.
    let unbackedCorrupt: string | null = null;
    const getStorage = (): WorkspaceTabStorage | null => {
        if (options.storage !== undefined) return options.storage;
        if (typeof window === 'undefined') return null;
        try {
            // The property getter itself throws when site data is blocked.
            return window.localStorage;
        } catch (error) {
            fail('unavailable', UNAVAILABLE_MESSAGE, error);
            return null;
        }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeStorageKey = getWorkspaceTabsStorageKey(
        options.workspaceId(),
        options.profileId()
    );
    let scopeInitialized = false;

    function key(): string {
        return activeStorageKey;
    }

    function snapshot(): WorkspaceTabsSnapshotV1 {
        return createWorkspaceTabsSnapshot(options.state.value, options.paneIds());
    }

    /** The first failure of an episode sets `status` and notifies; later ones stay quiet. */
    function fail(
        next: Exclude<WorkspaceTabPersistenceStatus, 'ok'>,
        message: string,
        error?: unknown,
        backupKept?: boolean
    ): void {
        if (episodeReported) return;
        episodeReported = true;
        status.value = next;
        try {
            options.onIssue?.({
                kind: next === 'corrupt' ? 'corrupt_layout' : next,
                key: activeStorageKey,
                message,
                error,
                backupKept,
            });
        } catch (handlerError) {
            console.error('[workspace-tabs] Persistence issue handler failed', handlerError);
        }
    }

    /** Writes only a pending change, so a stale or in-between layout is never saved. */
    function flushPending(): boolean {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (!dirty) return true;
        const storage = getStorage();
        if (!storage) return false;
        if (unbackedCorrupt !== null) {
            if (!writeCorruptBackup(storage, activeStorageKey, unbackedCorrupt)) {
                fail('corrupt', CORRUPT_NOT_KEPT_MESSAGE, undefined, false);
                return false;
            }
            unbackedCorrupt = null;
        }
        if (!writeWorkspaceTabsSnapshot(storage, activeStorageKey, snapshot())) {
            fail('write_failed', WRITE_FAILED_MESSAGE);
            return false;
        }
        dirty = false;
        episodeReported = false;
        status.value = 'ok';
        return true;
    }

    /** Explicit request to save the current layout, e.g. after a pane swap that is not a state change. */
    function flush(): boolean {
        dirty = true;
        return flushPending();
    }

    function schedule(): void {
        dirty = true;
        if (!getStorage()) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            flushPending();
        }, debounceMs);
    }

    /** Unsaved state belongs to the scope it was made in and is not carried over. */
    function enterScope(nextKey: string): void {
        if (nextKey === activeStorageKey) return;
        activeStorageKey = nextKey;
        dirty = false;
        unbackedCorrupt = null;
    }

    /** Reads the active scope as a new failure episode. Never throws. */
    function loadScope(): WorkspaceTabsSnapshotV1 | null {
        status.value = 'ok';
        episodeReported = false;
        const storage = getStorage();
        if (!storage) return null;
        const read = readWorkspaceTabsSnapshot(storage, activeStorageKey);
        switch (read.status) {
            case 'ok':
                unbackedCorrupt = null;
                return read.snapshot;
            case 'missing':
                unbackedCorrupt = null;
                return null;
            case 'unavailable':
                fail('unavailable', UNAVAILABLE_MESSAGE, read.error);
                return null;
            case 'corrupt': {
                // The original is copied aside before a fresh layout can replace it.
                const copied = writeCorruptBackup(storage, activeStorageKey, read.raw);
                unbackedCorrupt = copied ? null : read.raw;
                fail('corrupt', copied ? CORRUPT_KEPT_MESSAGE : CORRUPT_NOT_KEPT_MESSAGE, undefined, copied);
                return null;
            }
        }
    }

    function restore(): WorkspaceTabsSnapshotV1 | null {
        const nextKey = getWorkspaceTabsStorageKey(
            options.workspaceId(),
            options.profileId()
        );
        if (scopeInitialized && nextKey !== activeStorageKey) flushPending();
        enterScope(nextKey);
        scopeInitialized = true;
        return loadScope();
    }

    function switchScope(
        workspaceId: string | null | undefined,
        profileId: string | null | undefined
    ): WorkspaceTabsSnapshotV1 | null {
        flushPending();
        enterScope(getWorkspaceTabsStorageKey(workspaceId, profileId));
        scopeInitialized = true;
        return loadScope();
    }

    if (import.meta.client) {
        const onPageHide = () => flushPending();
        window.addEventListener('pagehide', onPageHide);
        onScopeDispose(() => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('pagehide', onPageHide);
        });
    }

    const retry = flush;

    return {
        key,
        status: readonly(status),
        restore,
        switchScope,
        schedule,
        flush,
        retry,
        snapshot,
        // A notice outlives scope switches, so its actions pass the key it was raised for.
        getCorruptBackup: (layoutKey = activeStorageKey) => {
            const storage = getStorage();
            return storage
                ? readCorruptWorkspaceTabsBackup(storage, layoutKey)
                : null;
        },
        discardCorruptBackup: (layoutKey = activeStorageKey) => {
            const storage = getStorage();
            if (storage) discardCorruptWorkspaceTabsBackup(storage, layoutKey);
        },
    };
}
