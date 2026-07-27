import { createError } from 'h3';
import {
    isSuperAdmin,
    type AdminRequestContext,
} from './context';

/**
 * Resolve a workspace-scoped admin operation without allowing the visible
 * workspace and mutation target to drift apart.
 *
 * Super admins may explicitly target any workspace. Workspace admins are
 * always constrained to the workspace carried by their authenticated session.
 */
export function resolveAdminWorkspaceTarget(
    context: AdminRequestContext,
    requestedWorkspaceId?: unknown
): string {
    const requested =
        typeof requestedWorkspaceId === 'string'
            ? requestedWorkspaceId.trim()
            : '';
    const sessionWorkspaceId = context.session?.workspace?.id?.trim() ?? '';

    if (isSuperAdmin(context)) {
        const target = requested || sessionWorkspaceId;
        if (!target) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Workspace ID is required',
            });
        }
        return target;
    }

    if (!sessionWorkspaceId) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Workspace admin session required',
        });
    }

    if (requested && requested !== sessionWorkspaceId) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: workspace target does not match session',
        });
    }

    return sessionWorkspaceId;
}
