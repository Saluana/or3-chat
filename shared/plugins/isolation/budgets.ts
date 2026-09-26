/**
 * @module shared/plugins/isolation/budgets
 *
 * Purpose:
 * Recorded, enforceable budgets for portable sandbox execution: message size,
 * output size, call counts, concurrent work, UI tree depth/size/text, wall and
 * per-call deadlines, and cancellation/termination on breach.
 *
 * Behavior:
 * - `ContainmentBudgetLedger` accumulates usage per activation and returns
 *   structured `budget-exceeded` decisions; it never throws for budget reasons.
 * - UI trees are validated against depth, node and text caps.
 * - Exceeding a budget marks the ledger exceeded so the caller can terminate the
 *   sandbox and keep the host usable.
 *
 * Constraints:
 * - These are host-side limits, not OS-level memory/CPU isolation. Never claim
 *   absolute resource isolation.
 * - Limits are recorded once here so host, tests and documentation agree.
 *
 * Non-Goals:
 * - Process/worker lifecycle (see `worker-runtime`, `portable-bootstrap`).
 */

export interface ContainmentBudgets {
    /** Serialized envelope ceiling (bytes, UTF-8 JSON). */
    readonly maxMessageBytes: number;
    /** Single RPC result ceiling (bytes, UTF-8 JSON of the result). */
    readonly maxOutputBytes: number;
    /** Total bytes the sandbox may produce across one activation. */
    readonly maxTotalOutputBytes: number;
    /** Calls the sandbox may make across one activation. */
    readonly maxCallsPerActivation: number;
    /** In-flight calls allowed at once. */
    readonly maxConcurrentCalls: number;
    /** Default per-call deadline (ms). */
    readonly defaultCallDeadlineMs: number;
    /** Activation wall-clock ceiling (ms); breach terminates the sandbox. */
    readonly maxActivationMs: number;
    /** Declarative UI tree limits. */
    readonly maxUiTreeDepth: number;
    readonly maxUiTreeNodes: number;
    readonly maxUiTextBytes: number;
    /** Array entries and object members a UI tree may contain in total. */
    readonly maxUiTreeItems: number;
    /** Plugin-attributed AI/model spend ceiling per activation (USD). */
    readonly maxAiSpendUsd: number;
    /** Output token ceiling for a single plugin-attributed model call. */
    readonly maxAiOutputTokens: number;
}

/**
 * Recorded budgets. Chosen from the existing host worker limits (256 KiB
 * envelopes, 32 concurrent RPCs, 10s default deadline) and extended conservatively
 * for a single portable activation.
 */
export const DEFAULT_CONTAINMENT_BUDGETS: ContainmentBudgets = Object.freeze({
    maxMessageBytes: 256 * 1024,
    maxOutputBytes: 1024 * 1024,
    maxTotalOutputBytes: 4 * 1024 * 1024,
    maxCallsPerActivation: 1000,
    maxConcurrentCalls: 8,
    defaultCallDeadlineMs: 10_000,
    maxActivationMs: 120_000,
    // A workspace surface (navigation plus a list plus an inspector) is a real
    // product tree, not a card: these budgets size the renderer, and stay well
    // inside the RPC wire caps (256 KiB / 20k values) so a valid tree is never
    // refused by the transport after the renderer accepted it.
    maxUiTreeDepth: 12,
    maxUiTreeNodes: 1000,
    maxUiTextBytes: 64 * 1024,
    maxUiTreeItems: 12_000,
    maxAiSpendUsd: 1,
    maxAiOutputTokens: 4096,
});

export function resolveContainmentBudgets(
    overrides: Partial<ContainmentBudgets> = {}
): ContainmentBudgets {
    const budgets = { ...DEFAULT_CONTAINMENT_BUDGETS, ...overrides };
    for (const [key, value] of Object.entries(budgets)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new TypeError(`Containment budget ${key} must be a positive number`);
        }
    }
    return Object.freeze(budgets);
}

export type BudgetKind =
    | 'message-bytes'
    | 'output-bytes'
    | 'total-output-bytes'
    | 'calls'
    | 'concurrency'
    | 'activation-ms'
    | 'ai-spend'
    | 'ai-output-tokens';

export type BudgetDecision =
    | { readonly ok: true; readonly used: number; readonly limit: number }
    | {
          readonly ok: false;
          readonly code: 'budget-exceeded';
          readonly kind: BudgetKind;
          readonly message: string;
          readonly used: number;
          readonly limit: number;
          /** True when the sandbox must be terminated rather than throttled. */
          readonly terminate: boolean;
      };

export interface BudgetSnapshot {
    readonly calls: number;
    readonly concurrentCalls: number;
    readonly totalOutputBytes: number;
    readonly aiSpendUsd: number;
    readonly activationMs: number;
    readonly exceeded: BudgetKind | null;
}

function utf8Bytes(value: unknown): number {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return new TextEncoder().encode(text).byteLength;
}

/**
 * Per-activation budget ledger. One instance per sandbox generation.
 */
export class ContainmentBudgetLedger {
    readonly #budgets: ContainmentBudgets;
    readonly #now: () => number;
    readonly #startedAt: number;
    /** When true, a terminal budget is spent and no further work may start. */
    #exhausted: BudgetKind | null = null;
    #calls = 0;
    #concurrentCalls = 0;
    #totalOutputBytes = 0;
    #aiSpendUsd = 0;
    #exceeded: BudgetKind | null = null;

    constructor(
        budgets: ContainmentBudgets = DEFAULT_CONTAINMENT_BUDGETS,
        options: { readonly now?: () => number } = {}
    ) {
        this.#budgets = budgets;
        this.#now = options.now ?? (() => Date.now());
        this.#startedAt = this.#now();
    }

    get budgets(): ContainmentBudgets {
        return this.#budgets;
    }

    get exceeded(): BudgetKind | null {
        return this.#exceeded;
    }

    /** Set once a terminal budget is spent; the activation must be terminated. */
    get exhausted(): BudgetKind | null {
        return this.#exhausted;
    }

    snapshot(): BudgetSnapshot {
        return Object.freeze({
            calls: this.#calls,
            concurrentCalls: this.#concurrentCalls,
            totalOutputBytes: this.#totalOutputBytes,
            aiSpendUsd: this.#aiSpendUsd,
            activationMs: this.#now() - this.#startedAt,
            exceeded: this.#exceeded,
        });
    }

    /**
     * Check the activation wall-clock budget without admitting a call.
     * The runtime attaches a host timer to this so a sandbox that stops calling
     * is still stopped, instead of only being noticed on its next request.
     */
    checkActivation(): BudgetDecision {
        const ageMs = this.#now() - this.#startedAt;
        if (ageMs >= this.#budgets.maxActivationMs) {
            return this.#exceed(
                'activation-ms',
                ageMs,
                this.#budgets.maxActivationMs,
                true
            );
        }
        return { ok: true, used: ageMs, limit: this.#budgets.maxActivationMs };
    }

    /** Charge an inbound or outbound message against the size budget. */
    chargeMessage(value: unknown, budgets: ContainmentBudgets = this.#budgets): BudgetDecision {
        const used = utf8Bytes(value);
        if (used > budgets.maxMessageBytes) {
            return this.#exceed('message-bytes', used, budgets.maxMessageBytes, true);
        }
        return { ok: true, used, limit: budgets.maxMessageBytes };
    }

    /** Charge a result against the per-result and total output budgets. */
    chargeOutput(value: unknown): BudgetDecision {
        const used = utf8Bytes(value);
        if (used > this.#budgets.maxOutputBytes) {
            return this.#exceed('output-bytes', used, this.#budgets.maxOutputBytes, true);
        }
        const total = this.#totalOutputBytes + used;
        if (total > this.#budgets.maxTotalOutputBytes) {
            return this.#exceed(
                'total-output-bytes',
                total,
                this.#budgets.maxTotalOutputBytes,
                true
            );
        }
        this.#totalOutputBytes = total;
        return { ok: true, used, limit: this.#budgets.maxOutputBytes };
    }

    /** Admit a call, enforcing exhaustion, count, concurrency and activation age. */
    admitCall(): BudgetDecision {
        if (this.#exhausted !== null) {
            // A spent terminal budget cannot be recovered by refusing one result:
            // the activation must be terminated instead of admitting more work.
            return {
                ok: false,
                code: 'budget-exceeded',
                kind: this.#exhausted,
                message: `Containment budget ${this.#exhausted} is exhausted; the plugin must be stopped`,
                used: 1,
                limit: 0,
                terminate: true,
            };
        }
        const activation = this.checkActivation();
        if (!activation.ok) {
            return activation;
        }
        if (this.#concurrentCalls >= this.#budgets.maxConcurrentCalls) {
            return this.#exceed(
                'concurrency',
                this.#concurrentCalls,
                this.#budgets.maxConcurrentCalls,
                false
            );
        }
        const calls = this.#calls + 1;
        if (calls > this.#budgets.maxCallsPerActivation) {
            return this.#exceed(
                'calls',
                calls,
                this.#budgets.maxCallsPerActivation,
                true
            );
        }
        this.#calls = calls;
        this.#concurrentCalls += 1;
        return { ok: true, used: calls, limit: this.#budgets.maxCallsPerActivation };
    }

    /** Release a call admitted with `admitCall`. */
    releaseCall(): void {
        if (this.#concurrentCalls > 0) this.#concurrentCalls -= 1;
    }

    /** Charge a plugin-attributed model call against spend and output budgets. */
    chargeAiUsage(input: {
        readonly spendUsd: number;
        readonly outputTokens: number;
    }): BudgetDecision {
        if (input.outputTokens > this.#budgets.maxAiOutputTokens) {
            return this.#exceed(
                'ai-output-tokens',
                input.outputTokens,
                this.#budgets.maxAiOutputTokens,
                true
            );
        }
        const spend = this.#aiSpendUsd + Math.max(0, input.spendUsd);
        if (spend > this.#budgets.maxAiSpendUsd) {
            return this.#exceed('ai-spend', spend, this.#budgets.maxAiSpendUsd, true);
        }
        this.#aiSpendUsd = spend;
        return { ok: true, used: spend, limit: this.#budgets.maxAiSpendUsd };
    }

    #exceed(
        kind: BudgetKind,
        used: number,
        limit: number,
        terminate: boolean
    ): BudgetDecision {
        this.#exceeded = kind;
        // A terminal breach is recorded once: the activation cannot continue even
        // if the caller ignores the returned decision.
        if (terminate) this.#exhausted ??= kind;
        return {
            ok: false,
            code: 'budget-exceeded',
            kind,
            message: `Containment budget ${kind} exceeded (${used} > ${limit})`,
            used,
            limit,
            terminate,
        };
    }
}

export type UiTreeValidation =
    | {
          readonly ok: true;
          readonly nodes: number;
          readonly depth: number;
          readonly textBytes: number;
          readonly items: number;
      }
    | {
          readonly ok: false;
          readonly code: 'budget-exceeded';
          readonly kind:
              | 'ui-tree-depth'
              | 'ui-tree-nodes'
              | 'ui-text-bytes'
              | 'ui-tree-items';
          readonly message: string;
      };

/** Structural shape shared by every declarative primitive set. */
type BudgetedNode = {
    readonly type?: unknown;
    readonly text?: unknown;
    readonly children?: unknown;
};

function childNodesOf(node: BudgetedNode): readonly BudgetedNode[] {
    return Array.isArray(node.children)
        ? (node.children as readonly BudgetedNode[])
        : [];
}

/**
 * Validate a declarative UI tree against depth, node, item and text budgets.
 *
 * One bounded pass: every string the renderer can show counts (text, markdown,
 * captions, table cells, list labels/descriptions, option labels, placeholders and
 * field values), and every array entry and object member counts toward the item
 * budget, so a table full of large cells cannot hide behind "one node with no
 * text". Traversal stops at the first breach. Runs in addition to (never instead
 * of) schema validation.
 */
export function validateUiTreeBudgets(
    tree: BudgetedNode,
    budgets: ContainmentBudgets = DEFAULT_CONTAINMENT_BUDGETS
): UiTreeValidation {
    let nodes = 0;
    let textBytes = 0;
    let items = 0;
    let maxDepth = 0;

    type Failure = Extract<UiTreeValidation, { ok: false }>;

    const exceed = (
        kind: Failure['kind'],
        message: string
    ): Failure => ({ ok: false, code: 'budget-exceeded', kind, message });

    const addItems = (count: number): Failure | null => {
        items += count;
        if (items > budgets.maxUiTreeItems) {
            return exceed(
                'ui-tree-items',
                `UI tree has more than ${budgets.maxUiTreeItems} items`
            );
        }
        return null;
    };

    const addText = (value: string): Failure | null => {
        textBytes += utf8Bytes(value);
        if (textBytes > budgets.maxUiTextBytes) {
            return exceed(
                'ui-text-bytes',
                `UI tree text exceeds ${budgets.maxUiTextBytes} bytes`
            );
        }
        return null;
    };

    /** Walks any value the renderer may read; returns the first breach. */
    const walkData = (value: unknown): Failure | null => {
        if (typeof value === 'string') return addText(value);
        if (Array.isArray(value)) {
            const counted = addItems(value.length);
            if (counted) return counted;
            for (const entry of value) {
                const failure = walkData(entry);
                if (failure) return failure;
            }
            return null;
        }
        if (typeof value === 'object' && value !== null) {
            const entries = Object.entries(value as Record<string, unknown>);
            const counted = addItems(entries.length);
            if (counted) return counted;
            for (const [, entry] of entries) {
                const failure = walkData(entry);
                if (failure) return failure;
            }
            return null;
        }
        return null;
    };

    const walk = (node: BudgetedNode, depth: number): Failure | null => {
        if (depth > budgets.maxUiTreeDepth) {
            return exceed(
                'ui-tree-depth',
                `UI tree depth exceeds ${budgets.maxUiTreeDepth}`
            );
        }
        maxDepth = Math.max(maxDepth, depth);
        nodes += 1;
        if (nodes > budgets.maxUiTreeNodes) {
            return exceed(
                'ui-tree-nodes',
                `UI tree has more than ${budgets.maxUiTreeNodes} nodes`
            );
        }

        let children: readonly BudgetedNode[] = [];
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            // `type` is the structural discriminator, not rendered content.
            if (key === 'children') {
                children = childNodesOf(node);
                continue;
            }
            if (key === 'type') continue;
            const failure = walkData(value);
            if (failure) return failure;
        }

        const counted = addItems(children.length);
        if (counted) return counted;
        for (const child of children) {
            const failure = walk(child, depth + 1);
            if (failure) return failure;
        }
        return null;
    };

    const failure = walk(tree as BudgetedNode, 1);
    if (failure) return failure;
    return { ok: true, nodes, depth: maxDepth, textBytes, items };
}

/**
 * Recorded behaviour when a budget is exceeded: the sandbox is terminated and
 * the host stays usable. Callers surface this text to the user.
 */
export function describeBudgetTermination(
    decision: Extract<BudgetDecision, { ok: false }>
): string {
    return decision.terminate
        ? `${decision.message}. The plugin was stopped to keep OR3 responsive.`
        : `${decision.message}. The request was refused; the plugin stays running.`;
}
