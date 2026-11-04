import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { fetchWithResponseDeadline } from '~~/shared/openrouter/deadlines';
import { getOpenRouterChatCompletionsUrl } from '~~/shared/openrouter/url';
import { encodeOpenAiRequest } from '~~/shared/openai/adapter';
import { isOpenAiModel, openAiApiUrl } from '~~/shared/openai/models';
import { resolveOpenRouterCredential } from '../../secrets/openrouter';
import { resolveOpenAiCredential } from '../../secrets/openai';

/** The chat model's router owns billing; callers keep their own authorization and limits. */
export function resolveChatCredential(event: H3Event, model: unknown, session?: SessionContext | null) {
    return isOpenAiModel(model) ? resolveOpenAiCredential(event, session) : resolveOpenRouterCredential(event, session);
}

function chatConfig(): { openrouterBaseUrl?: string; openaiBaseUrl?: string } {
    // Detached background work can run without a Nitro request context.
    try { return useRuntimeConfig(); } catch { return {}; }
}

/** One host-configured upstream request for an admitted provider body. */
export function openChatUpstream(body: Record<string, unknown>, apiKey: string,
    options: { referer?: string; signal?: AbortSignal }): Promise<Response> {
    const config = chatConfig();
    const openAi = isOpenAiModel(body.model);
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    // OpenRouter app attribution; OpenAI has no equivalent.
    if (!openAi) Object.assign(headers, { 'X-Title': 'or3.chat', ...(options.referer ? { 'HTTP-Referer': options.referer } : {}) });
    return fetchWithResponseDeadline(openAi ? openAiApiUrl(config.openaiBaseUrl, 'chat/completions') : getOpenRouterChatCompletionsUrl(config.openrouterBaseUrl), {
        method: 'POST', headers, body: JSON.stringify(openAi ? encodeOpenAiRequest(body) : body),
    }, { signal: options.signal });
}
