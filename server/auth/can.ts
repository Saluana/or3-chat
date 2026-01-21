/**
 * Centralized authorization via can().
 * All SSR endpoints should use can() to check permissions.
 */
import { createError } from 'h3';
import type {
    Permission,
    WorkspaceRole,
    AccessDecision,
    SessionContext,
} from '~/core/hooks/hook-types';

function applyDecisionFilters(base: AccessDecision): AccessDecision {
    // Deferred: server-side hook engine wiring.
    // The planning docs require `auth.access:filter:decision` enforcement, but Nitro routes
    // must not depend on Nuxt app composables. We'll apply this once we have a server hook
    // engine available (likely via a Nitro plugin + event.context).
    return base;
}

/** Role to permissions mapping. */
const ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
    owner: [
        'workspace.read',
        'workspace.write',
        'workspace.settings.manage',
        'users.manage',
        'plugins.manage',
        'admin.access',
    ],
    editor: ['workspace.read', 'workspace.write'],
    viewer: ['workspace.read'],
};

/**
 * Check if a session has a specific permission.
 *
 * @param session - The session context (or null if unauthenticated)
 * @param permission - The permission to check
 * @param resource - Optional resource to check against
 * @returns AccessDecision with allowed status and details
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
    const allowed = allowedPermissions.includes(permission);

    const base: AccessDecision = {
        ...baseDecision,
        allowed,
        reason: allowed ? undefined : 'forbidden',
        userId: session.user?.id,
        workspaceId: session.workspace?.id,
        role,
    };

    return applyDecisionFilters(base);
}

/**
 * Require a valid session, throwing 401 if not authenticated.
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
 * Require a specific permission, throwing 403 if not allowed.
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
