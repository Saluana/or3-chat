/**
 * @module server/admin/api.ts
 *
 * Purpose:
 * High-level orchestration for admin API requests. Bridges the gap between
 * raw H3 events, admin sessions, and the OR3 permission engine (`can()`).
 *
 * Responsibilities:
 * - Provides helper functions for enforcing admin access in API routes.
 * - Handles dual-mode authentication (Super Admin vs Workspace Admin).
 * - Maps admin principal to a standard `SessionContext` for downstream use.
 * - Enforces mutation-specific safety checks and host-gate restrictions.
 *
 * Guards:
 * - Uses `requireAdminRequest` to enforce `allowedHosts` whitelist.
 * - Uses `requireAdminMutation` for non-GET methods to prevent CSRF.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
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

/**
 * Configuration for admin API authorization.
 */
type AdminApiOptions = {
    /** Specific permission required via the `can()` engine. */
    permission?: Permission;
    /** Restrict to workspace owners only. */
    ownerOnly?: boolean;
    /** Treat this as a mutation (enforces CSRF/intent checks). */
    mutation?: boolean;
    /** Optional resource context for permission checks. */
    resource?: { kind: string; id?: string };
    /**
     * Require super admin access (JWT-based super admin, not workspace admin).
     * Use for sensitive operations like password changes, system configuration.
     */
    superAdminOnly?: boolean;
};

/**
 * Purpose:
 * Legacy wrapper for enforcing admin access and returning a standard session.
 * 
 * Behavior:
 * 1. Resolves the admin context (Super or Workspace).
 * 2. If Super Admin, synthesizes a minimal authenticated session.
 * 3. If Workspace Admin, returns the actual workspace session.
 * 
 * @deprecated Use `requireAdminApiContext` instead for new code.
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
 * Purpose:
 * Non-throwing retrieval of the admin context from the event.
 */
export function getAdminContext(event: H3Event): AdminRequestContext | null {
    return (event.context.admin as AdminRequestContext | undefined) ?? null;
}

/**
 * Purpose:
 * Primary entry point for admin API routes to enforce complex authorization logic.
 * 
 * Behavior:
 * 1. Runs host-gate checks via `requireAdminRequest`.
 * 2. runs mutation/CSRF checks if requested.
 * 3. Resolves the hybrid admin context (JWT or Session).
 * 4. validates specific permission/owner requirements.
 * 
 * Errors:
 * - 401: No valid admin context found.
 * - 403: Specific permission or Super Admin requirement failed.
 * - 404: Host-gate or SSR auth disabled (security through obscurity).
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
