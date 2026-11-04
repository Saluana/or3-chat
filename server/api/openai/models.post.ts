import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { resolveOpenAiCredential } from '../../secrets/openai';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { checkRateLimit } from '../../utils/rate-limit';
import { resolveSessionContext } from '../../auth/session';
import { fetchOpenAiCatalog } from '~~/shared/openai/models';

/** OpenAI chat models for the caller's key; no key is an empty list, not an error. */
export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    requireCloudMutation(event);
    const session = isSsrAuthEnabled(event) ? await resolveSessionContext(event) : null;
    const { apiKey } = await resolveOpenAiCredential(event, session);
    if (!apiKey) return [];
    if (!await checkRateLimit(`openai-models:${session?.user?.id ?? 'local'}`, { max: 30, window: 60 })) throw createError({ statusCode: 429 });
    try {
        return await fetchOpenAiCatalog(apiKey, useRuntimeConfig(event).openaiBaseUrl);
    } catch { throw createError({ statusCode: 502, statusMessage: 'OpenAI model list unavailable.' }); }
});
