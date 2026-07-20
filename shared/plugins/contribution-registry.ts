import { createRegistrationHandle, type RegistrationHandle } from './registration-handle';
import { ActivationTable, type ActivationChange } from './activation-table';

export type ContributionVisibility = 'legacy-visible' | 'managed';
export type ContributionLifecycleState =
    | 'legacy-visible'
    | 'managed-hidden'
    | 'managed-current';

export interface ContributionRecord<T, TMetadata = Readonly<Record<string, unknown>>> {
    readonly id: string;
    readonly owner: symbol;
    readonly pluginId?: string;
    readonly generation?: number;
    readonly sequence: number;
    readonly visibility: ContributionVisibility;
    readonly lifecycleState: ContributionLifecycleState;
    readonly value: T;
    readonly metadata: TMetadata;
    readonly registeredAt: number;
}

export interface StagedContribution<T, TMetadata> {
    readonly value: T;
    readonly metadata?: TMetadata;
}

export type RegistryStageResult =
    | { readonly ok: true; readonly count: number }
    | {
          readonly ok: false;
          readonly code: 'duplicate-id' | 'invalid-id' | 'owner-already-staged';
          readonly id?: string;
      };

export interface ContributionRegistryOptions<T, TContext, TMetadata> {
    readonly activationTable: ActivationTable;
    readonly getId: (value: T) => string;
    readonly normalize?: (value: T) => T;
    readonly isVisible?: (value: T, context: TContext) => boolean;
    readonly compare?: (left: T, right: T) => number;
    readonly defaultMetadata?: () => TMetadata;
    readonly now?: () => number;
}

type StoredRecord<T, TMetadata> = Omit<
    ContributionRecord<T, TMetadata>,
    'lifecycleState'
>;

const EMPTY_METADATA = Object.freeze({}) as Readonly<Record<string, unknown>>;

/** Owner-aware storage with hidden managed records and legacy-immediate records. */
export class ContributionRegistry<
    T,
    TContext = void,
    TMetadata = Readonly<Record<string, unknown>>,
> {
    readonly #activationTable: ActivationTable;
    readonly #getId: (value: T) => string;
    readonly #normalize: (value: T) => T;
    readonly #isVisible: (value: T, context: TContext) => boolean;
    readonly #compare: (left: T, right: T) => number;
    readonly #defaultMetadata: () => TMetadata;
    readonly #now: () => number;
    readonly #recordsByOwner = new Map<symbol, Map<string, StoredRecord<T, TMetadata>>>();
    readonly #legacyById = new Map<string, StoredRecord<T, TMetadata>>();
    readonly #legacyProjectionOrderById = new Map<string, number>();
    readonly #listeners = new Set<() => void>();
    readonly #unsubscribeActivation: () => void;
    #sequence = 0;
    #projectionRevision = 0;

    constructor(options: ContributionRegistryOptions<T, TContext, TMetadata>) {
        this.#activationTable = options.activationTable;
        this.#getId = options.getId;
        this.#normalize = options.normalize ?? ((value) => value);
        this.#isVisible = options.isVisible ?? (() => true);
        this.#compare = options.compare ?? (() => 0);
        this.#defaultMetadata =
            options.defaultMetadata ?? (() => EMPTY_METADATA as TMetadata);
        this.#now = options.now ?? Date.now;
        this.#unsubscribeActivation = this.#activationTable.subscribe((change) => {
            if (this.#isAffectedByActivation(change)) this.#publishProjection();
        });
    }

    get activationRevision(): number {
        return this.#activationTable.revision;
    }

    get projectionRevision(): number {
        return this.#projectionRevision;
    }

    get subscriberCount(): number {
        return this.#listeners.size;
    }

    stage(input: {
        owner: symbol;
        pluginId: string;
        generation: number;
        values: readonly StagedContribution<T, TMetadata>[];
    }): RegistryStageResult {
        const validation = this.validateStage(input);
        if (!validation.ok) return validation;
        const prepared = new Map<string, StoredRecord<T, TMetadata>>();
        for (const staged of input.values) {
            const value = this.#normalize(staged.value);
            const id = this.#getId(value);
            prepared.set(
                id,
                Object.freeze({
                    id,
                    owner: input.owner,
                    pluginId: input.pluginId,
                    generation: input.generation,
                    sequence: ++this.#sequence,
                    visibility: 'managed' as const,
                    value,
                    metadata: staged.metadata ?? this.#defaultMetadata(),
                    registeredAt: this.#now(),
                })
            );
        }
        this.#recordsByOwner.set(input.owner, prepared);
        return { ok: true, count: prepared.size };
    }

    validateStage(input: {
        owner: symbol;
        pluginId: string;
        generation: number;
        values: readonly StagedContribution<T, TMetadata>[];
    }): RegistryStageResult {
        if (this.#recordsByOwner.has(input.owner)) {
            return { ok: false, code: 'owner-already-staged' };
        }
        const ids = new Set<string>();
        for (const staged of input.values) {
            const id = this.#getId(this.#normalize(staged.value));
            if (!id) return { ok: false, code: 'invalid-id' };
            if (ids.has(id)) return { ok: false, code: 'duplicate-id', id };
            ids.add(id);
        }
        return { ok: true, count: ids.size };
    }

    registerLegacy(input: {
        value: T;
        owner?: symbol;
        metadata?: TMetadata;
    }): RegistrationHandle {
        const value = this.#normalize(input.value);
        const id = this.#getId(value);
        if (!id) throw new Error('Contribution id is required');
        const owner = input.owner ?? Symbol(`legacy:${id}`);
        const previous = this.#legacyById.get(id);
        if (previous) this.#recordsByOwner.delete(previous.owner);
        const sequence = ++this.#sequence;
        if (!this.#legacyProjectionOrderById.has(id)) {
            this.#legacyProjectionOrderById.set(id, sequence);
        }
        const record = Object.freeze({
            id,
            owner,
            sequence,
            visibility: 'legacy-visible' as const,
            value,
            metadata: input.metadata ?? this.#defaultMetadata(),
            registeredAt: this.#now(),
        });
        this.#recordsByOwner.set(owner, new Map([[id, record]]));
        this.#legacyById.set(id, record);
        this.#publishProjection();
        return createRegistrationHandle({
            id,
            owner,
            isCurrent: () => this.#legacyById.get(id)?.owner === owner,
            remove: () => {
                this.#legacyById.delete(id);
                this.#recordsByOwner.delete(owner);
                this.#publishProjection();
            },
        });
    }

    unregisterLegacy(id: string): boolean {
        return this.unregisterLegacyBatch([id]) > 0;
    }

    unregisterLegacyBatch(ids: readonly string[]): number {
        let removed = 0;
        for (const id of new Set(ids)) {
            const record = this.#legacyById.get(id);
            if (!record) continue;
            this.#legacyById.delete(id);
            this.#legacyProjectionOrderById.delete(id);
            this.#recordsByOwner.delete(record.owner);
            removed += 1;
        }
        if (removed) this.#publishProjection();
        return removed;
    }

    /** Emit a legacy compatibility projection when a V1 surface did so without a value change. */
    publishLegacyProjection(): void {
        this.#publishProjection();
    }

    listLegacyIds(): readonly string[] {
        return Object.freeze(Array.from(this.#legacyById.keys()));
    }

    removeOwner(owner: symbol): number {
        const records = this.#recordsByOwner.get(owner);
        if (!records) return 0;
        const wasVisible = Array.from(records.values()).some((record) =>
            this.#isRecordCurrent(record)
        );
        for (const record of records.values()) {
            if (record.visibility === 'legacy-visible' && this.#legacyById.get(record.id)?.owner === owner) {
                this.#legacyById.delete(record.id);
                this.#legacyProjectionOrderById.delete(record.id);
            }
        }
        this.#recordsByOwner.delete(owner);
        if (wasVisible) this.#publishProjection();
        return records.size;
    }

    get(id: string, context: TContext): T | undefined {
        return this.#visibleRecords(context).find((record) => record.id === id)?.value;
    }

    snapshot(context: TContext): readonly T[] {
        return Object.freeze(this.#visibleRecords(context).map((record) => record.value));
    }

    inspect(): readonly ContributionRecord<T, TMetadata>[] {
        const records = Array.from(this.#recordsByOwner.values()).flatMap((ownerRecords) =>
            Array.from(ownerRecords.values(), (record) =>
                Object.freeze({
                    ...record,
                    lifecycleState: this.#lifecycleState(record),
                })
            )
        );
        records.sort((left, right) => left.sequence - right.sequence);
        return Object.freeze(records);
    }

    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            this.#listeners.delete(listener);
        };
    }

    dispose(): void {
        this.#unsubscribeActivation();
        this.#listeners.clear();
    }

    #isRecordCurrent(record: StoredRecord<T, TMetadata>): boolean {
        return record.visibility === 'legacy-visible'
            ? this.#legacyById.get(record.id)?.owner === record.owner
            : Boolean(record.pluginId && this.#activationTable.isCurrent(record.pluginId, record.owner));
    }

    #lifecycleState(record: StoredRecord<T, TMetadata>): ContributionLifecycleState {
        if (record.visibility === 'legacy-visible') return 'legacy-visible';
        return this.#isRecordCurrent(record) ? 'managed-current' : 'managed-hidden';
    }

    #visibleRecords(context: TContext): StoredRecord<T, TMetadata>[] {
        const byId = new Map<string, StoredRecord<T, TMetadata>>();
        for (const ownerRecords of this.#recordsByOwner.values()) {
            for (const record of ownerRecords.values()) {
                if (!this.#isRecordCurrent(record) || !this.#isVisible(record.value, context)) continue;
                const current = byId.get(record.id);
                if (!current || current.sequence < record.sequence) byId.set(record.id, record);
            }
        }
        return Array.from(byId.values()).sort((left, right) => {
            const compared = this.#compare(left.value, right.value);
            return compared || this.#projectionOrder(left) - this.#projectionOrder(right);
        });
    }

    #projectionOrder(record: StoredRecord<T, TMetadata>): number {
        return record.visibility === 'legacy-visible'
            ? (this.#legacyProjectionOrderById.get(record.id) ?? record.sequence)
            : record.sequence;
    }

    #isAffectedByActivation(change: ActivationChange): boolean {
        const hasRecords = (owner: symbol | undefined) => {
            if (!owner) return false;
            const records = this.#recordsByOwner.get(owner);
            return Boolean(
                records && Array.from(records.values()).some((record) => record.pluginId === change.pluginId)
            );
        };
        return hasRecords(change.previous) || hasRecords(change.next);
    }

    #publishProjection(): void {
        this.#projectionRevision += 1;
        for (const listener of Array.from(this.#listeners)) listener();
    }
}
