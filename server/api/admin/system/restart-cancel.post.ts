import { defineEventHandler, readBody, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { callRestartController, parseRestartOperation, restartControlError } from '../../../admin/system/server-control';
import { getShutdownRuntime } from '../../../utils/shutdown/runtime';

export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true, superAdminCookieOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    enforceGenericAdminRateLimit(event, 'restart-cancel');
    const input = z.object({ requestId: z.string().uuid() }).strict().safeParse(await readBody(event));
    if (!input.success) return restartControlError('invalid_request', 400);
    const operation = parseRestartOperation(await callRestartController('cancel', input.data));
    if (operation.phase === 'cancelled') getShutdownRuntime().controller.cancel(input.data.requestId);
    return { operation };
});
