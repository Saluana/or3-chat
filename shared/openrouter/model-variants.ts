/**
 * OpenRouter model routing variants.
 *
 * Variants are requested by appending a suffix to the model id:
 * - `:online` — real-time web search (deprecated upstream in favor of the
 *   `openrouter:web_search` server tool, but still supported)
 * - `:nitro` — sort providers by throughput (fastest)
 * - `:floor` — sort providers by price (cheapest)
 *
 * See https://openrouter.ai/docs/guides/routing/model-variants/nitro,
 * https://openrouter.ai/docs/guides/routing/model-variants/floor,
 * https://openrouter.ai/docs/guides/routing/model-variants/online
 */

export const OPENROUTER_MODEL_VARIANTS = [
    'off',
    'online',
    'nitro',
    'floor',
] as const;

export type OpenRouterModelVariant =
    (typeof OPENROUTER_MODEL_VARIANTS)[number];

export const DEFAULT_MODEL_VARIANT: OpenRouterModelVariant = 'off';

const VARIANT_SUFFIXES = ['online', 'nitro', 'floor'] as const;

export function isModelVariant(
    value: unknown
): value is OpenRouterModelVariant {
    return (
        typeof value === 'string' &&
        (OPENROUTER_MODEL_VARIANTS as readonly string[]).includes(value)
    );
}

export function sanitizeModelVariant(
    value: unknown,
    fallback: OpenRouterModelVariant = DEFAULT_MODEL_VARIANT
): OpenRouterModelVariant {
    return isModelVariant(value) ? value : fallback;
}

/** Append the variant suffix to a model id (`off` returns the id unchanged). */
export function appendModelVariant(
    modelId: string,
    variant: OpenRouterModelVariant | undefined | null
): string {
    if (!variant || variant === 'off') return modelId;
    const base = stripModelVariantSuffix(modelId);
    return `${base}:${variant}`;
}

/** Strip a trailing `:online` / `:nitro` / `:floor` suffix, if present. */
export function stripModelVariantSuffix(modelId: string): string {
    for (const suffix of VARIANT_SUFFIXES) {
        if (modelId.endsWith(`:${suffix}`)) {
            return modelId.slice(0, -suffix.length - 1);
        }
    }
    return modelId;
}
