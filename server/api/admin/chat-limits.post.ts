import { createError, defineEventHandler } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../admin/api';
import { isSuperAdmin } from '../../admin/context';
import { resolveAdminWorkspaceTarget } from '../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { enforceGenericAdminRateLimit } from '../../admin/auth/rate-limit';
import { saveSiteSettings } from '../../admin/config/site-settings';
import { readLimitedJsonBody, STORAGE_CONTROL_BODY_LIMIT_BYTES } from '../../utils/security/limited-json-body';
import { setNoCacheHeaders } from '../../utils/headers';
import { instanceChatLimits } from '../../utils/chat/chat-limits';
import { CHAT_LIMITS_KEY, ChatLimitsSchema } from '~~/shared/chat/chat-limits';

export default defineEventHandler(async event => {
    const context = await requireAdminApiContext(event, { ownerOnly: true, mutation: true, allowWorkspaceAdmin: true });
    setNoCacheHeaders(event);
    enforceGenericAdminRateLimit(event, 'chat-limits-save');
    const parsed = z.object({ scope: z.enum(['instance', 'workspace']), workspaceId: z.string().min(1).max(256).optional(),
        limits: ChatLimitsSchema.nullable(), revision: z.string().min(1).max(128).optional() }).strict()
        .safeParse(await readLimitedJsonBody(event, STORAGE_CONTROL_BODY_LIMIT_BYTES));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid chat limits.' });
    const { scope, limits, workspaceId, revision } = parsed.data;
    if (scope === 'instance') {
        if (!isSuperAdmin(context)) throw createError({ statusCode: 403 });
        if (!limits || !revision) throw createError({ statusCode: 400, statusMessage: 'Instance limits and revision are required.' });
        return saveSiteSettings(useRuntimeConfig(event), [
            { key: 'OR3_CHAT_TOOL_ITERATIONS', value: String(limits.toolIterations) },
            { key: 'OR3_CHAT_GENERATED_IMAGES', value: String(limits.generatedImages) },
        ], revision);
    }
    const target = resolveAdminWorkspaceTarget(context, workspaceId);
    const instance = instanceChatLimits(event);
    if (limits && (limits.toolIterations > instance.toolIterations || limits.generatedImages > instance.generatedImages))
        throw createError({ statusCode: 400, statusMessage: 'Workspace limits cannot exceed the instance limits.' });
    await getWorkspaceSettingsStore(event).set(target, CHAT_LIMITS_KEY, JSON.stringify(limits));
    return { ok: true };
});
