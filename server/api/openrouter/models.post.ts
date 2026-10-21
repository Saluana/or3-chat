import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { resolveOpenRouterCredential } from '../../secrets/openrouter';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { checkRateLimit } from '../../utils/rate-limit';
import { resolveSessionContext } from '../../auth/session';
import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404 });
    requireCloudMutation(event);
    const session = await resolveSessionContext(event);
    const { apiKey } = await resolveOpenRouterCredential(event, session);
    if (!await checkRateLimit(`openrouter-models:${session.user!.id}`, { max: 30, window: 60 })) throw createError({ statusCode: 429 });
    try {
        return await fetchOpenRouterCatalog(createOpenRouterClient({ apiKey, serverURL: useRuntimeConfig().openrouterBaseUrl }), undefined, { deadlineMs: 15000 });
    } catch { throw createError({ statusCode: 502, statusMessage: 'OpenRouter model catalog unavailable.' }); }
});
