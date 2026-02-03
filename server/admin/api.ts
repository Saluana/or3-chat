import type { H3Event } from 'h3';
import type { Permission, SessionContext } from '~/core/hooks/hook-types';
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
/**
 * @deprecated Use requireAdminApiContext instead
 * This is now a thin wrapper around requireAdminApiContext for backward compatibility.
 */
export async function requireAdminApi(
    event: H3Event,
    options: AdminApiOptions = {}
): Promise<SessionContext> {
    const context = await requireAdminApiContext(event, options);
    
    // Return session if available (workspace admin)
    if (context.session) {
        return context.session;
    }
    
    // For super admin without workspace session, create a minimal session
    if (context.principal.kind === 'super_admin') {
        return {
            authenticated: true,
            provider: 'admin',
            providerUserId: context.principal.username,
            user: {
                id: context.principal.username,
                email: undefined,
                displayName: `Super Admin: ${context.principal.username}`,
            },
            role: 'owner',
            deploymentAdmin: true,
        } as SessionContext;
    }
    
    // This shouldn't happen as requireAdminApiContext should throw
    throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized: No valid session',
    });
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
    if (context.session && !isSuperAdmin(context)) {
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
