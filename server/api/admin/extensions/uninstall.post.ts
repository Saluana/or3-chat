/**
 * @module server/api/admin/extensions/uninstall.post
 *
 * Purpose:
 * Removes an installed extension from the file system.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../admin/api';
import {
    uninstallExtension,
    invalidateExtensionsCache,
} from '../../../admin/extensions/extension-manager';

const BodySchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['plugin', 'theme', 'admin_plugin']),
});

/**
 * POST /api/admin/extensions/uninstall
 *
 * Purpose:
 * Delete an extension by ID.
 *
 * Behavior:
 * - Validates kind/id.
 * - Removes directory physically.
 * - Invalidates cache.
 *
 * Security:
 * - Admin-only (Owner-only mutation).
 * - Directory traversal prevented by ID sanitization in manager.
 */
export default defineEventHandler(async (event) => {
    await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    try {
        await uninstallExtension(body.data.kind, body.data.id);
        invalidateExtensionsCache();
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: error instanceof Error ? error.message : 'Uninstall failed',
        });
    }

    return { ok: true };
});
