export type DocumentEditorFocusedRegion =
    | 'title'
    | 'content'
    | 'inspector';

export interface DocumentEditorViewState {
    version: 1;
    documentId: string;
    contentRevision?: number;
    scrollTop: number;
    selectionJson?: unknown;
    inspectorOpen?: boolean;
    inspectorTab?: string;
    findOpen?: boolean;
    focusedRegion?: DocumentEditorFocusedRegion;
}

export interface ActiveDocumentEditorSession {
    readonly documentId: string;
    readonly paneId?: string;
    readonly tabId?: string;
    captureContent: () => void;
    ensureLocalDurability: () => Promise<void>;
    captureViewState: () => DocumentEditorViewState;
    restoreViewState: (
        state: DocumentEditorViewState,
        options?: { focus?: boolean }
    ) => Promise<void>;
    /** Live, frozen context for a chat request; may include unsaved editor text. */
    getChatContext?: (requestId: string) => string;
    /** Execute one of the document agent's native tools in this editor. */
    executeChatTool?: (name: string, argsJson: string, requestId: string) => string;
    /** Actual buffer used to refuse competing drafts before a workspace read/apply. */
    getDocumentSnapshot?: () => { title: string; content: TipTapDocument };
    /** Captured origin handle, including while an old editor is saving after a switch. */
    originDb?: Or3DB;
}

interface LegacyDocumentEditorSession {
    capture: () => void | Promise<void>;
}

type RegisteredDocumentEditorSession =
    | ActiveDocumentEditorSession
    | LegacyDocumentEditorSession;

export interface DocumentEditorSessionLookup {
    paneId: string;
    tabId: string;
}

type DocumentSessionKey = `${string}:${string}`;

const activeSessions = new Map<
    string,
    Set<RegisteredDocumentEditorSession>
>();
const sessionOrigins = new WeakMap<RegisteredDocumentEditorSession, Or3DB>();
const activeSessionsByWorkspaceKey = new Map<
    DocumentSessionKey,
    ActiveDocumentEditorSession
>();
const workspaceSessionWaiters = new Map<
    DocumentSessionKey,
    Set<(session: ActiveDocumentEditorSession) => void>
>();

function workspaceKey(
    lookup: DocumentEditorSessionLookup
): DocumentSessionKey {
    return `${lookup.paneId}:${lookup.tabId}`;
}

function isActiveDocumentEditorSession(
    session: RegisteredDocumentEditorSession
): session is ActiveDocumentEditorSession {
    return 'captureContent' in session;
}

export function registerDocumentEditorSession(
    session: ActiveDocumentEditorSession
): () => void;
/** @deprecated Register a session carrying its own documentId instead. */
export function registerDocumentEditorSession(
    documentId: string,
    session: LegacyDocumentEditorSession
): () => void;
export function registerDocumentEditorSession(
    documentIdOrSession: string | ActiveDocumentEditorSession,
    legacySession?: LegacyDocumentEditorSession
): () => void {
    const documentId =
        typeof documentIdOrSession === 'string'
            ? documentIdOrSession
            : documentIdOrSession.documentId;
    const session =
        typeof documentIdOrSession === 'string'
            ? legacySession
            : documentIdOrSession;

    if (!session) {
        throw new Error('A document editor session is required.');
    }
    sessionOrigins.set(session, isActiveDocumentEditorSession(session) && session.originDb ? session.originDb : getDb());

    const sessions = activeSessions.get(documentId) ?? new Set();
    sessions.add(session);
    activeSessions.set(documentId, sessions);

    const sessionKey =
        isActiveDocumentEditorSession(session) &&
        session.paneId &&
        session.tabId
            ? workspaceKey({ paneId: session.paneId, tabId: session.tabId })
            : undefined;
    if (sessionKey && isActiveDocumentEditorSession(session)) {
        activeSessionsByWorkspaceKey.set(sessionKey, session);
        const waiters = workspaceSessionWaiters.get(sessionKey);
        if (waiters) {
            workspaceSessionWaiters.delete(sessionKey);
            for (const resolve of waiters) resolve(session);
        }
    }

    return () => {
        sessions.delete(session);
        if (!sessions.size) activeSessions.delete(documentId);
        if (
            sessionKey &&
            activeSessionsByWorkspaceKey.get(sessionKey) === session
        ) {
            activeSessionsByWorkspaceKey.delete(sessionKey);
        }
    };
}

export function getDocumentEditorSession(
    lookup: DocumentEditorSessionLookup
): ActiveDocumentEditorSession | undefined {
    return activeSessionsByWorkspaceKey.get(workspaceKey(lookup));
}

/** Wait briefly for a lazy editor to register its session after a tab bind. */
export function waitForDocumentEditorSession(
    lookup: DocumentEditorSessionLookup,
    timeoutMs = 1_500
): Promise<ActiveDocumentEditorSession | undefined> {
    const existing = getDocumentEditorSession(lookup);
    if (existing) return Promise.resolve(existing);
    const key = workspaceKey(lookup);
    return new Promise((resolve) => {
        const waiters = workspaceSessionWaiters.get(key) ?? new Set();
        const finish = (session: ActiveDocumentEditorSession | undefined) => {
            clearTimeout(timeout);
            waiters.delete(onSession);
            if (!waiters.size) workspaceSessionWaiters.delete(key);
            resolve(session);
        };
        const onSession = (session: ActiveDocumentEditorSession) => finish(session);
        const timeout = setTimeout(() => finish(undefined), Math.max(0, timeoutMs));
        waiters.add(onSession);
        workspaceSessionWaiters.set(key, waiters);
    });
}

/**
 * Backwards-compatible document-wide capture used by the legacy pane host.
 * Modern sessions capture synchronously before this function yields.
 */
export async function captureDocumentEditor(documentId: string): Promise<void> {
    const sessions = activeSessions.get(documentId);
    if (!sessions?.size) return;

    const pending: Promise<void>[] = [];
    for (const session of sessions) {
        if (isActiveDocumentEditorSession(session)) {
            session.captureContent();
            continue;
        }
        const result = session.capture();
        if (result) pending.push(Promise.resolve(result));
    }
    await Promise.all(pending);
}

export async function ensureDocumentEditorLocalDurability(
    documentId: string
): Promise<void> {
    const sessions = activeSessions.get(documentId);
    if (!sessions?.size) return;
    await Promise.all(
        [...sessions]
            .filter(isActiveDocumentEditorSession)
            .map((session) => session.ensureLocalDurability())
    );
}

/** Settle only the originating workspace's buffers, refusing disagreement before any save. */
export async function settleWorkspaceDocumentEditors(documentId: string, db: Or3DB): Promise<void> {
    const sessions = [...(activeSessions.get(documentId) ?? [])]
        .filter((session): session is ActiveDocumentEditorSession => isActiveDocumentEditorSession(session) && sessionOrigins.get(session) === db);
    const snapshots = sessions.map((session) => session.getDocumentSnapshot?.()).filter((snapshot) => snapshot !== undefined);
    const expected = snapshots[0] ? JSON.stringify(snapshots[0]) : undefined;
    if (snapshots.some((snapshot) => JSON.stringify(snapshot) !== expected)) {
        throw new Error('Live document editors disagree. Save or reconcile their drafts before continuing.');
    }
    await Promise.all(sessions.map((session) => session.ensureLocalDurability()));
    if (expected && sessions.some((session) => session.getDocumentSnapshot && JSON.stringify(session.getDocumentSnapshot()) !== expected)) {
        throw new Error('This document changed while saving. Read it again.');
    }
}

export function hasActiveDocumentEditor(documentId: string): boolean {
    return Boolean(activeSessions.get(documentId)?.size);
}

export function getActiveDocumentEditorSession(
    documentId: string,
    tabId?: string,
): ActiveDocumentEditorSession | undefined {
    const mounted = [...activeSessionsByWorkspaceKey.values()].find((session) =>
        session.documentId === documentId && (!tabId || session.tabId === tabId)
    );
    if (mounted || tabId) return mounted;
    const sessions = activeSessions.get(documentId);
    if (!sessions) return undefined;
    return [...sessions].find((session): session is ActiveDocumentEditorSession =>
        isActiveDocumentEditorSession(session)
    );
}
import { getDb, type Or3DB } from '~/db/client';
import type { TipTapDocument } from '~/types/database';
