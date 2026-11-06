import { defineEventHandler } from 'h3';
import { requireSupportAdmin } from '../../../admin/customers';
import { getDashboardRecoveryStatus } from '../../../admin/update/operator-client';

export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    return await getDashboardRecoveryStatus();
});
