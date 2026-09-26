/**
 * @module shared/plugins/ai/plugin-usage
 *
 * Purpose:
 * Attribute AI/model usage to the plugin that caused it, disclose the separate
 * provider cost, and enforce deadlines, output and spend limits that actually
 * stop spending rather than merely reporting it.
 *
 * Behavior:
 * - Limits come from the containment budgets (per-activation spend and output).
 * - A call is admitted only if the worst-case cost of that call fits inside the
 *   remaining spend. Concurrency is reserved at admission and released exactly
 *   once, whatever the outcome.
 * - Usage is reconciled after the provider responds; unknown or invalid usage
 *   fails closed instead of being recorded as free.
 * - Terminal overruns mark the activation exhausted, so no further call is
 *   admitted.
 *
 * Constraints:
 * - This is a host-side budget, not a provider-side cap; the disclosure text
 *   says exactly that.
 * - Pricing must come from the host (a trusted model price table); a model
 *   without a usable price is refused rather than assumed free.
 *
 * Non-Goals:
 * - Talking to a provider (host AI services do that).
 */

import {
    ContainmentBudgetLedger,
    type ContainmentBudgets,
} from '../isolation/budgets';
import { isUsablePluginModelPrice } from './model-catalog';

export interface PluginAiUsageRecord {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly model: string;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly spendUsd: number;
    readonly at: number;
}

export interface PluginAiLimits {
    readonly maxOutputTokens: number;
    readonly deadlineMs: number;
    readonly maxConcurrentCalls: number;
    readonly spendLimitUsd: number;
}

/** Trusted per-model price (USD per 1M tokens). */
export interface ModelPrice {
    readonly promptPerMillion: number;
    readonly completionPerMillion: number;
}

export type ModelPriceTable = Readonly<Record<string, ModelPrice>>;

export function resolvePluginAiLimits(
    budgets: ContainmentBudgets,
    overrides: Partial<PluginAiLimits> = {}
): PluginAiLimits {
    return Object.freeze({
        maxOutputTokens: overrides.maxOutputTokens ?? budgets.maxAiOutputTokens,
        deadlineMs: overrides.deadlineMs ?? budgets.defaultCallDeadlineMs,
        maxConcurrentCalls: overrides.maxConcurrentCalls ?? budgets.maxConcurrentCalls,
        spendLimitUsd: overrides.spendLimitUsd ?? budgets.maxAiSpendUsd,
    });
}

/** Worst-case cost of a call: the full output ceiling plus a prompt estimate. */
function estimateMaxSpend(input: {
    readonly price: ModelPrice;
    readonly promptTokens: number;
    readonly maxOutputTokens: number;
}): number {
    const prompt = (input.promptTokens / 1_000_000) * input.price.promptPerMillion;
    const completion =
        (input.maxOutputTokens / 1_000_000) * input.price.completionPerMillion;
    return prompt + completion;
}

function isUsablePrice(price: ModelPrice | undefined): price is ModelPrice {
    return isUsablePluginModelPrice(price);
}

/** Conservative token estimate used for the pre-dispatch reservation. */
export function estimatePromptTokens(prompt: string): number {
    let bytes = 0;
    for (const character of prompt) {
        const codePoint = character.codePointAt(0)!;
        bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    }
    // ASCII data can also approach one token per byte. Use the UTF-8 ceiling
    // for every prompt, plus framing, without loading a model-specific tokenizer.
    return bytes + 8;
}

export type PluginAiAdmission =
    | {
          readonly status: 'admitted';
          readonly model: string;
          readonly maxOutputTokens: number;
          readonly deadlineMs: number;
          /** Reserved worst-case spend for this call (USD). */
          readonly reservedUsd: number;
          /**
           * Release the concurrency slot and reconcile the reservation with the
           * real usage. Safe to call more than once.
       */
          settle(actual?: { readonly spendUsd: number; readonly completionTokens: number }): {
              readonly ok: boolean;
              readonly message?: string;
              readonly terminate: boolean;
          };
      }
    | {
          readonly status: 'refused';
          readonly code: 'budget-exceeded' | 'model-not-allowed' | 'price-unavailable';
          readonly message: string;
      };

export interface PluginAiGovernorOptions {
    readonly budgets: ContainmentBudgets;
    readonly limits?: Partial<PluginAiLimits>;
    /** Optional allowlist of model ids the plugin may use. */
    readonly allowedModels?: readonly string[];
    /**
     * Host-supplied trusted prices. Only models present here can be admitted:
     * a missing price would otherwise be recorded as free spend.
     */
    readonly prices: ModelPriceTable;
    /** Spend already committed by this user/workspace/plugin identity. */
    readonly initialSpendUsd?: number;
    readonly now?: () => number;
}

/**
 * Governor for one plugin activation: admits or refuses a model call, records
 * attributed usage, and exposes the running spend.
 */
export class PluginAiGovernor {
    readonly #ledger: ContainmentBudgetLedger;
    readonly #limits: PluginAiLimits;
    readonly #allowedModels: readonly string[] | undefined;
    readonly #prices: ModelPriceTable;
    readonly #now: () => number;
    readonly #initialSpendUsd: number;
    readonly #usage: PluginAiUsageRecord[] = [];
    #reservedUsd = 0;
    #exhausted = false;

    constructor(options: PluginAiGovernorOptions) {
        this.#ledger = new ContainmentBudgetLedger(options.budgets, {
            now: options.now,
        });
        this.#limits = resolvePluginAiLimits(options.budgets, options.limits ?? {});
        this.#allowedModels = options.allowedModels;
        this.#prices = options.prices;
        this.#now = options.now ?? (() => Date.now());
        const initialSpendUsd = options.initialSpendUsd ?? 0;
        this.#initialSpendUsd =
            Number.isFinite(initialSpendUsd) && initialSpendUsd > 0 ? initialSpendUsd : 0;
        if (this.#initialSpendUsd > 0) {
            const charged = this.#ledger.chargeAiUsage({
                spendUsd: this.#initialSpendUsd,
                outputTokens: 0,
            });
            if (!charged.ok) this.#exhausted = true;
        }
    }

    get limits(): PluginAiLimits {
        return this.#limits;
    }

    get spendUsd(): number {
        return (
            this.#initialSpendUsd +
            this.#usage.reduce((total, record) => total + record.spendUsd, 0)
        );
    }

    /** Spend plus worst-case cost of calls that are currently in flight. */
    get committedUsd(): number {
        return this.spendUsd + this.#reservedUsd;
    }

    get exhausted(): boolean {
        return this.#exhausted || this.#ledger.exhausted !== null;
    }

    get usage(): readonly PluginAiUsageRecord[] {
        return [...this.#usage];
    }

    priceFor(model: string): ModelPrice | null {
        const price = this.#prices[model];
        return isUsablePrice(price) ? price : null;
    }

    admit(input: {
        readonly model: string;
        readonly prompt: string;
        readonly maxOutputTokens?: number;
    }): PluginAiAdmission {
        if (this.#allowedModels && !this.#allowedModels.includes(input.model)) {
            return {
                status: 'refused',
                code: 'model-not-allowed',
                message: `Model ${input.model} is not on the plugin's allowlist`,
            };
        }
        if (this.exhausted) {
            return {
                status: 'refused',
                code: 'budget-exceeded',
                message: 'The plugin AI budget is exhausted for this activation',
            };
        }

        const price = this.priceFor(input.model);
        if (!price) {
            return {
                status: 'refused',
                code: 'price-unavailable',
                message: `No trusted price is configured for model ${input.model}; refusing to spend`,
            };
        }

        const requestedTokens =
            typeof input.maxOutputTokens === 'number' && Number.isFinite(input.maxOutputTokens)
                ? Math.max(1, Math.trunc(input.maxOutputTokens))
                : this.#limits.maxOutputTokens;
        const maxOutputTokens = Math.min(requestedTokens, this.#limits.maxOutputTokens);
        const promptTokens = estimatePromptTokens(input.prompt);
        const reservedUsd = estimateMaxSpend({ price, promptTokens, maxOutputTokens });

        if (this.committedUsd + reservedUsd > this.#limits.spendLimitUsd) {
            return {
                status: 'refused',
                code: 'budget-exceeded',
                message: `Committed spend $${this.committedUsd.toFixed(4)} plus $${reservedUsd.toFixed(4)} reserved would exceed the $${this.#limits.spendLimitUsd.toFixed(2)} activation limit`,
            };
        }

        const admitted = this.#ledger.admitCall();
        if (admitted.ok === false) {
            return { status: 'refused', code: 'budget-exceeded', message: admitted.message };
        }
        // Reserve the worst case before dispatch so concurrent calls cannot each
        // assume the whole remaining budget.
        this.#reservedUsd += reservedUsd;
        let settled = false;

        return {
            status: 'admitted',
            model: input.model,
            maxOutputTokens,
            deadlineMs: this.#limits.deadlineMs,
            reservedUsd,
            settle: (actual) => {
                if (!settled) {
                    settled = true;
                    this.#ledger.releaseCall();
                    this.#reservedUsd = Math.max(0, this.#reservedUsd - reservedUsd);
                }
                if (!actual) return { ok: true, terminate: false };
                return this.#reconcile(actual);
            },
        };
    }

    #reconcile(actual: {
        readonly spendUsd: number;
        readonly completionTokens: number;
    }): { readonly ok: boolean; readonly message?: string; readonly terminate: boolean } {
        if (
            !Number.isFinite(actual.spendUsd) ||
            actual.spendUsd < 0 ||
            !Number.isFinite(actual.completionTokens) ||
            actual.completionTokens < 0
        ) {
            this.#exhausted = true;
            return {
                ok: false,
                message: 'Provider usage was not usable; the AI budget cannot be reconciled',
                terminate: true,
            };
        }
        const charged = this.#ledger.chargeAiUsage({
            spendUsd: actual.spendUsd,
            outputTokens: actual.completionTokens,
        });
        if (charged.ok === false) {
            this.#exhausted = true;
            return { ok: false, message: charged.message, terminate: true };
        }
        return { ok: true, terminate: false };
    }

    /** Record an attributed usage record after a successful call. */
    record(input: PluginAiUsageRecord): void {
        this.#usage.push(Object.freeze({ ...input }));
    }

    /** Provider cost disclosure text shown next to the plugin action. */
    disclosure(pluginLabel: string): string {
        return `${pluginLabel} uses your configured model provider. Provider charges for this use are billed to that account, separately from OR3. OR3 reserves the worst-case cost of each call before dispatch and refuses further calls once $${this.#limits.spendLimitUsd.toFixed(2)} per activation is committed.`;
    }

    snapshot() {
        return Object.freeze({
            spendUsd: this.spendUsd,
            committedUsd: this.committedUsd,
            calls: this.#usage.length,
            budget: this.#ledger.snapshot(),
            limits: this.#limits,
        });
    }
}
