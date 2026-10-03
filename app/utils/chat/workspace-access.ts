import { useRuntimeConfig } from '#imports';
import { getCachedSessionContext, getCachedSessionPayload } from '~/composables/auth/useSessionContext';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';
import type { ToolExecutionContext } from './types';

export interface WorkspaceOperationScope {
    db: Or3DB;
    workspaceId: string;
    generation: number;
    subject: string | null;
    signal: AbortSignal;
    writable: boolean;
    assertCurrent(access?: 'read' | 'write'): void;
}

/** Cloud intake is enabled only after the selected adapter admits the catalog protocol. */
export function workspaceFilesAvailable(): boolean {
    if (useRuntimeConfig().public.ssrAuthEnabled !== true) return true;
    const payload = getCachedSessionPayload();
    return payload?.appAccessAllowed === true && payload.workspaceItemCapability === 'v1';
}

/** Client checks complement the canonical server's workspace authorization. */
export function captureWorkspaceOperation(context: ToolExecutionContext): WorkspaceOperationScope {
    const db = getDb();
    const generation = getWorkspaceGeneration();
    const workspaceId = getActiveWorkspaceId() ?? 'local';
    const authenticated = useRuntimeConfig().public.ssrAuthEnabled === true;
    const session = getCachedSessionContext();
    const subject = authenticated ? session?.user?.id ?? null : null;
    const authorizationRevision = session?.authorizationRevision;
    const role = session?.role;
    const scope: WorkspaceOperationScope = {
        db, generation, workspaceId, subject, signal: context.abortSignal,
        writable: !authenticated || role === 'owner' || role === 'editor',
        assertCurrent(access = 'read') {
            context.abortSignal.throwIfAborted();
            if (!context.threadId || context.workspaceId !== workspaceId
                || workspaceId !== (getActiveWorkspaceId() ?? 'local')
                || db !== getDb() || generation !== getWorkspaceGeneration()) {
                throw new Error('The originating workspace is no longer available.');
            }
            if (authenticated) {
                const current = getCachedSessionContext();
                if (!subject || !current?.authenticated || current.user?.id !== subject
                    || current.workspace?.id !== workspaceId || current.role !== role
                    || current.authorizationRevision !== authorizationRevision
                    || (context.subject !== null && context.subject !== subject)
                    || !['owner', 'editor', 'viewer'].includes(current.role ?? '')
                    || (current.expiresAt && Date.parse(current.expiresAt) <= Date.now())) {
                    throw new Error('Workspace access changed. Refresh and try again.');
                }
                if (access === 'write' && current.role === 'viewer') {
                    throw new Error('This workspace is read-only.');
                }
            }
        },
    };
    scope.assertCurrent();
    return scope;
}

export function workspaceToolsAvailable(context: { workspaceId: string | null; threadId: string | null }): boolean {
    return Boolean(context.threadId && context.workspaceId
        && context.workspaceId === (getActiveWorkspaceId() ?? 'local'));
}
