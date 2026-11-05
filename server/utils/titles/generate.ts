import { useRuntimeConfig } from '#imports';
import type { H3Event } from 'h3';
import { getOpenRouterChatCompletionsUrl } from '~~/shared/openrouter/url';
import { DEFAULT_HEADERS } from '~~/shared/openrouter/request-options';
import { createOpenRouterCompletionAdapter } from '~~/shared/openrouter/adapter';
import { createOpenAiCompletionAdapter } from '~~/shared/openai/adapter';
import { isOpenAiModel, openAiApiModel, openAiApiUrl, openAiReasoningEfforts } from '~~/shared/openai/models';
import { createAiRuntime } from '~~/shared/ai/runtime';
import type { AiCompletionRequest } from '~~/shared/ai/types';
import { cleanGeneratedTitle, TITLE_TIMEOUT_MS, titlePrompt, type TitleRequest } from '~~/shared/titles/title';

/** One small non-streaming request on the fast model's router. No tools, retries, searches or secret-bearing diagnostics. */
export async function generateTitle(event: H3Event, input: TitleRequest, model: string, apiKey: string): Promise<string> {
    const openAi = isOpenAiModel(model);
    const config = useRuntimeConfig(event);
    const request: AiCompletionRequest = { model: { routerId: openAi ? 'openai' : 'openrouter', modelId: model },
        maxOutputTokens: openAi && openAiReasoningEfforts(openAiApiModel(model))?.includes('none') === false ? 2048 : 48,
        reasoning: { kind: 'disabled' },
        // Delimit the source and restate the task after it: a bare request such as
        // "write 60 lines" is otherwise carried out and truncated at max_tokens.
        messages: [{ role: 'system', content: titlePrompt(input.type) },
            { role: 'user', content: `<source>\n${input.content}\n</source>\n\nTitle for the source above:` }] };
    const adapter = openAi ? createOpenAiCompletionAdapter() : createOpenRouterCompletionAdapter({ explicitStreamFalse: true });
    const runtime = createAiRuntime(adapter, async prepared => {
        const response = await fetch(openAi ? openAiApiUrl(config.openaiBaseUrl, 'chat/completions') : getOpenRouterChatCompletionsUrl(config.openrouterBaseUrl), {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
            headers: { ...(openAi ? {} : DEFAULT_HEADERS), 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(prepared),
        });
        if (!response.ok) throw new Error('Title provider unavailable.');
        return response;
    });
    const result = await runtime.complete(request);
    const title = result.finishReason === 'length' ? null : cleanGeneratedTitle(result.content);
    if (!title) throw new Error('Invalid title response.');
    return title;
}
