import { appendModelVariant, stripModelVariantSuffix, type OpenRouterModelVariant } from './model-variants';
import { getSupportedReasoningEfforts, modelSupportsReasoning, resolveReasoningConfig, type OpenRouterReasoningEffort } from './reasoning';
import type { OpenRouterModel } from './types';
import type { ToolDefinition } from '../../app/utils/chat/types';

/** The provider-visible definition is identical for browser and server execution. */
export const modelSearchDefinition: ToolDefinition = {
    type: 'function', runtime: 'client',
    function: { name: 'search_models', description: 'Search the available model catalog by name, provider, or model ID. Use the returned exact ID when delegating to a specific model.',
        parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: {
            query: { type: 'string', minLength: 1, maxLength: 200 },
        } } },
    ui: { label: 'Find models', descriptionHint: 'Find available models by name or provider.', category: 'Chat', icon: 'i-lucide-search', defaultEnabled: true },
};

export type DelegationCatalogModel = {
    id: string;
    name?: string;
    canonical_slug?: string | null;
};

/** A bounded, user-facing error from catalog model selection. */
export class DelegationModelSelectionError extends Error {}

const terms = (value: string) => value.toLowerCase().replace(/\bv(?=\d)/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const normalize = (value: string) => value.toLowerCase().replace(/\bv(?=\d)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const delegationModelDisplayName = (value: string) => value.replace(/^[^:]+:\s*/, '');

function matchesModel(query: string, model: DelegationCatalogModel): boolean {
    const queryTerms = terms(query);
    const searchable = terms(`${model.id} ${model.name || ''} ${model.canonical_slug || ''}`);
    return queryTerms.length > 0 && queryTerms.every(term => searchable.some(word =>
        /^\d+$/.test(term) ? word === term : word.includes(term)));
}

/** Bounded public search results; callers supply the catalog for their own authority scope. */
export function searchDelegationModels(models: readonly DelegationCatalogModel[], query: string) {
    const text = query.trim();
    if (!text || text.length > 200) throw new Error('Enter a model search query of at most 200 characters.');
    const matches = models.filter(model => matchesModel(text, model));
    return { models: matches.slice(0, 20).map(model => ({ id: model.id, name: model.name })), truncated: matches.length > 20 };
}

/** Resolve only an unambiguous catalog entry, preferring exact IDs then names. */
export function resolveDelegationModel<T extends DelegationCatalogModel>(models: readonly T[], requested: string): T {
    const base = stripModelVariantSuffix(requested.trim()).toLowerCase();
    const exactId = models.filter(model => model.id.toLowerCase() === base || model.canonical_slug?.toLowerCase() === base);
    const exactName = models.filter(model => normalize(delegationModelDisplayName(model.name || '')) === normalize(base));
    const matches = exactId.length ? exactId : exactName.length ? exactName : models.filter(model => matchesModel(base, model));
    const byId = new Map<string, T>();
    for (const model of matches) if (!byId.has(model.id)) byId.set(model.id, model);
    const unique = [...byId.values()];
    if (unique.length !== 1) throw new DelegationModelSelectionError(unique.length ? `Model is ambiguous: ${unique.slice(0, 5).map(model => model.id).join(', ')}. Use search_models to find the exact ID.` : `Model not found: ${requested}. Use search_models to find the exact ID.`);
    return unique[0]!;
}

/** Resolve the effective model and reasoning identically in browser and server preparation. */
export function selectDelegationModel(models: readonly OpenRouterModel[], query: string, effort: string | undefined,
    parent: { model: string; thinking: boolean; reasoningEffort?: string | null } | undefined,
    variant?: OpenRouterModelVariant) {
    const requested = query.trim() || parent?.model || '';
    if (!requested) throw new DelegationModelSelectionError('The originating model is unavailable. Specify a model.');
    const requestedBase = stripModelVariantSuffix(requested);
    const model = resolveDelegationModel(models, requested);
    if (effort && !getSupportedReasoningEfforts(model).includes(effort as OpenRouterReasoningEffort))
        throw new DelegationModelSelectionError(`${model.name || model.id} does not support the requested ${effort} reasoning effort.`);
    const inherited = !query.trim() && parent;
    const thinking = effort ? true : inherited ? parent.thinking : model.reasoning?.mandatory === true ||
        (model.reasoning?.default_enabled ?? (model.reasoning?.default_effort !== 'none' && modelSupportsReasoning(model)));
    const reasoningEffort = effort ?? (inherited ? parent.reasoningEffort : undefined);
    const reasoning = resolveReasoningConfig({ model, enabled: thinking, effort: reasoningEffort });
    if (effort && reasoning?.effort !== effort)
        throw new DelegationModelSelectionError(`${model.name || model.id} cannot send the requested ${effort} reasoning effort.`);
    let modelId = inherited ? requested : model.id + requested.slice(requestedBase.length);
    if (variant) modelId = variant === 'off' ? stripModelVariantSuffix(modelId) : appendModelVariant(modelId, variant);
    return { model: modelId, modelName: delegationModelDisplayName(model.name || model.id), thinking, reasoningEffort, reasoning };
}
