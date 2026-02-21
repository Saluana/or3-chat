import { createError, defineEventHandler, getQuery } from 'h3';
import { z } from 'zod';
import { requireCan } from '../../auth/can';
import { requirePluginAccess } from '../../utils/plugins/access/require-plugin-access';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';

const QuerySchema = z.object({
    pluginId: z.string().min(1),
});

/**
 * Representative protected plugin route.
 * Plugin access gate is enforced first, then resource-level `can()`.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const { session, decision } = await requirePluginAccess(event, {
        pluginId: parsed.data.pluginId,
        action: 'protected:get',
    });

    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: session.workspace?.id,
    });

    return {
        ok: true,
        pluginId: parsed.data.pluginId,
        reasons: decision.reasons,
    };
});
