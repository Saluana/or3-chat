import { createError, defineEventHandler } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { readLimitedJsonBody, STORAGE_CONTROL_BODY_LIMIT_BYTES } from '../../../utils/security/limited-json-body';
import { setNoCacheHeaders } from '../../../utils/headers';
import { FILE_POLICY_KEY, FilePolicySchema } from '~~/shared/storage/file-policy';

export default defineEventHandler(async event => {
    const context = await requireAdminApiContext(event, { ownerOnly: true, mutation: true, allowWorkspaceAdmin: true });
    setNoCacheHeaders(event);
    enforceGenericAdminRateLimit(event, 'file-policy-save');
    const input = z.object({ workspaceId: z.string().min(1).max(256).optional(), policy: FilePolicySchema }).strict()
        .safeParse(await readLimitedJsonBody(event, STORAGE_CONTROL_BODY_LIMIT_BYTES));
    if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Invalid file cache settings' });
    const workspaceId = resolveAdminWorkspaceTarget(context, input.data.workspaceId);
    await getWorkspaceSettingsStore(event).set(workspaceId, FILE_POLICY_KEY, JSON.stringify(input.data.policy));
    return { ok: true };
});
