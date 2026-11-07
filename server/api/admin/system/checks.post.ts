import { defineEventHandler } from 'h3';
import { requireSupportAdmin } from '../../../admin/customers';
import { readProviderStatuses } from '../../../admin/providers/checks';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';

export default defineEventHandler(async (event) => {
    await requireSupportAdmin(event, { mutation: true });
    enforceGenericAdminRateLimit(event, 'provider-checks');
    return { providers: await readProviderStatuses(event, useRuntimeConfig(event), true) };
});
