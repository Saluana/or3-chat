import { createError, defineEventHandler, getQuery } from 'h3';
import { z } from 'zod';
import { checkPluginAccess } from '../../plugins/access/require-plugin-access';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';

const QuerySchema = z.object({
    pluginId: z.string().min(1),
});

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const result = await checkPluginAccess(event, {
        pluginId: parsed.data.pluginId,
        action: 'view',
    });

    return {
        allowed: result.decision.allowed,
        reasons: result.decision.reasons,
        effectivePolicy: result.decision.effectivePolicy,
    };
});
