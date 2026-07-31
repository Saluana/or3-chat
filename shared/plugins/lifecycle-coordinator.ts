export type PluginLifecycleBoundary =
    | 'fetch'
    | 'import'
    | 'register'
    | 'stop'
    | 'validation'
    | 'activation';

export class StalePluginGenerationError extends Error {
    readonly code = 'stale-plugin-generation';

    constructor(
        readonly pluginId: string,
        readonly generation: number,
        readonly boundary: PluginLifecycleBoundary
    ) {
        super(`Plugin ${pluginId} generation ${generation} was superseded after ${boundary}`);
        this.name = 'StalePluginGenerationError';
    }
}

export interface PluginGenerationLease {
    readonly pluginId: string;
    readonly generation: number;
    readonly signal: AbortSignal;
    isCurrent(): boolean;
    assertCurrent(boundary: PluginLifecycleBoundary): void;
    after<T>(boundary: PluginLifecycleBoundary, operation: PromiseLike<T>): Promise<T>;
}

type GenerationSlot = { generation: number; controller: AbortController };

/** Issues monotonic per-plugin leases and synchronously aborts superseded work. */
export class PluginGenerationClock {
    readonly #slots = new Map<string, GenerationSlot>();

    supersede(pluginId: string, reason: unknown = 'superseded'): PluginGenerationLease {
        const previous = this.#slots.get(pluginId);
        previous?.controller.abort(reason);
        const slot: GenerationSlot = {
            generation: (previous?.generation ?? 0) + 1,
            controller: new AbortController(),
        };
        this.#slots.set(pluginId, slot);
        const isCurrent = () => this.#slots.get(pluginId) === slot;
        const assertCurrent = (boundary: PluginLifecycleBoundary) => {
            if (!isCurrent()) {
                throw new StalePluginGenerationError(pluginId, slot.generation, boundary);
            }
        };
        return Object.freeze({
            pluginId,
            generation: slot.generation,
            signal: slot.controller.signal,
            isCurrent,
            assertCurrent,
            async after<T>(boundary: PluginLifecycleBoundary, operation: PromiseLike<T>) {
                const value = await operation;
                assertCurrent(boundary);
                return value;
            },
        });
    }

    currentGeneration(pluginId: string): number | undefined {
        return this.#slots.get(pluginId)?.generation;
    }
}

/** Same-key lifecycle work serializes; unrelated plugin IDs never share a queue. */
export class PerPluginLifecycleMutex {
    readonly #tails = new Map<string, Promise<void>>();

    async runExclusive<T>(pluginId: string, operation: () => T | PromiseLike<T>): Promise<T> {
        const previous = this.#tails.get(pluginId) ?? Promise.resolve();
        let release!: () => void;
        const tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.#tails.set(pluginId, tail);
        await previous.catch(() => undefined);
        try {
            return await operation();
        } finally {
            release();
            if (this.#tails.get(pluginId) === tail) this.#tails.delete(pluginId);
        }
    }
}

export interface ReconcileRequest<T> {
    readonly revision: number;
    readonly value: T;
}

/** Coalesces concurrent triggers and processes only the newest pending request. */
export class SerializedReconcileCoordinator<T> {
    #latestRevision = 0;
    #pending?: ReconcileRequest<T>;
    #drain?: Promise<void>;

    constructor(
        private readonly reconcile: (request: ReconcileRequest<T>) => void | Promise<void>
    ) {}

    request(value: T): Promise<void> {
        this.#pending = { revision: ++this.#latestRevision, value };
        if (!this.#drain) {
            this.#drain = this.#run().finally(() => {
                this.#drain = undefined;
                if (this.#pending) void this.requestDrain();
            });
        }
        return this.#drain;
    }

    private requestDrain(): Promise<void> {
        if (!this.#drain) {
            this.#drain = this.#run().finally(() => {
                this.#drain = undefined;
                if (this.#pending) void this.requestDrain();
            });
        }
        return this.#drain;
    }

    async #run(): Promise<void> {
        while (this.#pending) {
            const next = this.#pending;
            this.#pending = undefined;
            await this.reconcile(next);
        }
    }
}

