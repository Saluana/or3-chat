import { ActivationTable } from './activation-table';
import {
    ContributionRegistry,
    type RegistryStageResult,
    type StagedContribution,
} from './contribution-registry';

export type TransactionalPluginScopeState = 'open' | 'prepared' | 'published' | 'disposed';

export interface PluginPreparationError {
    readonly code: 'invalid-state' | 'validation-failed' | 'pre-activation-failed' | 'stage-failed';
    readonly phase: 'validation' | 'pre-activation' | 'stage';
    readonly message: string;
    readonly cause?: unknown;
}

export interface StaleGenerationError {
    readonly code: 'stale-generation' | 'publication-failed';
    readonly phase: 'publication';
    readonly message: string;
    readonly cause?: unknown;
}

export type TransactionalResult<E> =
    | { readonly ok: true }
    | { readonly ok: false; readonly error: E };

export interface TransactionalCleanupError {
    readonly index: number;
    readonly error: unknown;
}

export interface TransactionalCleanupReport {
    readonly status: 'clean' | 'degraded';
    readonly disposedCount: number;
    readonly errors: readonly TransactionalCleanupError[];
}

type Callback = () => void | PromiseLike<void>;
type StagedRegistryOperation = {
    validate(): RegistryStageResult;
    insert(): RegistryStageResult;
    remove(): number;
};

function failure<E extends PluginPreparationError | StaleGenerationError>(error: E) {
    return { ok: false as const, error: Object.freeze(error) };
}

/** Atomic V2 preparation/publication scope. V1 plugins never enter this profile. */
export class TransactionalPluginScope {
    readonly owner: symbol;
    readonly signal: AbortSignal;
    readonly #controller = new AbortController();
    readonly #activationTable: ActivationTable;
    readonly #pluginId: string;
    readonly #generation: number;
    readonly #staged: StagedRegistryOperation[] = [];
    readonly #validationCallbacks: Callback[] = [];
    readonly #preActivationCallbacks: Callback[] = [];
    readonly #disposalCallbacks: Callback[] = [];
    readonly #afterPublish?: () => void;
    #state: TransactionalPluginScopeState = 'open';
    #validated = false;
    #publishedPreviousOwner?: symbol;
    #cleanupPromise?: Promise<TransactionalCleanupReport>;

    constructor(options: {
        pluginId: string;
        generation: number;
        activationTable: ActivationTable;
        owner?: symbol;
        /** Synchronous fault-injection/host-finalization seam. */
        afterPublish?: () => void;
    }) {
        this.#pluginId = options.pluginId;
        this.#generation = options.generation;
        this.#activationTable = options.activationTable;
        this.owner = options.owner ?? Symbol(`${options.pluginId}:${options.generation}`);
        this.signal = this.#controller.signal;
        this.#afterPublish = options.afterPublish;
    }

    get state(): TransactionalPluginScopeState {
        return this.#state;
    }

    stageContributions<T, TContext, TMetadata>(
        registry: ContributionRegistry<T, TContext, TMetadata>,
        values: readonly StagedContribution<T, TMetadata>[]
    ): void {
        if (this.#state !== 'open' || this.#validated) {
            throw new Error('Contributions can only be staged before validation');
        }
        const input = {
            owner: this.owner,
            pluginId: this.#pluginId,
            generation: this.#generation,
            values,
        };
        this.#staged.push({
            validate: () => registry.validateStage(input),
            insert: () => registry.stage(input),
            remove: () => registry.removeOwner(this.owner),
        });
    }

    onValidate(callback: Callback): void {
        this.#assertOpenForRegistration();
        this.#validationCallbacks.push(callback);
    }

    onPreActivate(callback: Callback): void {
        this.#assertOpenForRegistration();
        this.#preActivationCallbacks.push(callback);
    }

    onDispose(callback: Callback): void {
        if (this.#state === 'disposed') throw new Error('Scope is already disposed');
        this.#disposalCallbacks.push(callback);
    }

    async validate(): Promise<TransactionalResult<PluginPreparationError>> {
        if (this.#state !== 'open') return this.#invalidPreparationState('validation');
        try {
            for (const operation of this.#staged) {
                const result = operation.validate();
                if (!result.ok) {
                    return failure({
                        code: 'validation-failed',
                        phase: 'validation',
                        message: `Contribution validation failed: ${result.code}`,
                        cause: result,
                    });
                }
            }
            for (const callback of this.#validationCallbacks) await callback();
            this.#validated = true;
            return { ok: true };
        } catch (cause) {
            return failure({
                code: 'validation-failed',
                phase: 'validation',
                message: 'Plugin validation threw',
                cause,
            });
        }
    }

    async preActivate(): Promise<TransactionalResult<PluginPreparationError>> {
        if (this.#state !== 'open' || !this.#validated) {
            return this.#invalidPreparationState('pre-activation');
        }
        try {
            for (const callback of this.#preActivationCallbacks) await callback();
            this.#state = 'prepared';
            return { ok: true };
        } catch (cause) {
            return failure({
                code: 'pre-activation-failed',
                phase: 'pre-activation',
                message: 'Plugin pre-activation threw',
                cause,
            });
        }
    }

    publish(expectedOwner?: symbol): TransactionalResult<StaleGenerationError | PluginPreparationError> {
        if (this.#state !== 'prepared') {
            return failure({
                code: 'invalid-state',
                phase: 'stage',
                message: `Cannot publish scope in ${this.#state} state`,
            });
        }
        const inserted: StagedRegistryOperation[] = [];
        for (const operation of this.#staged) {
            const result = operation.insert();
            if (!result.ok) {
                for (const staged of inserted.reverse()) staged.remove();
                return failure({
                    code: 'stage-failed',
                    phase: 'stage',
                    message: `Hidden contribution insert failed: ${result.code}`,
                    cause: result,
                });
            }
            inserted.push(operation);
        }

        let swapped = false;
        try {
            swapped = this.#activationTable.publish({
                pluginId: this.#pluginId,
                expected: expectedOwner,
                next: this.owner,
            });
            if (!swapped) {
                for (const staged of inserted.reverse()) staged.remove();
                return failure({
                    code: 'stale-generation',
                    phase: 'publication',
                    message: 'A newer plugin generation already owns publication',
                });
            }
            this.#afterPublish?.();
            this.#publishedPreviousOwner = expectedOwner;
            this.#state = 'published';
            return { ok: true };
        } catch (cause) {
            if (swapped || this.#activationTable.current(this.#pluginId) === this.owner) {
                try {
                    this.#activationTable.compareAndSwap({
                        pluginId: this.#pluginId,
                        expected: this.owner,
                        next: expectedOwner,
                    });
                } catch {
                    // The pointer mutation happens before listener notification;
                    // cleanup below remains exact-owner even if notification fails.
                }
            }
            for (const staged of inserted.reverse()) staged.remove();
            return failure({
                code: 'publication-failed',
                phase: 'publication',
                message: 'Synchronous publication finalization failed',
                cause,
            });
        }
    }

    rollback(reason?: unknown): Promise<TransactionalCleanupReport> {
        return this.#dispose(reason, true);
    }

    dispose(reason?: unknown): Promise<TransactionalCleanupReport> {
        return this.#dispose(reason, false);
    }

    #dispose(reason: unknown, restorePrevious: boolean): Promise<TransactionalCleanupReport> {
        if (!this.#cleanupPromise) {
            this.#cleanupPromise = this.#runDisposal(reason, restorePrevious);
        }
        return this.#cleanupPromise;
    }

    async #runDisposal(
        reason: unknown,
        restorePrevious: boolean
    ): Promise<TransactionalCleanupReport> {
        this.#controller.abort(reason);
        if (this.#state === 'published') {
            this.#activationTable.compareAndSwap({
                pluginId: this.#pluginId,
                expected: this.owner,
                next: restorePrevious ? this.#publishedPreviousOwner : undefined,
            });
        }
        for (const operation of [...this.#staged].reverse()) operation.remove();
        const errors: TransactionalCleanupError[] = [];
        let disposedCount = 0;
        for (let index = this.#disposalCallbacks.length - 1; index >= 0; index--) {
            const callback = this.#disposalCallbacks[index]!;
            try {
                await callback();
            } catch (error) {
                errors.push(Object.freeze({ index, error }));
            } finally {
                disposedCount += 1;
            }
        }
        this.#state = 'disposed';
        return Object.freeze({
            status: errors.length ? 'degraded' : 'clean',
            disposedCount,
            errors: Object.freeze(errors),
        });
    }

    #assertOpenForRegistration(): void {
        if (this.#state !== 'open' || this.#validated) {
            throw new Error('Scope callbacks can only be registered before validation');
        }
    }

    #invalidPreparationState(
        phase: PluginPreparationError['phase']
    ): TransactionalResult<PluginPreparationError> {
        return failure({
            code: 'invalid-state',
            phase,
            message: `Cannot run ${phase} in ${this.#state} state`,
        });
    }
}
