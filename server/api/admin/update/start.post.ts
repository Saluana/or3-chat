import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { DashboardOperatorError, startDashboardUpdate } from '../../../admin/update/operator-client';

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const versionPattern = /^\d+\.\d+\.\d+$/;

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
    const body = await readBody<{ requestId?: unknown; targetVersion?: unknown }>(event);
    if (typeof body?.requestId !== 'string' || !requestIdPattern.test(body.requestId) || typeof body.targetVersion !== 'string' || !versionPattern.test(body.targetVersion)) {
        throw createError({ statusCode: 400, statusMessage: 'A valid update request is required.' });
    }
    try {
        const result = await startDashboardUpdate(body.requestId, body.targetVersion);
        setResponseStatus(event, 202);
        return result;
    } catch (error) {
        if (error instanceof DashboardOperatorError) {
            throw createError({ statusCode: error.statusCode, statusMessage: error.message });
        }
        throw error;
    }
});
