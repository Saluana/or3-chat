export type OpenRouterCacheControl = {
    type: 'ephemeral';
    ttl?: '1h';
};

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
