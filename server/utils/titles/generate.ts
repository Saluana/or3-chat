import { useRuntimeConfig } from '#imports';
import type { H3Event } from 'h3';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { getOpenRouterChatCompletionsUrl } from '~~/shared/openrouter/url';
import { DEFAULT_HEADERS } from '~~/shared/openrouter/request-options';
import { cleanGeneratedTitle, DEFAULT_TITLE_MODEL, TITLE_MODEL_SETTING, TITLE_TIMEOUT_MS, TitleModelSchema, titlePrompt, type TitleRequest } from '~~/shared/titles/title';

export async function readTitleModel(event: H3Event, workspaceId: string): Promise<string> {
    try {
        const stored = await getWorkspaceSettingsStore(event).get(workspaceId, TITLE_MODEL_SETTING);
        return TitleModelSchema.safeParse(stored).data ?? DEFAULT_TITLE_MODEL;
    } catch { throw new Error('Title model settings unavailable.'); }
}

/** One small non-streaming request. No tools, retries, searches or secret-bearing diagnostics. */
export async function generateTitle(event: H3Event, input: TitleRequest, model: string, apiKey: string): Promise<string> {
    const response = await fetch(getOpenRouterChatCompletionsUrl(useRuntimeConfig(event).openrouterBaseUrl), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
        headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, stream: false, max_tokens: 48, reasoning: { effort: 'none' },
            // Delimit the source and restate the task after it: a bare request such as
            // "write 60 lines" is otherwise carried out and truncated at max_tokens.
            messages: [{ role: 'system', content: titlePrompt(input.type) },
                { role: 'user', content: `<source>\n${input.content}\n</source>\n\nTitle for the source above:` }] }),
    });
    if (!response.ok) throw new Error('Title provider unavailable.');
    const result = await response.json() as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] };
    const choice = result.choices?.[0];
    const title = choice?.finish_reason === 'length' ? null : cleanGeneratedTitle(choice?.message?.content);
    if (!title) throw new Error('Invalid title response.');
    return title;
}
