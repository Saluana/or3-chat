import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { z } from 'zod';
import { checkPluginAccess } from '../../utils/plugins/access/require-plugin-access';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import type { PluginGateDecision } from '~~/shared/plugins/access-policy';

const PluginIdSchema = z.string().min(1).max(256);
const QuerySchema = z.union([
    z.object({ pluginId: PluginIdSchema, pluginIds: z.undefined().optional() }),
    z.object({
        pluginId: z.undefined().optional(),
        pluginIds: z.union([PluginIdSchema.transform(id => [id]), z.array(PluginIdSchema).min(1).max(50)]),
    }),
]);

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const pluginIds = parsed.data.pluginIds ?? [parsed.data.pluginId!];
    const decisions = Object.create(null) as Record<string, PluginGateDecision>;
    // Sequential checks share request-scoped session, inventory and entitlement
    // reads. Each plugin still goes through the existing authorization policy.
    for (const pluginId of new Set(pluginIds)) {
        const result = await checkPluginAccess(event, { pluginId, action: 'view' });
        decisions[pluginId] = result.decision;
    }

    return parsed.data.pluginIds
        ? { decisions }
        : decisions[parsed.data.pluginId!];
});
