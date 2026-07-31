export interface ActiveDocumentEditorSession {
    capture: () => void | Promise<void>;
}

const activeSessions = new Map<string, Set<ActiveDocumentEditorSession>>();

export function registerDocumentEditorSession(
    documentId: string,
    session: ActiveDocumentEditorSession
): () => void {
    const sessions = activeSessions.get(documentId) ?? new Set();
    sessions.add(session);
    activeSessions.set(documentId, sessions);
    return () => {
        sessions.delete(session);
        if (!sessions.size) activeSessions.delete(documentId);
    };
}

export async function captureDocumentEditor(documentId: string): Promise<void> {
    const sessions = activeSessions.get(documentId);
    if (!sessions?.size) return;
    await Promise.all([...sessions].map((session) => session.capture()));
}

export function hasActiveDocumentEditor(documentId: string): boolean {
    return Boolean(activeSessions.get(documentId)?.size);
}
