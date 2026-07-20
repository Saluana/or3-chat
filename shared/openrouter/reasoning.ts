import type { OpenRouterModel } from './types';

export const OPENROUTER_REASONING_EFFORTS = [
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
] as const;

export type OpenRouterReasoningEffort =
    (typeof OPENROUTER_REASONING_EFFORTS)[number];

export type OpenRouterReasoningConfig = {
    effort?: OpenRouterReasoningEffort;
    enabled?: boolean;
    max_tokens?: number;
    exclude?: boolean;
};

const DEFAULT_REASONING_EFFORT: OpenRouterReasoningEffort = 'medium';

type MaybeReasoningModel = Pick<
    OpenRouterModel,
    'reasoning' | 'supported_parameters'
>;

function isReasoningEffort(value: unknown): value is OpenRouterReasoningEffort {
    return (
        typeof value === 'string' &&
        (OPENROUTER_REASONING_EFFORTS as readonly string[]).includes(value)
    );
}

function supportsReasoningByParams(params: readonly string[] | undefined) {
    if (!Array.isArray(params)) return false;
    return params.some(
        (parameter) =>
            parameter === 'reasoning' ||
            parameter.startsWith('reasoning.') ||
            parameter === 'reasoning_effort' ||
            parameter === 'thinking'
    );
}

export function getSupportedReasoningEfforts(
    model: MaybeReasoningModel | undefined
): OpenRouterReasoningEffort[] {
    const supported = model?.reasoning?.supported_efforts;
    if (supported === null) return [...OPENROUTER_REASONING_EFFORTS];
    if (Array.isArray(supported)) {
        return supported.filter(isReasoningEffort);
    }
    if (supportsReasoningByParams(model?.supported_parameters)) {
        return ['low', 'medium', 'high'];
    }
    return [];
}

export function modelSupportsReasoning(
    model: MaybeReasoningModel | undefined
): boolean {
    if (model?.reasoning) return true;
    return getSupportedReasoningEfforts(model).length > 0;
}

export function getDefaultReasoningEffort(
    model: MaybeReasoningModel | undefined
): OpenRouterReasoningEffort {
    const defaultEffort = model?.reasoning?.default_effort;
    if (isReasoningEffort(defaultEffort)) return defaultEffort;
    return DEFAULT_REASONING_EFFORT;
}

export function resolveReasoningConfig(params: {
    model: MaybeReasoningModel | undefined;
    enabled: boolean;
    effort?: string | null;
}): OpenRouterReasoningConfig | undefined {
    if (!params.enabled) return undefined;
    const supportedEfforts = getSupportedReasoningEfforts(params.model);
    if (!supportedEfforts.length && !params.model?.reasoning) return undefined;

    const requestedEffort = isReasoningEffort(params.effort)
        ? params.effort
        : getDefaultReasoningEffort(params.model);
    const effort = supportedEfforts.includes(requestedEffort)
        ? requestedEffort
        : supportedEfforts[0] ?? DEFAULT_REASONING_EFFORT;

    if (
        params.model?.reasoning?.supports_max_tokens === true &&
        Array.isArray(params.model?.supported_parameters) &&
        params.model.supported_parameters.includes('reasoning.max_tokens') &&
        !Array.isArray(params.model.reasoning.supported_efforts)
    ) {
        return { max_tokens: 1024 };
    }

    return { effort };
}
