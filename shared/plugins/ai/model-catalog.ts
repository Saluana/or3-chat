/**
 * @module shared/plugins/ai/model-catalog
 *
 * Purpose:
 * Describe the models a plugin may use, from the host's own approved
 * configuration. Plugins never choose an endpoint or a price: they receive the
 * allowlist, the disclosed per-million prices and the enforced limits, so a
 * plugin UI can offer real choices and show the separate provider cost.
 *
 * Behavior:
 * - The allowlist and the price table are parsed strictly; malformed entries are
 *   dropped rather than guessed.
 * - A model without a usable host price is reported as `priced: false` and is
 *   refused by the governor (an unpriced model must never be recorded as free).
 * - Limits come from the containment budgets, the same source the governor uses.
 *
 * Constraints:
 * - Pure data: no network, no storage, no host objects.
 *
 * Non-Goals:
 * - Enforcing spend (see `PluginAiGovernor`).
 */

import { DEFAULT_CONTAINMENT_BUDGETS, type ContainmentBudgets } from '../isolation/budgets';

/** Model ids are provider paths (`vendor/model`); bounded and printable. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
export const MAX_PLUGIN_MODELS = 64;

export interface PluginModelInfo {
    readonly id: string;
    /** Last path segment, for a compact label without host branding. */
    readonly label: string;
    /** True only when a usable host price exists; unpriced models are refused. */
    readonly priced: boolean;
    readonly promptPerMillion: number | null;
    readonly completionPerMillion: number | null;
}

export interface PluginModelLimits {
    readonly maxOutputTokens: number;
    readonly spendLimitUsd: number;
    readonly maxConcurrentCalls: number;
    readonly deadlineMs: number;
}

export interface PluginModelCatalog {
    /** False when the host has no approved models; the UI must say so. */
    readonly configured: boolean;
    readonly models: readonly PluginModelInfo[];
    readonly limits: PluginModelLimits;
}

export interface RawModelPrice {
    readonly promptPerMillion?: unknown;
    readonly completionPerMillion?: unknown;
}

function usablePrice(price: RawModelPrice | undefined): { prompt: number; completion: number } | null {
    if (!price) return null;
    const prompt = Number(price.promptPerMillion);
    const completion = Number(price.completionPerMillion);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
    if (prompt < 0 || completion < 0) return null;
    return { prompt, completion };
}

/**
 * Parse `OR3_PLUGIN_ALLOWED_MODELS` (comma-separated ids). Unknown shapes and
 * duplicates are dropped so a typo cannot widen the allowlist.
 */
export function parseAllowedModels(value: unknown): string[] {
    if (typeof value !== 'string' && !Array.isArray(value)) return [];
    const raw = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : String(value).split(',');
    const models: string[] = [];
    for (const entry of raw) {
        const id = entry.trim();
        if (!id || !MODEL_ID_PATTERN.test(id)) continue;
        if (models.includes(id)) continue;
        models.push(id);
        if (models.length >= MAX_PLUGIN_MODELS) break;
    }
    return models;
}

/**
 * Parse `OR3_PLUGIN_MODEL_PRICES` (JSON object of USD per 1M tokens). A value
 * that is not valid JSON yields no prices at all, which keeps every model
 * unpriced and therefore refused.
 */
export function parseModelPrices(value: unknown): Record<string, { promptPerMillion: number; completionPerMillion: number }> {
    let raw: unknown = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return {};
        try {
            raw = JSON.parse(trimmed);
        } catch {
            return {};
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const prices: Record<string, { promptPerMillion: number; completionPerMillion: number }> = {};
    for (const [id, entry] of Object.entries(raw as Record<string, RawModelPrice>)) {
        if (!MODEL_ID_PATTERN.test(id)) continue;
        const price = usablePrice(entry);
        if (!price) continue;
        prices[id] = { promptPerMillion: price.prompt, completionPerMillion: price.completion };
    }
    return prices;
}

function labelFor(id: string): string {
    const segment = id.split('/').pop() ?? id;
    return segment.length > 0 ? segment : id;
}

/** Build the disclosure a plugin UI may show. */
export function buildPluginModelCatalog(input: {
    readonly allowed: unknown;
    readonly prices: unknown;
    readonly budgets?: ContainmentBudgets;
}): PluginModelCatalog {
    const budgets = input.budgets ?? DEFAULT_CONTAINMENT_BUDGETS;
    const allowed = parseAllowedModels(input.allowed);
    const prices = parseModelPrices(input.prices);
    const models: PluginModelInfo[] = allowed.map((id) => {
        const price = prices[id];
        return price
            ? {
                  id,
                  label: labelFor(id),
                  priced: true,
                  promptPerMillion: price.promptPerMillion,
                  completionPerMillion: price.completionPerMillion,
              }
            : {
                  id,
                  label: labelFor(id),
                  priced: false,
                  promptPerMillion: null,
                  completionPerMillion: null,
              };
    });
    return Object.freeze({
        configured: models.length > 0,
        models: Object.freeze(models),
        limits: Object.freeze({
            maxOutputTokens: budgets.maxAiOutputTokens,
            spendLimitUsd: budgets.maxAiSpendUsd,
            maxConcurrentCalls: budgets.maxConcurrentCalls,
            deadlineMs: budgets.defaultCallDeadlineMs,
        }),
    });
}
