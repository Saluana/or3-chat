/**
 * @module server/auth/can.ts
 *
 * Purpose:
 * Centralized authorization engine for OR3 SSR. All server-side endpoints and
 * middleware must use `can()` or its derivatives to enforce permissions.
 *
 * Responsibilities:
 * - Map roles to specific granular permissions.
 * - Evaluate if a session context has the required permission for a resource.
 * - Delegate to the Auth Hook Engine for dynamic decision filtering.
 *
 * Non-responsibilities:
 * - Handling authentication (see `session.ts`).
 * - Managing user roles (see `convex/workspaces.ts`).
 */
import { createError } from 'h3';
import type {
    Permission,
    WorkspaceRole,
    AccessDecision,
    SessionContext,
} from '~/core/hooks/hook-types';
import { getAuthHookEngine, isAuthHookEngineInitialized } from './hooks';

/**
 * Purpose:
 * Internal helper to run the access decision through the hook pipeline.
 *
 * Behavior:
 * If the auth hook engine is ready, it applies all registered filters.
 * Filters can only deny access, never grant it.
 */
function applyDecisionFilters(
    base: AccessDecision,
    session: SessionContext | null
): AccessDecision {
    // If auth hook engine is not initialized, return base decision unchanged
    // This allows can() to work even before the Nitro plugin loads
    if (!isAuthHookEngineInitialized()) {
        return base;
    }

    const engine = getAuthHookEngine();
    return engine.applyAccessDecisionFilters(base, { session });
}

/**
 * Purpose:
 * Static role-to-permission mapping. This defines the baseline capabilities
 * of each workspace role.
 */
const ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
    owner: [
        'workspace.read',
        'workspace.write',
        'workspace.settings.manage',
        'users.manage',
        'plugins.manage',
        // Note: 'admin.access' is NOT included here - it's only for deployment admins
    ],
    editor: ['workspace.read', 'workspace.write'],
    viewer: ['workspace.read'],
};

/**
 * Purpose:
 * Core authorization function. Determines if an action is allowed based on
 * the current session and requested permission.
 *
 * Behavior:
 * 1. Checks if the session is authenticated.
 * 2. Checks if the user's role has the required permission.
 * 3. Enforces workspace-scoped permissions when resource.kind === 'workspace' and resource.id is provided.
 * 4. Handles special cases (e.g., deployment admin overrides).
 * 5. Applies dynamic filters via the hook engine.
 *
 * @param session - The resolved session context (or null if anonymous).
 * @param permission - The specific capability being requested.
 * @param resource - Optional descriptor for the target resource.
 * @returns An `AccessDecision` containing the result and reasoning.
 *
 * @example
 * ```ts
 * const decision = can(session, 'workspace.write');
 * if (decision.allowed) {
 *   // Proceed with write
 * }
 * ```
 */
export function can(
    session: SessionContext | null,
    permission: Permission,
    resource?: { kind: string; id?: string }
): AccessDecision {
    const baseDecision: AccessDecision = {
        allowed: false,
        permission,
        resource,
    };

    // No session → unauthenticated
    if (!session?.authenticated) {
        return { ...baseDecision, reason: 'unauthenticated' };
    }

    const role = session.role;
    if (!role) {
        return {
            ...baseDecision,
            reason: 'forbidden',
            userId: session.user?.id,
            workspaceId: session.workspace?.id,
        };
    }

    const allowedPermissions = ROLE_PERMISSIONS[role];
    let allowed = allowedPermissions.includes(permission);

    // Special case: deployment admin grants admin.access regardless of role
    if (permission === 'admin.access' && session.deploymentAdmin) {
        allowed = true;
    }

    // Enforce workspace scoping: when checking workspace-scoped permissions,
    // verify the session workspace matches the requested workspace resource.
    // This prevents cross-workspace access when a resource.id is explicitly provided.
    if (allowed && resource?.kind === 'workspace' && resource.id) {
        const sessionWorkspaceId = session.workspace?.id;
        if (!sessionWorkspaceId || sessionWorkspaceId !== resource.id) {
            allowed = false;
        }
    }

    const base: AccessDecision = {
        ...baseDecision,
        allowed,
        reason: allowed ? undefined : 'forbidden',
        userId: session.user?.id,
        workspaceId: session.workspace?.id,
        role,
    };

    return applyDecisionFilters(base, session);
}

/**
 * Purpose:
 * Assertion helper to ensure a user is authenticated.
 *
 * @throws 401 Unauthorized if the session is not authenticated.
 */
export function requireSession(
    session: SessionContext | null
): asserts session is SessionContext & { authenticated: true } {
    if (!session?.authenticated) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Unauthorized',
        });
    }
}

/**
 * Purpose:
 * Guard helper to enforce a permission.
 *
 * @throws 401 Unauthorized if not authenticated.
 * @throws 403 Forbidden if authenticated but permission is denied.
 *
 * @example
 * ```ts
 * // In a Nitro event handler
 * requireCan(event.context.session, 'workspace.settings.manage');
 * ```
 */
export function requireCan(
    session: SessionContext | null,
    permission: Permission,
    resource?: { kind: string; id?: string }
): void {
    const decision = can(session, permission, resource);

    if (!decision.allowed) {
        if (decision.reason === 'unauthenticated') {
            throw createError({
                statusCode: 401,
                statusMessage: 'Unauthorized',
            });
        }
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden',
        });
    }
}
