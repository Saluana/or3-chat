import { ActivationTable } from "../plugins/activation-table";
import type { HookFn, HookKind } from "./hook-engine-core";

export type HookRecordVisibility = "legacy-visible" | "managed";
export type HookRecordLifecycleState =
  | "legacy-visible"
  | "managed-hidden"
  | "managed-current";

export interface HookRecord<F extends HookFn = HookFn> {
  readonly kind: HookKind;
  readonly name: string;
  readonly fn: F;
  readonly priority: number;
  readonly acceptedArgs?: number;
  readonly sequence: number;
  readonly owner: symbol;
  readonly pluginId?: string;
  readonly generation?: number;
  readonly visibility: HookRecordVisibility;
  readonly lifecycleState: HookRecordLifecycleState;
}

export interface LegacyHookRegistration<F extends HookFn = HookFn> {
  readonly kind: HookKind;
  readonly name: string;
  readonly fn: F;
  readonly priority?: number;
  readonly acceptedArgs?: number;
  readonly owner?: symbol;
}

export interface ManagedHookRegistration<
  F extends HookFn = HookFn,
> extends Omit<LegacyHookRegistration<F>, "owner"> {
  readonly owner: symbol;
  readonly pluginId: string;
  readonly generation: number;
}

type StoredHookRecord = Omit<HookRecord, "lifecycleState"> & {
  readonly matcher?: RegExp;
};

type KindBuckets = {
  readonly exact: Map<string, StoredHookRecord[]>;
  readonly wildcards: StoredHookRecord[];
};

const DEFAULT_PRIORITY = 10;

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function compareRecords(
  left: StoredHookRecord,
  right: StoredHookRecord,
): number {
  return left.priority - right.priority || left.sequence - right.sequence;
}

function insertSorted(
  records: StoredHookRecord[],
  record: StoredHookRecord,
): void {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareRecords(records[middle]!, record) <= 0) low = middle + 1;
    else high = middle;
  }
  records.splice(low, 0, record);
}

function createBuckets(): KindBuckets {
  return { exact: new Map(), wildcards: [] };
}

/**
 * Owner-aware hook storage. Legacy records are immediately visible; managed
 * records become visible only while their owner is current in ActivationTable.
 */
export class HookRecordStore {
  readonly #activationTable: ActivationTable;
  readonly #buckets: Record<HookKind, KindBuckets> = {
    action: createBuckets(),
    filter: createBuckets(),
  };
  readonly #recordsByOwner = new Map<symbol, Set<StoredHookRecord>>();
  #sequence = 0;

  constructor(options: { activationTable: ActivationTable }) {
    this.#activationTable = options.activationTable;
  }

  registerLegacy<F extends HookFn>(
    input: LegacyHookRegistration<F>,
  ): HookRecord<F> {
    const owner =
      input.owner ?? Symbol(`legacy-hook:${input.kind}:${input.name}`);
    return this.#insert({
      ...input,
      owner,
      visibility: "legacy-visible",
    }) as HookRecord<F>;
  }

  registerManaged<F extends HookFn>(
    input: ManagedHookRegistration<F>,
  ): HookRecord<F> {
    return this.#insert({
      ...input,
      visibility: "managed",
    }) as HookRecord<F>;
  }

  matching(kind: HookKind, name: string): readonly HookRecord[] {
    const buckets = this.#buckets[kind];
    const matches = (buckets.exact.get(name) ?? []).filter((record) =>
      this.#isVisible(record),
    );
    for (const record of buckets.wildcards) {
      if (record.matcher!.test(name) && this.#isVisible(record))
        matches.push(record);
    }
    matches.sort(compareRecords);
    return Object.freeze(matches.map((record) => this.#publicRecord(record)));
  }

  removeLegacy(input: {
    kind: HookKind;
    name: string;
    fn: HookFn;
    priority?: number;
  }): number {
    const buckets = this.#buckets[input.kind];
    const matches = (record: StoredHookRecord) =>
      record.visibility === "legacy-visible" &&
      record.name === input.name &&
      record.fn === input.fn &&
      (input.priority === undefined || record.priority === input.priority);

    if (input.name.includes("*")) {
      let candidate: StoredHookRecord | undefined;
      for (const record of buckets.wildcards) {
        if (!matches(record)) continue;
        if (!candidate || record.sequence < candidate.sequence)
          candidate = record;
      }
      if (!candidate) return 0;
      this.#removeRecord(candidate);
      return 1;
    }

    const records = buckets.exact.get(input.name) ?? [];
    const removing = records.filter(matches);
    for (const record of removing) this.#removeRecord(record);
    return removing.length;
  }

  removeOwner(owner: symbol): number {
    const records = this.#recordsByOwner.get(owner);
    if (!records) return 0;
    const removing = Array.from(records);
    for (const record of removing) this.#removeRecord(record);
    return removing.length;
  }

  count(kind?: HookKind): number {
    const countBuckets = (buckets: KindBuckets) =>
      Array.from(buckets.exact.values()).reduce(
        (total, records) => total + records.length,
        0,
      ) + buckets.wildcards.length;
    return kind
      ? countBuckets(this.#buckets[kind])
      : countBuckets(this.#buckets.action) + countBuckets(this.#buckets.filter);
  }

  inspect(): readonly HookRecord[] {
    const records = Array.from(this.#recordsByOwner.values()).flatMap((owned) =>
      Array.from(owned),
    );
    records.sort((left, right) => left.sequence - right.sequence);
    return Object.freeze(records.map((record) => this.#publicRecord(record)));
  }

  #insert(input: {
    kind: HookKind;
    name: string;
    fn: HookFn;
    priority?: number;
    acceptedArgs?: number;
    owner: symbol;
    pluginId?: string;
    generation?: number;
    visibility: HookRecordVisibility;
  }): HookRecord {
    const record = Object.freeze({
      kind: input.kind,
      name: input.name,
      fn: input.fn,
      priority: input.priority ?? DEFAULT_PRIORITY,
      acceptedArgs: input.acceptedArgs,
      sequence: ++this.#sequence,
      owner: input.owner,
      pluginId: input.pluginId,
      generation: input.generation,
      visibility: input.visibility,
      matcher: input.name.includes("*") ? globToRegExp(input.name) : undefined,
    });
    const buckets = this.#buckets[input.kind];
    if (record.matcher) {
      insertSorted(buckets.wildcards, record);
    } else {
      const records = buckets.exact.get(input.name) ?? [];
      insertSorted(records, record);
      buckets.exact.set(input.name, records);
    }
    const owned = this.#recordsByOwner.get(input.owner) ?? new Set();
    owned.add(record);
    this.#recordsByOwner.set(input.owner, owned);
    return this.#publicRecord(record);
  }

  #removeRecord(record: StoredHookRecord): void {
    const buckets = this.#buckets[record.kind];
    const records = record.matcher
      ? buckets.wildcards
      : buckets.exact.get(record.name);
    if (records) {
      const index = records.indexOf(record);
      if (index >= 0) records.splice(index, 1);
      if (!record.matcher && records.length === 0)
        buckets.exact.delete(record.name);
    }
    const owned = this.#recordsByOwner.get(record.owner);
    owned?.delete(record);
    if (owned?.size === 0) this.#recordsByOwner.delete(record.owner);
  }

  #isVisible(record: StoredHookRecord): boolean {
    return record.visibility === "legacy-visible"
      ? true
      : Boolean(
          record.pluginId &&
          this.#activationTable.isCurrent(record.pluginId, record.owner),
        );
  }

  #publicRecord(record: StoredHookRecord): HookRecord {
    const { matcher: _matcher, ...snapshot } = record;
    return Object.freeze({
      ...snapshot,
      lifecycleState:
        record.visibility === "legacy-visible"
          ? "legacy-visible"
          : this.#isVisible(record)
            ? "managed-current"
            : "managed-hidden",
    });
  }
}
