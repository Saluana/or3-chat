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
    /** OpenRouter also accepts `"none"` to disable reasoning for a request. */
    effort?: OpenRouterReasoningEffort | 'none';
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
            parameter === 'include_reasoning' ||
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

/**
 * Resolve the effort actually used for a request, given a requested value.
 * Prefers the requested effort, then the model's default, then the first
 * supported level. Both the request path and the picker use this so the
 * displayed level always matches what is sent.
 */
export function normalizeReasoningEffort(params: {
    effort: string | undefined;
    efforts: readonly OpenRouterReasoningEffort[];
    defaultEffort?: OpenRouterReasoningEffort;
}): OpenRouterReasoningEffort | undefined {
    if (
        isReasoningEffort(params.effort) &&
        params.efforts.includes(params.effort)
    ) {
        return params.effort;
    }
    if (params.defaultEffort && params.efforts.includes(params.defaultEffort)) {
        return params.defaultEffort;
    }
    return params.efforts[0];
}

export function resolveReasoningConfig(params: {
    model: MaybeReasoningModel | undefined;
    enabled: boolean;
    effort?: string | null;
}): OpenRouterReasoningConfig | undefined {
    if (!params.enabled) return undefined;
    const supportedEfforts = getSupportedReasoningEfforts(params.model);
    if (!supportedEfforts.length && !params.model?.reasoning) return undefined;

    const effort =
        normalizeReasoningEffort({
            effort: params.effort ?? undefined,
            efforts: supportedEfforts,
            defaultEffort: getDefaultReasoningEffort(params.model),
        }) ?? DEFAULT_REASONING_EFFORT;

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

// ---------------------------------------------------------------------------
// Thinking-level picker
// ---------------------------------------------------------------------------

/** Dropdown value for "thinking off". Fails safe: unknown values map here. */
export const THINKING_DISABLED = 'disabled';

/**
 * Dropdown value for "thinking on" on models that support reasoning but
 * expose no effort levels. The request then uses the model default effort.
 */
export const THINKING_BASIC = 'enabled';

/** One-line plain-language summary per reasoning effort level. */
export const REASONING_EFFORT_DESCRIPTIONS: Record<
    OpenRouterReasoningEffort,
    string
> = {
    minimal: 'Fastest answers, lightest reasoning.',
    low: 'Light reasoning for simple tasks.',
    medium: 'Balanced reasoning and speed.',
    high: 'Deep reasoning for hard problems.',
    xhigh: 'Very deep reasoning, slower.',
    max: 'Maximum reasoning effort.',
};

/** Fallback description for effort strings outside the known union. */
export const GENERIC_EFFORT_DESCRIPTION =
    'More effort means deeper reasoning, but slower answers.';

export function getReasoningEffortDescription(effort: string): string {
    if (isReasoningEffort(effort)) return REASONING_EFFORT_DESCRIPTIONS[effort];
    return GENERIC_EFFORT_DESCRIPTION;
}

/**
 * Dropdown value reflecting the current thinking state. Always resolves to
 * one of the presented options: `disabled`, `enabled` (no effort levels),
 * or a supported effort. Uses the same normalization as the request path.
 */
export function resolveThinkingSelection(options: {
    thinkingEnabled: boolean;
    reasoningEffort: string | undefined;
    efforts: readonly string[];
    defaultEffort?: OpenRouterReasoningEffort;
}): string {
    if (!options.thinkingEnabled) return THINKING_DISABLED;
    const efforts = options.efforts.filter(isReasoningEffort);
    if (efforts.length === 0) return THINKING_BASIC;
    return (
        normalizeReasoningEffort({
            effort: options.reasoningEffort,
            efforts,
            defaultEffort: options.defaultEffort,
        }) ?? THINKING_BASIC
    );
}

/**
 * Thinking state for a dropdown selection. Disabling clears the effort so
 * no stale level survives; re-enabling picks an explicit level instead of
 * restoring a ghost value.
 */
export function applyThinkingSelection(
    value: string,
    efforts: readonly string[]
): { thinkingEnabled: boolean; reasoningEffort: string | undefined } {
    if (value === THINKING_BASIC && efforts.length === 0) {
        return { thinkingEnabled: true, reasoningEffort: undefined };
    }
    if (efforts.includes(value)) {
        return { thinkingEnabled: true, reasoningEffort: value };
    }
    return { thinkingEnabled: false, reasoningEffort: undefined };
}
