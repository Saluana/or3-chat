/**
 * Hybrid admin request context resolution.
 * 
 * Supports two types of admin identities:
 * 1. Super admin: JWT cookie-based, created from env vars
 * 2. Workspace admin: Normal SSR auth session with deployment admin grant
 * 
 * This is the central function for admin authorization.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import type { SessionContext } from '../../app/core/hooks/hook-types';
import { getAdminFromCookie, type AdminJwtClaims } from './auth/jwt';
import { resolveSessionContext } from '../auth/session';
import { can } from '../auth/can';

export type AdminPrincipal =
    | { kind: 'super_admin'; username: string }
    | { kind: 'workspace_admin'; userId: string; session: SessionContext };

export type AdminRequestContext = {
    principal: AdminPrincipal;
    // The workspace session if this is a workspace admin
    session?: SessionContext;
};

/**
 * Resolve admin request context from the event.
 * 
 * Tries super admin JWT first, then falls back to workspace session
 * with deployment admin grant check.
 * 
 * Returns null if no admin context can be resolved.
 */
export async function resolveAdminRequestContext(
    event: H3Event
): Promise<AdminRequestContext | null> {
    // Try super admin JWT first
    const adminClaims = await getAdminFromCookie(event);
    if (adminClaims) {
        return {
            principal: {
                kind: 'super_admin',
                username: adminClaims.username,
            },
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
 * Require an admin context, throwing 401 if not found.
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
 * Check if the principal is a super admin.
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
