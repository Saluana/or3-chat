import type { OpenRouterModel } from '../openrouter/types';

/** Direct-OpenAI model IDs. The prefix keeps them apart from OpenRouter's `openai/…` routes. */
export const OPENAI_MODEL_PREFIX = '@openai/';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export function isOpenAiModel(model: unknown): model is string {
    return typeof model === 'string' && model.startsWith(OPENAI_MODEL_PREFIX);
}

/** The ID OpenAI itself expects. */
export function openAiApiModel(model: string): string {
    return isOpenAiModel(model) ? model.slice(OPENAI_MODEL_PREFIX.length) : model;
}

export function openAiApiUrl(baseUrl: unknown, path: 'chat/completions' | 'models' | 'decisions'): string {
    const base = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : DEFAULT_OPENAI_BASE_URL;
    return `${base.replace(/\/+$/, '')}/${path}`;
}

// Chat Completions models only. Responses-only, audio, image and embedding models have no chat surface here.
const CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/;
const EXCLUDED_MODEL = /embedding|tts|whisper|transcribe|audio|realtime|image|moderation|search|computer-use|codex|deep-research|instruct|-pro\b|^ft:|:/;
const GPT5_OR_LATER = /^gpt-([5-9]|\d{2})/;

/** Efforts each family accepts, from the API's own refusals; null when a model takes no effort at all. */
export function openAiReasoningEfforts(id: string): readonly string[] | null {
    if (id.includes('-chat')) return null;
    if (/^o\d/.test(id)) return ['low', 'medium', 'high'];
    if (/^gpt-5(-|$)/.test(id)) return ['minimal', 'low', 'medium', 'high'];
    if (GPT5_OR_LATER.test(id)) return ['none', 'low', 'medium', 'high', 'xhigh'];
    return null;
}

/** Host capacity table: OpenAI's model list reports neither limits nor capabilities. */
function capacity(id: string): { context: number; output: number } {
    if (id.startsWith('gpt-4.1')) return { context: 1_047_576, output: 32_768 };
    if (GPT5_OR_LATER.test(id)) return { context: 400_000, output: 128_000 };
    if (/^o\d/.test(id)) return { context: 200_000, output: 100_000 };
    if (id.startsWith('gpt-3.5')) return { context: 16_385, output: 4_096 };
    if (/^gpt-4(-\d{4})?$/.test(id)) return { context: 8_192, output: 8_192 };
    return { context: 128_000, output: 16_384 };
}

/** Map `GET /models` entries to the catalog shape chat already uses for capacity and capabilities. */
export function mapOpenAiModels(list: readonly { id: string; created?: number }[]): OpenRouterModel[] {
    return list.filter(entry => CHAT_MODEL.test(entry.id) && !EXCLUDED_MODEL.test(entry.id))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((entry) => {
            const { context, output } = capacity(entry.id);
            const efforts = openAiReasoningEfforts(entry.id);
            const vision = !/^(gpt-3\.5|gpt-4(-\d{4})?$|o1-mini|o3-mini)/.test(entry.id);
            const tools = !/^(o1-mini|o1-preview|chatgpt-)/.test(entry.id);
            const id = OPENAI_MODEL_PREFIX + entry.id;
            return {
                id, canonical_slug: id, name: `${entry.id} (OpenAI key)`, created: entry.created,
                context_length: context, top_provider: { context_length: context, max_completion_tokens: output },
                architecture: { input_modalities: vision ? ['text', 'image'] : ['text'], output_modalities: ['text'] },
                supported_parameters: ['max_tokens', ...(tools ? ['tools', 'tool_choice'] : []), ...(efforts ? ['reasoning'] : [])],
                // Only gpt-5.1 and later can switch reasoning off.
                ...(efforts ? { reasoning: { supported_efforts: ['low', 'medium', 'high'], default_effort: 'medium',
                    mandatory: !efforts.includes('none') } } : {}),
            } satisfies OpenRouterModel;
        });
}

/** One bounded catalog read with the caller's credential; failures are the caller's to present. */
export async function fetchOpenAiCatalog(apiKey: string, baseUrl: unknown, signal?: AbortSignal): Promise<OpenRouterModel[]> {
    const url = openAiApiUrl(baseUrl, 'models');
    const deadline = AbortSignal.timeout(15_000);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` },
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    if (!response.ok) throw new Error(`OpenAI model list failed with ${response.status}.`);
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error('OpenAI model list was malformed.');
    return mapOpenAiModels(body.data.filter((entry): entry is { id: string; created?: number } =>
        !!entry && typeof (entry as { id?: unknown }).id === 'string'));
}
