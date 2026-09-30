import { createError, defineEventHandler, getRouterParam } from 'h3';
import {
    requireConnectionApiContext,
    requirePluginMutation,
} from '../../../utils/plugins/connections/api-context';

/** Deletes one of the caller's connections. */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const context = await requireConnectionApiContext(event);
    const id = getRouterParam(event, 'id') ?? '';
    const result = await context.service.delete({
        connectionId: id,
        ownerUserId: context.userId,
    });
    if (result.status !== 'deleted') {
        throw createError({
            statusCode: result.code === 'connection-not-found' ? 404 : 403,
            statusMessage: result.message,
        });
    }
    return { ok: true };
});
