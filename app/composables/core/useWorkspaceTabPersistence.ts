import { onScopeDispose, type Ref } from 'vue';
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
}

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

export function readWorkspaceTabsSnapshot(
    storage: Pick<WorkspaceTabStorage, 'getItem'>,
    key: string
): WorkspaceTabsSnapshotV1 | null {
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        return migrateWorkspaceTabsSnapshot(JSON.parse(raw));
    } catch {
        return null;
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
 */
export function useWorkspaceTabPersistence(options: {
    state: Ref<WorkspaceTabsState>;
    paneIds: () => readonly string[];
    workspaceId: () => string | null | undefined;
    profileId: () => string | null | undefined;
    storage?: WorkspaceTabStorage | null;
    debounceMs?: number;
}) {
    const debounceMs = options.debounceMs ?? 180;
    const getStorage = (): WorkspaceTabStorage | null => {
        if (options.storage !== undefined) return options.storage;
        if (!import.meta.client) return null;
        return window.localStorage;
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

    function flush(): boolean {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        const storage = getStorage();
        return storage
            ? writeWorkspaceTabsSnapshot(storage, activeStorageKey, snapshot())
            : false;
    }

    function schedule(): void {
        if (!getStorage()) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            flush();
        }, debounceMs);
    }

    function restore(): WorkspaceTabsSnapshotV1 | null {
        const storage = getStorage();
        const nextKey = getWorkspaceTabsStorageKey(
            options.workspaceId(),
            options.profileId()
        );
        if (scopeInitialized && nextKey !== activeStorageKey) flush();
        activeStorageKey = nextKey;
        scopeInitialized = true;
        return storage
            ? readWorkspaceTabsSnapshot(storage, activeStorageKey)
            : null;
    }

    function switchScope(
        workspaceId: string | null | undefined,
        profileId: string | null | undefined
    ): WorkspaceTabsSnapshotV1 | null {
        flush();
        activeStorageKey = getWorkspaceTabsStorageKey(workspaceId, profileId);
        scopeInitialized = true;
        const storage = getStorage();
        return storage
            ? readWorkspaceTabsSnapshot(storage, activeStorageKey)
            : null;
    }

    if (import.meta.client) {
        const onPageHide = () => flush();
        window.addEventListener('pagehide', onPageHide);
        onScopeDispose(() => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('pagehide', onPageHide);
        });
    }

    return { key, restore, switchScope, schedule, flush, snapshot };
}
