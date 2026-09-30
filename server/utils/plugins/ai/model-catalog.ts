/**
 * Server-side resolution of the host's approved plugin models.
 *
 * The allowlist and prices are operator configuration (`OR3_PLUGIN_ALLOWED_MODELS`,
 * `OR3_PLUGIN_MODEL_PRICES`); this module turns them into the disclosure the
 * `ai.models` capability returns and the price table the AI governor enforces.
 */

import type { ModelPriceTable } from '~~/shared/plugins/ai/plugin-usage';
import { parseAllowedModels, parseModelPrices } from '~~/shared/plugins/ai/model-catalog';

interface AdminPluginModelConfig {
    readonly pluginAllowedModels?: unknown;
    readonly pluginModelPrices?: unknown;
}

function adminConfig(config: unknown): AdminPluginModelConfig {
    const admin = (config as { admin?: AdminPluginModelConfig }).admin;
    return admin ?? {};
}

/** Model ids plugins may use; empty means the host has none approved. */
export function resolveAllowedModels(config: unknown): string[] {
    return parseAllowedModels(adminConfig(config).pluginAllowedModels);
}

/** Trusted price table (USD per 1M tokens); unpriced models are refused. */
export function resolveHostModelPrices(config: unknown): ModelPriceTable {
    return parseModelPrices(adminConfig(config).pluginModelPrices);
}
