export type OpenRouterCacheControl = {
    type: 'ephemeral';
    ttl?: '1h';
};

/** Translate persisted legacy Online selections at the provider boundary. */
export function prepareOpenRouterWebSearch<T extends { model?: unknown; tools?: unknown }>(body: T): T {
    if (typeof body.model !== 'string' || !body.model.endsWith(':online')) return body;
    const tools = Array.isArray(body.tools) ? body.tools : [];
    return {
        ...body,
        model: body.model.slice(0, -':online'.length),
        tools: tools.some((tool) => tool && typeof tool === 'object' && tool.type === 'openrouter:web_search')
            ? tools : [...tools, { type: 'openrouter:web_search' }],
    };
}

export function normalizeOpenRouterModelId(modelId: string): string {
    return modelId
        .replace(/:online$/, '')
        .replace(/:thinking$/, '')
        .replace(/^~/, '');
}

export function isAnthropicModel(modelId: string): boolean {
    return normalizeOpenRouterModelId(modelId).startsWith('anthropic/');
}

export function getAnthropicPromptCacheControl(
    modelId: string
): OpenRouterCacheControl | undefined {
    if (!isAnthropicModel(modelId)) return undefined;
    return { type: 'ephemeral' };
}
