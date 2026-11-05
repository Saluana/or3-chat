import { defineEventHandler, getQuery } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireAdminApiContext } from '../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { setNoCacheHeaders } from '../../../utils/headers';
import { resolveOpenAiCredential } from '../../../secrets/openai';
import { resolveOpenRouterCredential } from '../../../secrets/openrouter';
import { fetchOpenAiCatalog } from '~~/shared/openai/models';
import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';

/** Admin discovery does not require a chat login or borrow another workspace's personal keys. */
export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    const context = await requireAdminApiContext(event, { ownerOnly: true, allowWorkspaceAdmin: true });
    const workspaceId = resolveAdminWorkspaceTarget(context, getQuery(event).workspaceId);
    enforceGenericAdminRateLimit(event, 'workspace-model-catalog');
    const config = useRuntimeConfig(event);
    const ownSession = context.session?.workspace?.id === workspaceId ? context.session : undefined;
    const results = await Promise.allSettled([
        (async () => {
            const apiKey = ownSession ? (await resolveOpenRouterCredential(event, ownSession)).apiKey
                : config.openrouterApiKey || process.env.OPENROUTER_API_KEY || undefined;
            return fetchOpenRouterCatalog(createOpenRouterClient({ apiKey, serverURL: config.openrouterBaseUrl }), undefined, { deadlineMs: 15000 });
        })(),
        (async () => {
            const apiKey = ownSession ? (await resolveOpenAiCredential(event, ownSession)).apiKey : config.openaiApiKey;
            return apiKey ? fetchOpenAiCatalog(apiKey, config.openaiBaseUrl) : [];
        })(),
    ]);
    return {
        data: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
        unavailable: results.flatMap((result, index) => result.status === 'rejected' ? [index === 0 ? 'OpenRouter' : 'OpenAI'] : []),
    };
});
