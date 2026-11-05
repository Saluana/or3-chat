import { createError, defineEventHandler } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { readLimitedJsonBody, STORAGE_CONTROL_BODY_LIMIT_BYTES } from '../../../utils/security/limited-json-body';
import { setNoCacheHeaders } from '../../../utils/headers';
import { WORKSPACE_MODELS_KEY, WorkspaceModelsSchema } from '~~/shared/ai/workspace-models';

export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    const context = await requireAdminApiContext(event, { ownerOnly: true, mutation: true, allowWorkspaceAdmin: true });
    enforceGenericAdminRateLimit(event, 'workspace-models-save');
    const parsed = z.object({ workspaceId: z.string().min(1).max(256).optional(), policy: WorkspaceModelsSchema }).strict()
        .safeParse(await readLimitedJsonBody(event, STORAGE_CONTROL_BODY_LIMIT_BYTES));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Check your model choices. Hidden models cannot be pinned or set as the default.' });
    const workspaceId = resolveAdminWorkspaceTarget(context, parsed.data.workspaceId);
    await getWorkspaceSettingsStore(event).set(workspaceId, WORKSPACE_MODELS_KEY, JSON.stringify(parsed.data.policy));
    return { ok: true };
});
