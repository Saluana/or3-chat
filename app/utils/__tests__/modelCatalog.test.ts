import { describe, expect, it } from 'vitest';
import type { OpenRouterModel } from '~/core/auth/models-service';
import {
    countByProvider,
    formatModalities,
    formatPerMillion,
    formatReleaseDate,
    formatTokenCount,
    getBestForTags,
    getCapabilities,
    getContextLength,
    getModelBadges,
    getModelProvider,
    getProviderInfo,
    getProviderSlug,
    matchesCapability,
    sortModels,
} from '../modelCatalog';

function makeModel(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
    return {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        ...overrides,
    } as OpenRouterModel;
}

describe('getProviderSlug', () => {
    it('extracts prefix before slash', () => {
        expect(getProviderSlug(makeModel({ id: 'anthropic/claude-3.5-sonnet' }))).toBe('anthropic');
        expect(getProviderSlug(makeModel({ id: 'x-ai/grok-2' }))).toBe('x-ai');
    });

    it('handles ids without a slash', () => {
        expect(getProviderSlug(makeModel({ id: 'local-model' }))).toBe('local-model');
    });

    it('lowercases the slug', () => {
        expect(getProviderSlug(makeModel({ id: 'OpenAI/GPT-4' }))).toBe('openai');
    });
});

describe('getProviderInfo', () => {
    it('returns registry entries with icons', () => {
        const p = getProviderInfo('anthropic');
        expect(p.name).toBe('Anthropic');
        expect(p.icon).toBe('anthropic');
        expect(p.color).toBe('#D97757');
    });

    it('falls back gracefully for unknown providers', () => {
        const p = getProviderInfo('acme-labs');
        expect(p.name).toBe('Acme Labs');
        expect(p.icon).toBeUndefined();
        expect(p.monogram).toBe('A');
    });

    it('resolves from a model', () => {
        expect(getModelProvider(makeModel({ id: 'deepseek/deepseek-r1' })).name).toBe('DeepSeek');
    });
});

describe('getCapabilities', () => {
    it('detects vision from input modalities', () => {
        const m = makeModel({
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        });
        const caps = getCapabilities(m);
        expect(caps.vision).toBe(true);
        expect(caps.multimodal).toBe(true);
        expect(caps.imageOutput).toBe(false);
    });

    it('detects tools, json and reasoning from supported_parameters', () => {
        const m = makeModel({
            supported_parameters: ['tools', 'response_format', 'reasoning'],
        });
        const caps = getCapabilities(m);
        expect(caps.tools).toBe(true);
        expect(caps.json).toBe(true);
        expect(caps.reasoning).toBe(true);
    });

    it('detects reasoning from the reasoning object', () => {
        const m = makeModel({ reasoning: { default_enabled: true } });
        expect(getCapabilities(m).reasoning).toBe(true);
    });

    it('detects free models', () => {
        const m = makeModel({ pricing: { prompt: '0', completion: '0' } });
        expect(getCapabilities(m).free).toBe(true);
    });

    it('detects cost effective models', () => {
        const cheap = makeModel({ pricing: { prompt: '0.0000001', completion: '0.0000001' } });
        expect(getCapabilities(cheap).costEffective).toBe(true);
        const pricey = makeModel({ pricing: { prompt: '0.000003', completion: '0.000015' } });
        expect(getCapabilities(pricey).costEffective).toBe(false);
    });

    it('detects long context', () => {
        const m = makeModel({ context_length: 200_000 });
        expect(getCapabilities(m).longContext).toBe(true);
        const small = makeModel({ context_length: 8_192 });
        expect(getCapabilities(small).longContext).toBe(false);
    });

    it('prefers top_provider context length', () => {
        const m = makeModel({
            context_length: 8_192,
            top_provider: { context_length: 131_072 },
        });
        expect(getContextLength(m)).toBe(131_072);
        expect(getCapabilities(m).longContext).toBe(true);
    });

    it('detects open weights families by name', () => {
        expect(getCapabilities(makeModel({ id: 'meta-llama/llama-3.1-405b' })).openWeights).toBe(true);
        expect(getCapabilities(makeModel({ id: 'openai/gpt-4o' })).openWeights).toBe(false);
        expect(getCapabilities(makeModel({ id: 'openai/gpt-oss-120b' })).openWeights).toBe(true);
    });

    it('detects embedding models', () => {
        const m = makeModel({
            id: 'openai/text-embedding-3-large',
            architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] },
        });
        expect(getCapabilities(m).embedding).toBe(true);
    });
});

describe('matchesCapability', () => {
    const visionTools = makeModel({
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        supported_parameters: ['tools'],
    });
    const plainText = makeModel({ id: 'anthropic/claude-2', name: 'Claude 2' });

    it('all matches everything', () => {
        expect(matchesCapability(visionTools, 'all')).toBe(true);
    });

    it('vision filter', () => {
        expect(matchesCapability(visionTools, 'vision')).toBe(true);
        expect(matchesCapability(plainText, 'vision')).toBe(false);
    });

    it('text filter excludes multimodal', () => {
        expect(matchesCapability(visionTools, 'text')).toBe(false);
        expect(matchesCapability(plainText, 'text')).toBe(true);
    });

    it('tools filter', () => {
        expect(matchesCapability(visionTools, 'tools')).toBe(true);
        expect(matchesCapability(plainText, 'tools')).toBe(false);
    });
});

describe('sortModels', () => {
    const a = makeModel({ id: 'b/a', name: 'Alpha', pricing: { prompt: '0.000002', completion: '0.000002' }, context_length: 8_000, created: 100 });
    const b = makeModel({ id: 'a/b', name: 'Beta', pricing: { prompt: '0.000001', completion: '0' }, context_length: 200_000, created: 200 });

    it('recommended preserves order', () => {
        expect(sortModels([a, b], 'recommended')).toEqual([a, b]);
    });

    it('name sorts alphabetically', () => {
        expect(sortModels([a, b], 'name').map((m) => m.name)).toEqual(['Alpha', 'Beta']);
    });

    it('price ascending', () => {
        expect(sortModels([a, b], 'price-asc').map((m) => m.name)).toEqual(['Beta', 'Alpha']);
    });

    it('price descending', () => {
        expect(sortModels([a, b], 'price-desc').map((m) => m.name)).toEqual(['Alpha', 'Beta']);
    });

    it('context descending', () => {
        expect(sortModels([a, b], 'context-desc').map((m) => m.name)).toEqual(['Beta', 'Alpha']);
    });

    it('newest first', () => {
        expect(sortModels([a, b], 'newest').map((m) => m.name)).toEqual(['Beta', 'Alpha']);
    });

    it('does not mutate the input array', () => {
        const input = [a, b];
        sortModels(input, 'name');
        expect(input[0]).toBe(a);
    });
});

describe('countByProvider', () => {
    it('counts and sorts by count desc', () => {
        const models = [
            makeModel({ id: 'openai/gpt-4o' }),
            makeModel({ id: 'openai/gpt-4o-mini' }),
            makeModel({ id: 'anthropic/claude-3.5' }),
        ];
        const counts = countByProvider(models);
        expect(counts[0]).toMatchObject({ slug: 'openai', count: 2 });
        expect(counts[1]).toMatchObject({ slug: 'anthropic', count: 1 });
        expect(counts[0]!.info.name).toBe('OpenAI');
    });
});

describe('getModelBadges', () => {
    it('prioritizes free and caps at max', () => {
        const m = makeModel({
            pricing: { prompt: '0', completion: '0' },
            context_length: 1_000_000,
        });
        const badges = getModelBadges(m, 2);
        expect(badges.length).toBeLessThanOrEqual(2);
        expect(badges[0]!.label).toBe('Free');
    });
});

describe('getBestForTags', () => {
    it('falls back to everyday chat', () => {
        expect(getBestForTags(makeModel())).toEqual(['Everyday chat']);
    });

    it('includes derived tags', () => {
        const tags = getBestForTags(
            makeModel({
                supported_parameters: ['tools', 'reasoning'],
                context_length: 200_000,
            })
        );
        expect(tags).toContain('Complex reasoning');
        expect(tags).toContain('Agents & tools');
        expect(tags).toContain('Long documents');
    });
});

describe('formatting', () => {
    it('formatPerMillion', () => {
        expect(formatPerMillion('0.000003')).toBe('$3.00');
        expect(formatPerMillion(0)).toBe('$0.00');
        expect(formatPerMillion(undefined)).toBe('$0.00');
    });

    it('formatTokenCount', () => {
        expect(formatTokenCount(200_000)).toBe('200K');
        expect(formatTokenCount(1_000_000)).toBe('1M');
        expect(formatTokenCount(32_768)).toBe('32.8K');
        expect(formatTokenCount(0)).toBe('—');
    });

    it('formatModalities', () => {
        expect(
            formatModalities(
                makeModel({
                    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
                })
            )
        ).toBe('Text + image → Text');
        expect(formatModalities(makeModel())).toBe('Text → Text');
    });

    it('formatReleaseDate', () => {
        expect(formatReleaseDate(1713139200)).toBe('Apr 2024');
        expect(formatReleaseDate(undefined)).toBeNull();
    });
});
