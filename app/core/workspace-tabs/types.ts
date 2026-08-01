/**
 * Lightweight workspace-tab state. Resource data stays in the existing
 * database/chat/document stores; this module only describes navigation and
 * per-view mementos.
 */

export type WorkspaceResource =
    | { kind: 'chat'; threadId: string | null }
    | { kind: 'document'; documentId: string }
    | {
          kind: 'app';
          appId: string;
          recordId?: string;
          instanceKey?: string;
      };

/** Persisted. Keep this deliberately small so restoring many tabs is cheap. */
export interface WorkspaceTab {
    id: string;
    resource: WorkspaceResource;
    cachedTitle: string;
    createdAt: number;
    lastActivatedAt: number;
    /** A blank chat until its first message has created a thread. */
    ephemeral: boolean;
}

export type WorkspaceTabStatus =
    | 'idle'
    | 'loading'
    | 'streaming'
    | 'saving'
    | 'attention'
    | 'error';

export interface WorkspaceTabScrollAnchor {
    key: string;
    withinItem: number;
    fallbackIndex: number;
}

export interface WorkspaceTabScrollState {
    version: 1;
    contentKey?: string;
    mode: 'bottom' | 'anchor';
    anchors?: WorkspaceTabScrollAnchor[];
    scrollTop: number;
}

export interface WorkspaceDocumentViewState {
    version: 1;
    documentId: string;
    contentRevision?: number;
    scrollTop: number;
    selectionJson?: unknown;
    inspectorOpen?: boolean;
    inspectorTab?: string;
    findOpen?: boolean;
}

/**
 * Transient only. It is keyed by tab ID so duplicate resource views remain
 * independent. Do not add messages, document bodies, or attachment blobs.
 */
export interface WorkspaceTabRuntime {
    status: WorkspaceTabStatus;
    draft?: {
        text: string;
        editorJson?: Record<string, unknown>;
        pendingPromptId?: string | null;
        updatedAt: number;
    };
    viewState?: {
        chatScroll?: WorkspaceTabScrollState;
        document?: WorkspaceDocumentViewState;
    };
    errorMessage?: string;
}

export interface ClosedTabSnapshot {
    tab: WorkspaceTab;
    tabIndex: number;
    runtime?: WorkspaceTabRuntime;
    closedAt: number;
}

/**
 * Runtime pane IDs never leave the current PageShell. Pane bindings are a
 * one-to-one map between visible panes and tabs.
 */
export interface WorkspaceTabsState {
    tabs: WorkspaceTab[];
    activeTabId: string;
    activePaneId: string | null;
    paneBindings: Map<string, string>;
    runtime: Map<string, WorkspaceTabRuntime>;
    recentlyClosed: ClosedTabSnapshot[];
}

/** The local-storage manifest. It intentionally omits runtime pane UUIDs. */
export interface WorkspaceTabsSnapshotV1 {
    schemaVersion: 1;
    tabs: WorkspaceTab[];
    activeTabId: string;
    visibleTabIds: string[];
    activeVisibleIndex: number;
    savedAt: number;
}

export type WorkspaceTabsSnapshot = WorkspaceTabsSnapshotV1;

export interface WorkspaceTabOpenOptions {
    allowDuplicate?: boolean;
    reuseActiveBlank?: boolean;
    id?: string;
    now?: number;
}
