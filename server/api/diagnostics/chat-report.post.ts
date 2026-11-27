import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3';
import { CHAT_REPORT_INTENT, chatReportSchema } from '~~/shared/diagnostics/chat-report';
import { requireChatReportsEnabled, saveChatReport } from '../../admin/chat-reports';
import { resolveSessionContext } from '../../auth/session';
import { checkRateLimit } from '../../utils/rate-limit';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { requireSameOriginMutation } from '../../utils/security/mutation-guard';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    requireChatReportsEnabled(event);
    requireSameOriginMutation(event, { intentHeader: 'x-or3-cloud-intent', intentValue: CHAT_REPORT_INTENT, requireJson: true });
    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user?.id) throw createError({ statusCode: 401, statusMessage: 'Sign in to send diagnostics.' });
    if (getHeader(event, 'x-or3-account') !== JSON.stringify([session.provider, session.user.id])) {
        throw createError({ statusCode: 409, statusMessage: 'The signed-in account changed.' });
    }
    if (!await checkRateLimit(`chat-report:${session.user.id}`, { max: 6, window: 600 })) {
        setResponseHeader(event, 'Retry-After', '600');
        throw createError({ statusCode: 429, statusMessage: 'Too many diagnostic reports.' });
    }
    const parsed = chatReportSchema.safeParse(await readLimitedJsonBody(event, 1024));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid diagnostic report.' });
    try {
        return await saveChatReport(parsed.data);
    } catch {
        throw createError({ statusCode: 503, statusMessage: 'Report inbox unavailable.' });
    }
});
