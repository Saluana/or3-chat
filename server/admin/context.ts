/**
 * @module server/admin/context.ts
 *
 * Purpose:
 * Hybrid admin request context resolution. Bridges traditional session auth
 * and dedicated "Super Admin" JWT authentication.
 *
 * Architecture:
 * Supports two distinct tiers of admin identity:
 * 1. **Super Admin**: Authenticated via a high-entropy JWT cookie. Credentials
 *    are defined in environment variables. Used for global system tasks.
 * 2. **Workspace Admin**: A standard OR3 session that has been granted the
 *    `admin.access` permission (Deployment Admin grant). Used for workspace-specific maintenance.
 *
 * Responsibilities:
 * - Cookie-to-Principal resolution.
 * - Session-to-Principal resolution.
 * - Type-safe assertions for admin status (`asserts context is AdminRequestContext`).
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import type { SessionContext } from '../../app/core/hooks/hook-types';
import { getAdminFromCookie, type AdminJwtClaims } from './auth/jwt';
import { resolveSessionContext } from '../auth/session';
import { can } from '../auth/can';

/**
 * Unique identity of the admin requestor.
 */
export type AdminPrincipal =
    | { kind: 'super_admin'; username: string }
    | { kind: 'workspace_admin'; userId: string; session: SessionContext };

/**
 * Complete context of an admin-specific request.
 */
export type AdminRequestContext = {
    /** The resolved principal identity. */
    principal: AdminPrincipal;
    /** The underlying workspace session, if available. */
    session?: SessionContext;
};

/**
 * Purpose:
 * Orchestrates the resolution of the admin context from an incoming event.
 * 
 * Behavior:
 * 1. Checks for a "Super Admin" JWT cookie first (priority tier 1).
 * 2. If present, attempts to also resolve a standard session for context mixing.
 * 3. Falls back to checking the standard session for an `admin.access` grant.
 * 
 * Returns:
 * The combined context or `null` if no valid admin identity is found.
 */
export async function resolveAdminRequestContext(
    event: H3Event
): Promise<AdminRequestContext | null> {
    // Try super admin JWT first
    const adminClaims = await getAdminFromCookie(event);
    if (adminClaims) {
        let session: SessionContext | undefined;
        try {
            const resolved = await resolveSessionContext(event);
            if (resolved.authenticated) {
                session = resolved;
            }
        } catch (error) {
            console.error('[admin] Failed to resolve session for super admin:', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return {
            principal: {
                kind: 'super_admin',
                username: adminClaims.username,
            },
            session,
        };
    }

    // Try workspace session with deployment admin grant
    const session = await resolveSessionContext(event);
    if (session.authenticated && session.user?.id) {
        // Check if this user has deployment admin access via can()
        // The session should have deploymentAdmin flag set by session resolution
        const decision = can(session, 'admin.access');
        if (decision.allowed) {
            return {
                principal: {
                    kind: 'workspace_admin',
                    userId: session.user.id,
                    session,
                },
                session,
            };
        }
    }

    return null;
}

/**
 * Purpose:
 * Enforces the presence of an admin context, throwing 401 if missing.
 */
export function requireAdminContext(
    event: H3Event,
    context: AdminRequestContext | null
): asserts context is AdminRequestContext {
    if (!context) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Unauthorized',
        });
    }
}

/**
 * Purpose:
 * Predicate to check if the principal has global Super Admin privileges.
 */
export function isSuperAdmin(context: AdminRequestContext): boolean {
    return context.principal.kind === 'super_admin';
}

/**
 * Require super admin access.
 */
export function requireSuperAdmin(context: AdminRequestContext): void {
    if (context.principal.kind !== 'super_admin') {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Super admin access required',
        });
    }
}
