import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requireSupportAdmin, requireTargetId } from '../../../admin/customers';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { runStorageCleanupBatch } from '../../../utils/storage/reclamation';

const inputSchema = z.object({ workspaceId: z.string(), cursor: z.string().optional(), generationIds: z.array(z.string().regex(/^[A-Za-z0-9_.:@-]{1,200}$/)).min(1).max(25) }).strict();
export default defineEventHandler(async event => {
    const actor = await requireSupportAdmin(event, { mutation: true });
    enforceGenericAdminRateLimit(event, 'storage-cleanup');
    const parsed = inputSchema.safeParse(await readBody(event));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid cleanup request' });
    if (new Set(parsed.data.generationIds).size !== parsed.data.generationIds.length) throw createError({ statusCode: 400, statusMessage: 'Duplicate generation' });
    const workspaceId = requireTargetId(parsed.data.workspaceId);
    const cursor = parsed.data.cursor === undefined ? undefined : requireTargetId(parsed.data.cursor);
    return runStorageCleanupBatch(actor, { workspaceId, cursor, generationIds: parsed.data.generationIds });
});
