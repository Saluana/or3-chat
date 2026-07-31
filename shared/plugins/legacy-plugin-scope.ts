import type { PluginLifecycleCoverage } from './runtime-descriptor';

export const DEFAULT_V1_CLEANUP_TIMEOUT_MS = 5_000;

export type LegacyCleanupCallback = () => void | PromiseLike<void>;

export interface LegacyCleanupError {
    readonly index: number;
    readonly phase: 'invoke' | 'settle';
    readonly error: unknown;
}

export interface LegacyCleanupReport {
    readonly status: 'clean' | 'degraded';
    readonly timedOut: boolean;
    readonly invokedCount: number;
    readonly settledThenableCount: number;
    readonly errors: readonly LegacyCleanupError[];
    readonly durationMs: number;
}

export interface LegacyLifecycleCoverageReport {
    /** Resources registered through the passed V1 API are scope-owned. */
    readonly mediated: Extract<PluginLifecycleCoverage, 'managed-v1-api'>;
    /** Arbitrary V1 imports and side effects remain impossible to prove owned. */
    readonly overall: Extract<PluginLifecycleCoverage, 'legacy-global-possible'>;
}

export const LEGACY_LIFECYCLE_COVERAGE: LegacyLifecycleCoverageReport = Object.freeze({
    mediated: 'managed-v1-api',
    overall: 'legacy-global-possible',
});

export class ScopeOwnedAbortController {
    readonly signal: AbortSignal;
    readonly owner: symbol;
    readonly #controller = new AbortController();

    constructor(owner: symbol) {
        this.owner = owner;
        this.signal = this.#controller.signal;
    }

    abort(requestingOwner: symbol, reason?: unknown): boolean {
        if (requestingOwner !== this.owner || this.signal.aborted) return false;
        this.#controller.abort(reason);
        return true;
    }
}

export type CleanupInvocation =
    | { readonly status: 'stale-owner' | 'already-invoked' }
    | { readonly status: 'invoked'; readonly value?: void | PromiseLike<void> }
    | { readonly status: 'threw'; readonly error: unknown };

export class ScopeOwnedCleanupRecord {
    readonly owner: symbol;
    readonly index: number;
    #invoked = false;

    constructor(
        owner: symbol,
        index: number,
        private readonly callback: LegacyCleanupCallback
    ) {
        this.owner = owner;
        this.index = index;
    }

    get invoked(): boolean {
        return this.#invoked;
    }

    invoke(requestingOwner: symbol): CleanupInvocation {
        if (requestingOwner !== this.owner) return { status: 'stale-owner' };
        if (this.#invoked) return { status: 'already-invoked' };
        this.#invoked = true;
        try {
            return { status: 'invoked', value: this.callback() };
        } catch (error) {
            return { status: 'threw', error };
        }
    }
}

export interface LegacyPluginScopeOptions {
    owner?: symbol;
    cleanupTimeoutMs?: number;
    onCleanupError?: (error: LegacyCleanupError) => void;
    now?: () => number;
}

function isThenable(value: unknown): value is PromiseLike<void> {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        typeof (value as PromiseLike<void>).then === 'function'
    );
}

function freezeError(error: LegacyCleanupError): LegacyCleanupError {
    return Object.freeze({ ...error });
}

/** V1-compatible immediate scope with FIFO, concurrently-settled cleanup. */
export class LegacyPluginScope {
    readonly owner: symbol;
    readonly signal: AbortSignal;
    readonly lifecycleCoverage = LEGACY_LIFECYCLE_COVERAGE;
    readonly #abortController: ScopeOwnedAbortController;
    readonly #records: ScopeOwnedCleanupRecord[] = [];
    readonly #cleanupTimeoutMs: number;
    readonly #onCleanupError?: (error: LegacyCleanupError) => void;
    readonly #now: () => number;
    #disposePromise?: Promise<LegacyCleanupReport>;

    constructor(options: LegacyPluginScopeOptions = {}) {
        const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_V1_CLEANUP_TIMEOUT_MS;
        if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs < 0) {
            throw new RangeError('Legacy cleanup timeout must be a finite non-negative number');
        }
        this.owner = options.owner ?? Symbol('legacy-plugin-scope');
        this.#abortController = new ScopeOwnedAbortController(this.owner);
        this.signal = this.#abortController.signal;
        this.#cleanupTimeoutMs = cleanupTimeoutMs;
        this.#onCleanupError = options.onCleanupError;
        this.#now = options.now ?? Date.now;
    }

    get disposed(): boolean {
        return this.#disposePromise !== undefined;
    }

    onCleanup(callback: LegacyCleanupCallback): ScopeOwnedCleanupRecord | null {
        if (this.disposed) return null;
        const record = new ScopeOwnedCleanupRecord(
            this.owner,
            this.#records.length,
            callback
        );
        this.#records.push(record);
        return record;
    }

    abort(reason?: unknown): boolean {
        return this.#abortController.abort(this.owner, reason);
    }

    dispose(reason?: unknown): Promise<LegacyCleanupReport> {
        if (!this.#disposePromise) {
            this.#disposePromise = this.#runCleanup(reason);
        }
        return this.#disposePromise;
    }

    async #runCleanup(reason?: unknown): Promise<LegacyCleanupReport> {
        const startedAt = this.#now();
        this.abort(reason);
        const errors: LegacyCleanupError[] = [];
        const thenables: Promise<void>[] = [];
        let settledThenableCount = 0;

        const reportError = (error: LegacyCleanupError) => {
            const frozen = freezeError(error);
            errors.push(frozen);
            this.#onCleanupError?.(frozen);
        };

        // Invocation is deliberately FIFO and contains no await. Every thenable
        // starts before settlement is observed, preserving the V1 profile.
        for (const record of this.#records) {
            const invocation = record.invoke(this.owner);
            if (invocation.status === 'threw') {
                reportError({ index: record.index, phase: 'invoke', error: invocation.error });
                continue;
            }
            if (invocation.status !== 'invoked' || !isThenable(invocation.value)) {
                continue;
            }
            const tracked = Promise.resolve(invocation.value).then(
                () => {
                    settledThenableCount += 1;
                },
                (error) => {
                    settledThenableCount += 1;
                    reportError({ index: record.index, phase: 'settle', error });
                }
            );
            thenables.push(tracked);
        }

        let timedOut = false;
        if (thenables.length > 0) {
            let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<'timeout'>((resolveTimeout) => {
                timeoutHandle = setTimeout(
                    () => resolveTimeout('timeout'),
                    this.#cleanupTimeoutMs
                );
                timeoutHandle.unref?.();
            });
            const settlement = Promise.allSettled(thenables).then(() => 'settled' as const);
            timedOut = (await Promise.race([settlement, timeout])) === 'timeout';
            if (timeoutHandle) clearTimeout(timeoutHandle);
        }

        const frozenErrors = Object.freeze(errors.map(freezeError));
        return Object.freeze({
            status: timedOut || frozenErrors.length > 0 ? 'degraded' : 'clean',
            timedOut,
            invokedCount: this.#records.length,
            settledThenableCount,
            errors: frozenErrors,
            durationMs: Math.max(0, this.#now() - startedAt),
        });
    }
}

