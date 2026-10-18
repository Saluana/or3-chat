import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { hasRestartController, readRestartStatus } from '../../../admin/system/server-control';
import { getShutdownRuntime } from '../../../utils/shutdown/runtime';
import { getJobProvider, isBackgroundStreamingEnabled } from '../../../utils/background-jobs/store';
import { useRuntimeConfig } from '#imports';

export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true, superAdminCookieOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const requestId = getQuery(event).requestId;
    if (!hasRestartController()) return {
        capability: { mode: 'unsupported', restart: false, applySaved: false, rebuild: false, reason: 'restart_unsupported' },
        bootId: getShutdownRuntime().bootId, activeRevision: null, savedRevision: null, operation: null,
    };
    if (requestId !== undefined && typeof requestId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid restart request identity' });
    const result = await readRestartStatus(requestId);
    if (!useRuntimeConfig(event).admin.allowRestart) result.capability = { ...result.capability, restart: false, reason: 'restart_disabled' };
    if (isBackgroundStreamingEnabled() && !(await getJobProvider()).getShutdownBlockerCount) {
        result.capability = { ...result.capability, restart: false, reason: 'background_drain_unsupported' };
    }
    return result;
});
