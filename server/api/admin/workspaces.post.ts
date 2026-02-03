/**
 * @module server/api/admin/workspaces.post
 *
 * Purpose:
 * Creates a new workspace and assigns an initial owner.
 *
 * Responsibilities:
 * - Validates input constraints (name length, description, etc.)
 * - Enforces generic rate limits for admin actions
 * - Delegates persistence to `AuthWorkspaceStore`
 * - Emits `admin.workspace:action:created` for audit/side-effects
 *
 * Security:
 * - Gated by `requireAdminApiContext` (Super Admin access typically required to create workspaces)
 * - Rate limited by IP
 *
 * @see server/admin/stores/workspace-access-store.ts
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { getWorkspaceAccessStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';
import { checkGenericRateLimit, getClientIp } from '../../admin/auth/rate-limit';

interface CreateWorkspaceBody {
    name: string;
    description?: string;
    ownerUserId: string;
}

/**
 * POST /api/admin/workspaces
 *
 * Purpose:
 * Provisions a new workspace in the system.
 *
 * Behavior:
 * 1. Checks admin feature flag and rate limits.
 * 2. Validates payload (name length, owner ID format).
 * 3. Persists workspace via store.
 * 4. Trigger `admin.workspace:action:created` hook.
 *
 * Errors:
 * - 400: Validation failure (name missing, ID invalid)
 * - 404: Admin disabled
 * - 429: Rate limit exceeded
 *
 * Hook: `admin.workspace:action:created`
 * - Payload: `{ workspaceId, name, ownerUserId, createdBy }`
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Rate limit check
    const clientIp = getClientIp(event);
    const rateLimit = checkGenericRateLimit(clientIp, 'admin-api');
    
    if (!rateLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many requests',
        });
    }

    // Require admin context
    const adminCtx = await requireAdminApiContext(event);

    const body = await readBody<CreateWorkspaceBody>(event);
    const { name, description, ownerUserId } = body;

    // Validate workspace name
    if (!name || !name.trim()) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace name is required',
        });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace name must be under 100 characters',
        });
    }

    // Validate description
    if (description && description.length > 1000) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Description must be under 1000 characters',
        });
    }

    // Validate owner user ID format (Convex ID pattern: users:<base36-id>)
    if (!ownerUserId || !/^users:[a-zA-Z0-9_-]+$/.test(ownerUserId)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Valid owner user ID is required',
        });
    }

    // Values are already validated and trimmed above
    // Vue's text interpolation automatically escapes HTML, so no sanitization needed
    const sanitizedName = trimmedName;
    const sanitizedDescription = description?.trim();

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // Create workspace
    const result = await store.createWorkspace({
        name: sanitizedName,
        description: sanitizedDescription,
        ownerUserId,
    });

    const actorId = adminCtx.principal.kind === 'super_admin' 
        ? adminCtx.principal.username 
        : adminCtx.principal.userId;

    await event.context.adminHooks?.doAction('admin.workspace:action:created', {
        workspaceId: result.workspaceId,
        name: sanitizedName,
        ownerUserId,
        createdBy: { kind: adminCtx.principal.kind, id: actorId },
    });

    return result;
});
