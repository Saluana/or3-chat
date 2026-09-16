import { createError, defineEventHandler } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { DashboardOperatorError, previewDashboardUpdate } from '../../../admin/update/operator-client';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
    try {
        return await previewDashboardUpdate();
    } catch (error) {
        if (error instanceof DashboardOperatorError) {
            throw createError({ statusCode: error.statusCode, statusMessage: error.message });
        }
        throw error;
    }
});
