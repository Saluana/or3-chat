import { defineEventHandler } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { getDashboardUpdateStatus } from '../../../admin/update/operator-client';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { superAdminOnly: true });
    return await getDashboardUpdateStatus();
});
