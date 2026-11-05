import type { OpenRouterModel } from '../openrouter/types';
import { openRouterCatalogLookupId } from '../openrouter/selection';

/** A saved route ID stays opaque. Model identity and billing platform are separate facts. */
export function modelIdentity(model: Pick<OpenRouterModel, 'id'>) {
    const routeId = openRouterCatalogLookupId(model.id);
    const direct = routeId.startsWith('@openai/');
    // Maker-qualified identity can match across platforms; aliases remain distinct.
    const modelId = direct ? `openai/${routeId.slice('@openai/'.length)}` : routeId;
    return { routeId, modelId, platform: direct ? 'openai' as const : 'openrouter' as const,
        platformName: direct ? 'OpenAI' : 'OpenRouter',
        maker: direct ? 'openai' : routeId.replace(/^~/, '').split('/')[0]! };
}

/** Prices are per token. Missing, invalid and negative values are unknown, never free. */
export function parseModelPrice(raw: unknown): number | null {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (typeof raw === 'string' && !raw.trim()) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}
export function modelPrices(model: Pick<OpenRouterModel, 'pricing'>) {
    return { input: parseModelPrice(model.pricing?.prompt), output: parseModelPrice(model.pricing?.completion) };
}
export function modelInfoUrl(model: Pick<OpenRouterModel, 'id'>) {
    const identity = modelIdentity(model);
    return identity.platform === 'openai'
        ? 'https://developers.openai.com/api/docs/models'
        : `https://openrouter.ai/${identity.routeId.replace(/^~/, '').split('/').map(encodeURIComponent).join('/')}`;
}
export function modelPricingUrl(model: Pick<OpenRouterModel, 'id'>) {
    return modelIdentity(model).platform === 'openai' ? 'https://openai.com/api/pricing/' : modelInfoUrl(model);
}
