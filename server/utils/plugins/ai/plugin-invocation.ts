/**
 * Server-side plugin AI invocation.
 *
 * The host owns the provider credential (existing OpenRouter configuration):
 * plugins never receive a key, never choose a different endpoint, and never
 * authorize anything. Every call is plugin-attributed, admitted against a
 * reserved worst-case spend, cancellable and deadline-bound, and its
 * concurrency slot is released exactly once whatever the outcome.
 *
 * Destructive/external actions still need a host-minted approval
 * (see `authority/action-approval`).
 */

import type { HostRpcHandler, HostRpcMethodSpec } from '~~/shared/plugins/isolation/host-rpc-broker';
import { DEFAULT_CONTAINMENT_BUDGETS } from '~~/shared/plugins/isolation/budgets';
import {
    PluginAiGovernor,
    type ModelPriceTable,
} from '~~/shared/plugins/ai/plugin-usage';
import {
    checkActionApproval,
    type PluginActionKind,
} from '~~/shared/plugins/authority/action-approval';

export const PLUGIN_AI_COMPLETE_METHOD = 'ai.complete';

export interface PluginAiCompletionRequest {
    readonly model: string;
    readonly prompt: string;
    readonly maxOutputTokens?: number;
}

export interface PluginAiCompletionResult {
    readonly text: string;
    readonly model: string;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly spendUsd: number;
}

export interface PluginAiProvider {
    complete(
        request: PluginAiCompletionRequest,
        context: { readonly timeoutMs: number; readonly signal?: AbortSignal }
    ): Promise<PluginAiCompletionResult>;
}

export interface CreatePluginAiMethodInput {
    readonly provider: PluginAiProvider;
    /**
     * Trusted per-model prices. Required: a model without a price cannot be
     * admitted, because the spend bound would be unknown.
     */
    readonly prices: ModelPriceTable;
    readonly allowedModels?: readonly string[];
    readonly budgets?: typeof DEFAULT_CONTAINMENT_BUDGETS;
    readonly now?: () => number;
}

function readString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw Object.assign(new Error(`${field} is required`), { rpcCode: 'policy-denied' });
    }
    return value;
}

/**
 * Build the `ai.complete` host method.
 *
 * Parameters are limited to a model id, a prompt and an output ceiling; the
 * plugin cannot supply a provider URL, credential, cost or any approval.
 */
export function createPluginAiCompleteMethod(
    input: CreatePluginAiMethodInput
): HostRpcMethodSpec {
    const governor = new PluginAiGovernor({
        budgets: input.budgets ?? DEFAULT_CONTAINMENT_BUDGETS,
        prices: input.prices,
        ...(input.allowedModels === undefined ? {} : { allowedModels: input.allowedModels }),
        ...(input.now === undefined ? {} : { now: input.now }),
    });

    const handler: HostRpcHandler = async (params, context) => {
        const raw = params as {
            model?: unknown;
            prompt?: unknown;
            maxOutputTokens?: unknown;
        };
        const model = readString(raw.model, 'model');
        const prompt = readString(raw.prompt, 'prompt');
        const requested =
            typeof raw.maxOutputTokens === 'number' && Number.isFinite(raw.maxOutputTokens)
                ? Math.max(1, Math.trunc(raw.maxOutputTokens))
                : undefined;

        const admission = governor.admit({
            model,
            prompt,
            ...(requested === undefined ? {} : { maxOutputTokens: requested }),
        });
        if (admission.status === 'refused') {
            throw Object.assign(new Error(admission.message), {
                rpcCode:
                    admission.code === 'budget-exceeded' ? 'budget-exceeded' : 'policy-denied',
            });
        }

        try {
            const result = await input.provider.complete(
                {
                    model: admission.model,
                    prompt,
                    maxOutputTokens: admission.maxOutputTokens,
                },
                { timeoutMs: admission.deadlineMs, signal: context.signal }
            );

            // Reconcile the reservation with the real usage, then attribute it.
            const settled = admission.settle({
                spendUsd: result.spendUsd,
                completionTokens: result.completionTokens,
            });
            governor.record({
                pluginId: context.pluginId,
                workspaceId: context.workspaceId,
                generation: context.generation,
                model: result.model,
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                spendUsd: result.spendUsd,
                at: (input.now ?? (() => Date.now()))(),
            });
            if (!settled.ok) {
                throw Object.assign(new Error(settled.message ?? 'AI budget exceeded'), {
                    rpcCode: 'budget-exceeded',
                });
            }

            return {
                text: result.text,
                model: result.model,
                usage: {
                    promptTokens: result.promptTokens,
                    completionTokens: result.completionTokens,
                    spendUsd: result.spendUsd,
                },
            };
        } catch (error) {
            // Release the concurrency slot whatever happened: a failed call must
            // not hold capacity that the activation still needs.
            admission.settle();
            if (context.signal.aborted) {
                throw Object.assign(new Error('AI call was cancelled'), {
                    rpcCode: 'cancelled',
                });
            }
            throw error;
        }
    };

    return {
        method: PLUGIN_AI_COMPLETE_METHOD,
        grant: 'network.http',
        handler,
    };
}

/**
 * Gate for AI-initiated actions. This is the RT14 boundary: a plugin (or a model
 * driving one) may request an action, but the host requires an approval minted by
 * the host UI for anything destructive, external, commercial or access-related.
 */
export function authorizePluginAction(input: {
    readonly kind: PluginActionKind;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly target: string;
    readonly approval?: unknown;
    readonly now?: () => number;
}) {
    const decision = checkActionApproval(input);
    if (decision.status === 'denied') {
        throw Object.assign(new Error(decision.message), { rpcCode: 'policy-denied' });
    }
    return decision;
}
