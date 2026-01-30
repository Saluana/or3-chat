import type { H3Event } from 'h3';
import type { Permission, SessionContext } from '~/core/hooks/hook-types';
import { resolveSessionContext } from '../auth/session';
import { requireAdminAccess, requireAdminOwner } from '../auth/admin';
import { requireCan } from '../auth/can';
import { requireAdminMutation, requireAdminRequest } from './guard';
import {
    resolveAdminRequestContext,
    requireAdminContext,
    isSuperAdmin,
    type AdminRequestContext,
} from './context';

type AdminApiOptions = {
    permission?: Permission;
    ownerOnly?: boolean;
    mutation?: boolean;
    resource?: { kind: string; id?: string };
    /**
     * Require super admin access (JWT-based super admin, not workspace admin).
     * Use for sensitive operations like password changes, system configuration.
     */
    superAdminOnly?: boolean;
};

/**
 * Require admin API access, returning the admin context.
 * 
 * Supports both super admin (JWT) and workspace admin (deployment admin grant).
 * Use `options.superAdminOnly` to restrict to super admin only.
 * 
 * @deprecated Use requireAdminContext instead for new code
 */
export async function requireAdminApi(
    event: H3Event,
    options: AdminApiOptions = {}
): Promise<SessionContext> {
    requireAdminRequest(event);
    if (options.mutation ?? false) {
        requireAdminMutation(event);
    }

    // Check if we have the new admin context (from middleware), otherwise resolve it
    let adminContext = event.context.admin as AdminRequestContext | undefined;
    if (!adminContext) {
        adminContext = await resolveAdminRequestContext(event) ?? undefined;
        if (adminContext) {
            event.context.admin = adminContext;
        }
    }
    
    if (adminContext) {
        // Super admin check
        if (options.superAdminOnly && !isSuperAdmin(adminContext)) {
            throw createError({
                statusCode: 403,
                statusMessage: 'Forbidden: Super admin access required',
            });
        }

        // For workspace admin, we need a session
        if (adminContext.session) {
            if (options.ownerOnly) {
                requireAdminOwner(adminContext.session);
                return adminContext.session;
            }

            if (options.permission) {
                requireCan(adminContext.session, options.permission, options.resource);
                return adminContext.session;
            }

            requireAdminAccess(adminContext.session);
            return adminContext.session;
        }

        // Super admin without workspace session - create a minimal session
        if (adminContext.principal.kind === 'super_admin') {
            return {
                authenticated: true,
                provider: 'admin',
                providerUserId: adminContext.principal.username,
                user: {
                    id: adminContext.principal.username,
                    email: undefined,
                    displayName: `Super Admin: ${adminContext.principal.username}`,
                },
                role: 'owner',
                deploymentAdmin: true,
            } as SessionContext;
        }
    }

    // Fallback to legacy session resolution
    const session = await resolveSessionContext(event);

    if (options.ownerOnly) {
        requireAdminOwner(session);
        return session;
    }

    if (options.permission) {
        requireCan(session, options.permission, options.resource);
        return session;
    }

    requireAdminAccess(session);
    return session;
}

/**
 * Get the admin request context from the event.
 * Returns null if no admin context is present.
 */
export function getAdminContext(event: H3Event): AdminRequestContext | null {
    return (event.context.admin as AdminRequestContext | undefined) ?? null;
}

/**
 * Require admin context, throwing 401 if not present.
 * Use this in new admin endpoints.
 */
export async function requireAdminApiContext(
    event: H3Event,
    options: AdminApiOptions = {}
): Promise<AdminRequestContext> {
    requireAdminRequest(event);
    if (options.mutation ?? false) {
        requireAdminMutation(event);
    }

    let context = getAdminContext(event);
    
    // If not in context, try to resolve
    if (!context) {
        context = await resolveAdminRequestContext(event);
        if (context) {
            event.context.admin = context;
        }
    }

    requireAdminContext(event, context);

    // Check super admin requirement
    if (options.superAdminOnly && !isSuperAdmin(context)) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Super admin access required',
        });
    }

    // Check owner/permission for workspace admin
    if (context.session) {
        if (options.ownerOnly) {
            requireAdminOwner(context.session);
        } else if (options.permission) {
            requireCan(context.session, options.permission, options.resource);
        } else {
            requireAdminAccess(context.session);
        }
    }

    return context;
}
