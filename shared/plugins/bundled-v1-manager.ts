import type { BundledV1PluginDescriptor, Sha256 } from './runtime-descriptor';
import type { LegacyCleanupReport } from './legacy-plugin-scope';
import {
    PluginGenerationClock,
    SerializedReconcileCoordinator,
    StalePluginGenerationError,
    type PluginGenerationLease,
    type PluginLifecycleBoundary,
} from './lifecycle-coordinator';
import { diffBundledV1Descriptors, type BundledV1Diff } from './bundled-v1-diff';
import { classifyRuntimeFailure, type SerializedPluginError } from './runtime-state';

export interface ManagedBundledV1Instance {
    register(): void | Promise<void>;
    stop(reason?: unknown): Promise<LegacyCleanupReport>;
}

export interface BundledV1ManagerDesiredState {
    readonly descriptors: readonly BundledV1PluginDescriptor[];
    readonly revision: string;
}

export interface BundledV1ManagerRecord {
    readonly descriptor: BundledV1PluginDescriptor;
    readonly desired: 'active' | 'inactive';
    readonly status: 'discovered' | 'preparing' | 'active' | 'stopping' | 'failed' | 'quarantined' | 'blocked';
    readonly generation: number;
    readonly lifecycleCoverage: 'legacy-global-possible';
    readonly failureCount: number;
    readonly lastError?: SerializedPluginError;
    readonly nextRetryAt?: number;
    readonly quarantinedDescriptorKey?: Sha256;
    readonly diff?: BundledV1Diff;
    readonly updatedAt: number;
}

export interface BundledV1PluginManagerOptions {
    fetchDesired?(signal: AbortSignal): Promise<BundledV1ManagerDesiredState>;
    load(
        descriptor: BundledV1PluginDescriptor,
        signal: AbortSignal
    ): Promise<ManagedBundledV1Instance>;
    quarantineThreshold?: number;
    retryBaseMs?: number;
    retryMaxMs?: number;
    cleanupTimeoutMs?: number;
    now?: () => number;
}

type ActiveGeneration = {
    descriptor: BundledV1PluginDescriptor;
    generation: number;
    instance: ManagedBundledV1Instance;
};

type ReconcileWork = {
    lease: PluginGenerationLease;
    trigger: string;
    desiredState?: BundledV1ManagerDesiredState;
};

function serializeError(
    error: unknown,
    phase: SerializedPluginError['phase'],
    retryable = true,
    code = 'plugin-lifecycle-failed'
): SerializedPluginError {
    return Object.freeze({
        code,
        message: error instanceof Error ? error.message : String(error),
        phase,
        retryable,
    });
}

/** Owns the ordered lifecycle of bundled plugins, including the register(api) contract. */
export class BundledV1PluginManager {
    readonly #options: Required<
        Pick<
            BundledV1PluginManagerOptions,
            'quarantineThreshold' | 'retryBaseMs' | 'retryMaxMs' | 'cleanupTimeoutMs'
        >
    > & BundledV1PluginManagerOptions;
    readonly #now: () => number;
    readonly #generationClock = new PluginGenerationClock();
    readonly #coordinator: SerializedReconcileCoordinator<ReconcileWork>;
    readonly #active = new Map<string, ActiveGeneration>();
    readonly #records = new Map<string, BundledV1ManagerRecord>();
    readonly #failures = new Map<Sha256, number>();
    #lastDesired = new Map<string, BundledV1PluginDescriptor>();
    #lastManifestRevision = '';

    constructor(options: BundledV1PluginManagerOptions) {
        this.#options = {
            ...options,
            quarantineThreshold: options.quarantineThreshold ?? 3,
            retryBaseMs: options.retryBaseMs ?? 1_000,
            retryMaxMs: options.retryMaxMs ?? 30_000,
            cleanupTimeoutMs: options.cleanupTimeoutMs ?? 6_000,
        };
        this.#now = options.now ?? Date.now;
        this.#coordinator = new SerializedReconcileCoordinator(({ value }) =>
            this.#reconcile(value)
        );
    }

    schedule(trigger: string): Promise<void> {
        const lease = this.#generationClock.supersede('__reconcile__', trigger);
        return this.#coordinator.request({ lease, trigger });
    }

    /** Apply an accepted snapshot supplied by the workspace coordinator. */
    reconcile(desiredState: BundledV1ManagerDesiredState, trigger: string): Promise<void> {
        const lease = this.#generationClock.supersede('__reconcile__', trigger);
        return this.#coordinator.request({ lease, trigger, desiredState });
    }

    /** Serialized context teardown used before a workspace/session boundary. */
    stopAll(trigger = 'stop-all'): Promise<void> {
        const lease = this.#generationClock.supersede('__reconcile__', trigger);
        return this.#coordinator.request({
            lease,
            trigger,
            desiredState: {
                descriptors: [],
                revision: `empty:${lease.generation}`,
            },
        }).then(() => {
            if (this.#active.size) throw new Error('Bundled workspace plugin teardown failed');
        });
    }

    listRecords(): readonly BundledV1ManagerRecord[] {
        return Object.freeze(
            Array.from(this.#records.values())
                .sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id))
                .map((record) => Object.freeze({ ...record }))
        );
    }

    listActivePluginIds(): readonly string[] {
        return Object.freeze(Array.from(this.#active.keys()).sort());
    }

    retry(descriptorKey: Sha256): boolean {
        const removed = this.#failures.delete(descriptorKey);
        for (const [id, record] of this.#records) {
            if (record.descriptor.descriptorKey !== descriptorKey) continue;
            this.#records.set(id, {
                ...record,
                status: 'discovered',
                failureCount: 0,
                lastError: undefined,
                nextRetryAt: undefined,
                quarantinedDescriptorKey: undefined,
                updatedAt: this.#now(),
            });
        }
        return removed;
    }

    async #afterBoundary<T>(
        reconcileLease: PluginGenerationLease,
        pluginLease: PluginGenerationLease,
        boundary: PluginLifecycleBoundary,
        operation: PromiseLike<T>
    ): Promise<T> {
        const value = await operation;
        reconcileLease.assertCurrent(boundary);
        pluginLease.assertCurrent(boundary);
        return value;
    }

    async #reconcile(work: ReconcileWork): Promise<void> {
        let desiredState: BundledV1ManagerDesiredState;
        if (work.desiredState) {
            desiredState = work.desiredState;
        } else {
            try {
                desiredState = await work.lease.after(
                    'fetch',
                    this.#options.fetchDesired
                        ? this.#options.fetchDesired(work.lease.signal)
                        : Promise.resolve({ descriptors: [...this.#lastDesired.values()], revision: this.#lastManifestRevision })
                );
            } catch (error) {
                // Unknown/transient manifest failure or supersession preserves every
                // healthy active generation. A later trigger retries.
                if (error instanceof StalePluginGenerationError) return;
                return;
            }
        }
        // Retry/backoff state can change without a new manifest revision.
        // Descriptor diffs keep healthy generations unchanged on these passes.
        const desired = new Map(
            desiredState.descriptors.map((descriptor) => [descriptor.id, descriptor])
        );
        this.#lastDesired = desired;
        const ids = Array.from(
            new Set([...this.#active.keys(), ...this.#records.keys(), ...desired.keys()])
        ).sort();
        try {
            // Older plugins can depend on each other's global resources. Finish
            // every removal/replacement before importing any new generation.
            let cleanupFailed = false;
            // Preserve the original loader's activation order during teardown.
            for (const [pluginId, active] of this.#active) {
                work.lease.assertCurrent('validation');
                const diff = diffBundledV1Descriptors({
                    active: active.descriptor,
                    desired: desired.get(pluginId),
                });
                if (diff.action !== 'stop' && diff.action !== 'replace') continue;
                const pluginLease = this.#generationClock.supersede(pluginId, diff.action);
                if (!(await this.#stopActive(work.lease, pluginLease, active, diff))) {
                    cleanupFailed = true;
                }
            }
            if (cleanupFailed) return;

            // Match the original loader's server-sorted, sequential startup.
            for (const pluginId of ids) {
                await this.#reconcilePlugin(work.lease, pluginId, desired.get(pluginId));
            }
        } catch (error) {
            if (error instanceof StalePluginGenerationError) return;
            throw error;
        }
        if (work.lease.isCurrent()) this.#lastManifestRevision = desiredState.revision;
    }

    async #reconcilePlugin(
        reconcileLease: PluginGenerationLease,
        pluginId: string,
        desired: BundledV1PluginDescriptor | undefined
    ): Promise<void> {
        reconcileLease.assertCurrent('validation');
        const active = this.#active.get(pluginId);
        const diff = diffBundledV1Descriptors({ active: active?.descriptor, desired });
        if (diff.action === 'none') {
            if (!active && !desired) this.#records.delete(pluginId);
            return;
        }
        if (diff.action === 'rebuild-required') {
            if (desired) {
                this.#records.set(pluginId, {
                    descriptor: desired,
                    desired: 'active',
                    status: 'blocked',
                    generation: active?.generation ?? 0,
                    lifecycleCoverage: 'legacy-global-possible',
                    failureCount: 0,
                    lastError: serializeError(
                        diff.reason,
                        'verification',
                        false,
                        'rebuild-required'
                    ),
                    diff,
                    updatedAt: this.#now(),
                });
            }
            return;
        }

        const pluginLease = this.#generationClock.supersede(pluginId, diff.action);
        if (!desired) return;

        const previousFailures = this.#failures.get(desired.descriptorKey) ?? 0;
        const existing = this.#records.get(pluginId);
        if (
            existing?.descriptor.descriptorKey === desired.descriptorKey &&
            (existing.status === 'quarantined' || (existing.nextRetryAt ?? 0) > this.#now())
        ) {
            return;
        }
        this.#records.set(pluginId, {
            descriptor: desired,
            desired: 'active',
            status: 'preparing',
            generation: pluginLease.generation,
            lifecycleCoverage: 'legacy-global-possible',
            failureCount: previousFailures,
            diff,
            updatedAt: this.#now(),
        });

        let instance: ManagedBundledV1Instance | undefined;
        try {
            // Retain the imported instance before freshness checks so a module
            // that resolves after supersession can still be disposed safely.
            instance = await this.#options.load(desired, pluginLease.signal);
            reconcileLease.assertCurrent('import');
            pluginLease.assertCurrent('import');
            await this.#afterBoundary(
                reconcileLease,
                pluginLease,
                'register',
                Promise.resolve(instance.register())
            );
            this.#active.set(pluginId, {
                descriptor: desired,
                generation: pluginLease.generation,
                instance,
            });
            this.#failures.delete(desired.descriptorKey);
            this.#records.set(pluginId, {
                descriptor: desired,
                desired: 'active',
                status: 'active',
                generation: pluginLease.generation,
                lifecycleCoverage: 'legacy-global-possible',
                failureCount: 0,
                diff,
                updatedAt: this.#now(),
            });
        } catch (error) {
            if (instance) await instance.stop(error).catch(() => undefined);
            if (error instanceof StalePluginGenerationError) return;
            const classification = classifyRuntimeFailure(
                previousFailures,
                this.#options.quarantineThreshold
            );
            if (!classification.ok) throw new Error('invalid manager failure policy');
            this.#failures.set(desired.descriptorKey, classification.failureCount);
            const delay = Math.min(
                this.#options.retryMaxMs,
                this.#options.retryBaseMs * 2 ** Math.max(0, classification.failureCount - 1)
            );
            this.#records.set(pluginId, {
                descriptor: desired,
                desired: 'active',
                status: classification.status,
                generation: pluginLease.generation,
                lifecycleCoverage: 'legacy-global-possible',
                failureCount: classification.failureCount,
                lastError: serializeError(error, 'activation'),
                nextRetryAt:
                    classification.status === 'failed' ? this.#now() + delay : undefined,
                quarantinedDescriptorKey:
                    classification.status === 'quarantined'
                        ? desired.descriptorKey
                        : undefined,
                diff,
                updatedAt: this.#now(),
            });
        }
    }

    async #stopActive(
        reconcileLease: PluginGenerationLease,
        pluginLease: PluginGenerationLease,
        active: ActiveGeneration,
        diff: BundledV1Diff
    ): Promise<boolean> {
        this.#records.set(active.descriptor.id, {
            descriptor: active.descriptor,
            desired: diff.action === 'stop' ? 'inactive' : 'active',
            status: 'stopping',
            generation: pluginLease.generation,
            lifecycleCoverage: 'legacy-global-possible',
            failureCount: 0,
            diff,
            updatedAt: this.#now(),
        });
        let report: LegacyCleanupReport;
        try {
            report = await this.#afterBoundary(
                reconcileLease,
                pluginLease,
                'stop',
                this.#boundedStop(active.instance, diff.action)
            );
        } catch (error) {
            if (error instanceof StalePluginGenerationError) throw error;
            this.#records.set(active.descriptor.id, {
                descriptor: active.descriptor,
                desired: diff.action === 'stop' ? 'inactive' : 'active',
                status: 'failed',
                generation: pluginLease.generation,
                lifecycleCoverage: 'legacy-global-possible',
                failureCount: 1,
                lastError: serializeError(error, 'stop', true, 'cleanup-failed'),
                diff,
                updatedAt: this.#now(),
            });
            return false;
        }
        if (report.errors.length || (diff.action === 'stop' && report.timedOut)) {
            this.#records.set(active.descriptor.id, {
                ...this.#records.get(active.descriptor.id)!,
                status: 'failed',
                lastError: serializeError('Workspace teardown did not complete cleanly', 'stop', false, 'cleanup-failed'),
            });
            return false;
        }
        if (report.timedOut && diff.action !== 'stop') {
            this.#records.set(active.descriptor.id, {
                descriptor: active.descriptor,
                desired: 'active',
                status: 'failed',
                generation: pluginLease.generation,
                lifecycleCoverage: 'legacy-global-possible',
                failureCount: 1,
                lastError: serializeError(
                    'Bundled plugin cleanup timed out; reload is required before replacement',
                    'stop',
                    false,
                    'unsafe-v1-replacement'
                ),
                diff,
                updatedAt: this.#now(),
            });
            return false;
        }
        this.#active.delete(active.descriptor.id);
        if (diff.action === 'stop') this.#records.delete(active.descriptor.id);
        return true;
    }

    async #boundedStop(
        instance: ManagedBundledV1Instance,
        reason: unknown
    ): Promise<LegacyCleanupReport> {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<LegacyCleanupReport>((resolve) => {
            timeoutHandle = setTimeout(
                () =>
                    resolve({
                        status: 'degraded',
                        timedOut: true,
                        invokedCount: 0,
                        settledThenableCount: 0,
                        errors: [],
                        durationMs: this.#options.cleanupTimeoutMs,
                    }),
                this.#options.cleanupTimeoutMs
            );
            if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();
        });
        try {
            return await Promise.race([
                Promise.resolve().then(() => instance.stop(reason)),
                timeout,
            ]);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        }
    }
}
