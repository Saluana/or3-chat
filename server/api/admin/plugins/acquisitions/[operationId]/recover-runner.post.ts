/** Explicit recovery after an operator has verified a remote runner host stopped. */
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { PluginAcquisitionOperationError, PluginAcquisitionOperationStore } from '../../../../../utils/plugins/acquisition/operation-store';

const BodySchema = z.object({
    expectedOwnerId: z.string().uuid(),
    confirmedHostStopped: z.literal(true),
});

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
    });
    const operationId = getRouterParam(event, 'operationId');
    const body = BodySchema.safeParse(await readBody(event));
    if (!operationId || !body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Exact owner ID and host-stopped confirmation required' });
    }
    const store = new PluginAcquisitionOperationStore();
    const recovered = await store.recoverRemoteRunner(operationId, body.data.expectedOwnerId).catch((error: unknown) => {
        if (error instanceof PluginAcquisitionOperationError && error.code === 'operation-not-found') {
            throw createError({ statusCode: 404, statusMessage: 'No such acquisition operation' });
        }
        throw error;
    });
    if (!recovered) {
        throw createError({ statusCode: 409, statusMessage: 'Runner owner changed, is local, or is still heartbeating' });
    }
    return { ok: true, operationId, recovered: true };
});
