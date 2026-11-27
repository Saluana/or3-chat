import { createError, defineEventHandler } from 'h3';
import { requireSupportAdmin } from '../../admin/customers';
import { listChatReports, requireChatReportsEnabled } from '../../admin/chat-reports';
import { enforceGenericAdminRateLimit } from '../../admin/auth/rate-limit';

export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    requireChatReportsEnabled(event);
    enforceGenericAdminRateLimit(event, 'chat-diagnostic-reports');
    try {
        return { reports: await listChatReports() };
    } catch {
        throw createError({ statusCode: 503, statusMessage: 'Report inbox unavailable.' });
    }
});
