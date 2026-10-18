import { defineEventHandler, readBody, setResponseHeader, setResponseStatus } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireAdminApiContext } from '../../../admin/api';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { callRestartController, parseRestartOperation, restartControlError } from '../../../admin/system/server-control';
import { restartRequestSchema } from '../../../../shared/server/restarts/controller';
import { getJobProvider, isBackgroundStreamingEnabled } from '../../../utils/background-jobs/store';

export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true, superAdminCookieOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    enforceGenericAdminRateLimit(event, 'server-restart');
    if (!useRuntimeConfig(event).admin.allowRestart) return restartControlError('restart_disabled', 501);
    if (isBackgroundStreamingEnabled() && !(await getJobProvider()).getShutdownBlockerCount) return restartControlError('background_drain_unsupported', 501);
    const body = restartRequestSchema.safeParse(await readBody(event));
    if (!body.success) return restartControlError('invalid_request', 400);
    const operation = parseRestartOperation(await callRestartController('start', body.data));
    setResponseStatus(event, 202);
    return { operation };
});
