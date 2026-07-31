/**
 * @module server/auth/admin.ts
 *
 * Purpose:
 * Specialized authorization guards for administrator-only operations. These
 * helpers provide high-level assertions for complex permission checks.
 */
import { createError } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import { requireCan, requireSession } from './can';

/**
 * Purpose:
 * Asserts that the current user has deployment-wide administrative access.
 *
 * Behavior:
 * 1. Ensures the session is authenticated.
 * 2. Checks for the `admin.access` permission (reserved for deployment admins).
 *
 * @throws 401 Unauthorized if not authenticated.
 * @throws 403 Forbidden if not a deployment admin.
 *
 * @example
 * ```ts
 * export default defineEventHandler((event) => {
 *   const session = event.context.session;
 *   requireAdminAccess(session);
 *   // Safe to perform sensitive deployment-level ops here
 * });
 * ```
 */
export function requireAdminAccess(session: SessionContext | null): void {
    requireSession(session);
    requireCan(session, 'admin.access');
}

/**
 * Purpose:
 * Asserts that the current user is an owner of the active workspace and
 * has permission to manage its settings.
 *
 * Behavior:
 * 1. Ensures the session is authenticated.
 * 2. Validates that the user's role is exactly `owner`.
 * 3. Checks for `workspace.settings.manage` permission for the current workspace.
 *
 * @throws 401 Unauthorized if not authenticated.
 * @throws 403 Forbidden if not an owner or does not have manage permissions.
 *
 * @example
 * ```ts
 * export default defineEventHandler((event) => {
 *   const session = event.context.session;
 *   requireAdminOwner(session);
 *   // Safe to delete workspace or manage billing
 * });
 * ```
 */
export function requireAdminOwner(session: SessionContext | null): void {
    requireSession(session);
    if (session.role !== 'owner') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    requireCan(session, 'workspace.settings.manage', {
        kind: 'workspace',
        id: session.workspace?.id,
    });
}
