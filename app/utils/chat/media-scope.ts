import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';

/** Captured before asynchronous media work; never resolves a replacement DB. */
export function captureChatMediaScope(db: Or3DB = getDb(), signal?: AbortSignal, access: 'read' | 'write' = 'read') {
    const generation = getWorkspaceGeneration();
    const identity = () => {
        const session = getCachedSessionContext();
        return JSON.stringify([session?.authenticated, session?.user?.id, session?.workspace?.id,
            session?.role, session?.authorizationRevision]);
    };
    const owner = identity();
    return { db, assertCurrent() {
        signal?.throwIfAborted();
        const session = getCachedSessionContext();
        if (db !== getDb() || generation !== getWorkspaceGeneration() || identity() !== owner
            || (session?.authenticated && ((access === 'write' && !['owner', 'editor'].includes(session.role ?? ''))
                || (session.expiresAt && Date.parse(session.expiresAt) <= Date.now())))) {
            throw new Error('The originating media workspace or account is no longer available.');
        }
    } };
}
