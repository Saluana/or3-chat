import { ActivationTable } from '../plugins/activation-table';
import { HookRecordStore } from './hook-record-store';
import type {
    HookEngine,
    HookFn,
    HookKind,
    OnOptions,
} from './hook-engine-core';

export const HOOK_SHADOW_DIVERGENCE_CAPACITY = 256;

export interface HookPlanMetadataEntry {
    readonly pattern: string;
    readonly priority: number;
    readonly sequence: number;
}

export interface HookShadowDivergence {
    readonly kind: HookKind;
    readonly name: string;
    readonly primary: readonly HookPlanMetadataEntry[];
    readonly shadow: readonly HookPlanMetadataEntry[];
}

interface MetadataRecord extends HookPlanMetadataEntry {
    readonly kind: HookKind;
    readonly fn: HookFn;
}

interface ShadowRegistration {
    readonly kind: HookKind;
    readonly name: string;
    readonly fn: HookFn;
    readonly priority?: number;
    readonly acceptedArgs?: number;
}

function globToRegExp(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

function publicPlan(
    records: readonly MetadataRecord[],
): readonly HookPlanMetadataEntry[] {
    return Object.freeze(
        records.map(({ pattern, priority, sequence }) =>
            Object.freeze({ pattern, priority, sequence }),
        ),
    );
}

/** Registration/plan shadow that never invokes a plugin callback. */
export class HookShadowComparator {
    readonly #shadow = new HookRecordStore({
        activationTable: new ActivationTable(),
    });
    readonly #primary: MetadataRecord[] = [];
    readonly #divergences: HookShadowDivergence[] = [];
    readonly #mutateShadowRegistration?: (
        registration: ShadowRegistration,
    ) => ShadowRegistration;
    #sequence = 0;
    #comparisonCount = 0;

    constructor(
        options: {
            mutateShadowRegistration?: (
                registration: ShadowRegistration,
            ) => ShadowRegistration;
        } = {},
    ) {
        this.#mutateShadowRegistration = options.mutateShadowRegistration;
    }

    get comparisonCount(): number {
        return this.#comparisonCount;
    }

    register(input: ShadowRegistration): void {
        const priority = input.priority ?? 10;
        this.#primary.push({
            kind: input.kind,
            pattern: input.name,
            fn: input.fn,
            priority,
            sequence: ++this.#sequence,
        });
        const shadow = this.#mutateShadowRegistration?.(input) ?? input;
        this.#shadow.registerLegacy(shadow);
    }

    remove(input: {
        kind: HookKind;
        name: string;
        fn: HookFn;
        priority?: number;
    }): void {
        const matches = (record: MetadataRecord) =>
            record.kind === input.kind &&
            record.pattern === input.name &&
            record.fn === input.fn &&
            (input.priority === undefined ||
                record.priority === input.priority);
        if (input.name.includes('*')) {
            const index = this.#primary.findIndex(matches);
            if (index >= 0) this.#primary.splice(index, 1);
        } else {
            for (let index = this.#primary.length - 1; index >= 0; index--) {
                if (matches(this.#primary[index]!))
                    this.#primary.splice(index, 1);
            }
        }
        this.#shadow.removeLegacy(input);
    }

    removeAll(priority?: number): void {
        for (let index = this.#primary.length - 1; index >= 0; index--) {
            if (
                priority === undefined ||
                this.#primary[index]!.priority === priority
            ) {
                this.#primary.splice(index, 1);
            }
        }
        this.#shadow.removeAllLegacy(priority);
    }

    comparePlan(kind: HookKind, name: string): void {
        this.#comparisonCount += 1;
        const primary = this.#primary
            .filter(
                (record) =>
                    record.kind === kind &&
                    (record.pattern === name ||
                        (record.pattern.includes('*') &&
                            globToRegExp(record.pattern).test(name))),
            )
            .sort(
                (left, right) =>
                    left.priority - right.priority ||
                    left.sequence - right.sequence,
            );
        const shadow = this.#shadow.matching(kind, name).map((record) => ({
            kind: record.kind,
            pattern: record.name,
            fn: record.fn,
            priority: record.priority,
            sequence: record.sequence,
        }));
        const primaryPlan = publicPlan(primary);
        const shadowPlan = publicPlan(shadow);
        if (JSON.stringify(primaryPlan) === JSON.stringify(shadowPlan)) return;
        this.#divergences.push(
            Object.freeze({
                kind,
                name,
                primary: primaryPlan,
                shadow: shadowPlan,
            }),
        );
        if (this.#divergences.length > HOOK_SHADOW_DIVERGENCE_CAPACITY) {
            this.#divergences.splice(
                0,
                this.#divergences.length - HOOK_SHADOW_DIVERGENCE_CAPACITY,
            );
        }
    }

    inspectDivergences(): readonly HookShadowDivergence[] {
        return Object.freeze([...this.#divergences]);
    }

    dispose(): void {
        this.#shadow.dispose();
        this.#primary.length = 0;
        this.#divergences.length = 0;
    }
}

export function createHookShadowFacade(
    primary: HookEngine,
    comparator: HookShadowComparator,
    options: {
        resolveOnKind?: (
            name: string,
            explicitKind: HookKind | undefined,
        ) => HookKind;
    } = {},
): HookEngine {
    const resolveOnKind =
        options.resolveOnKind ??
        ((_name: string, explicitKind: HookKind | undefined) =>
            explicitKind ?? 'action');
    const facade: HookEngine = {
        addFilter(name, fn, priority, acceptedArgs) {
            primary.addFilter(name, fn, priority, acceptedArgs);
            comparator.register({
                kind: 'filter',
                name,
                fn,
                priority,
                acceptedArgs,
            });
        },
        removeFilter(name, fn, priority) {
            primary.removeFilter(name, fn, priority);
            comparator.remove({ kind: 'filter', name, fn, priority });
        },
        applyFilters(name, value, ...args) {
            comparator.comparePlan('filter', name);
            return primary.applyFilters(name, value, ...args);
        },
        applyFiltersSync(name, value, ...args) {
            comparator.comparePlan('filter', name);
            return primary.applyFiltersSync(name, value, ...args);
        },
        addAction(name, fn, priority, acceptedArgs) {
            primary.addAction(name, fn, priority, acceptedArgs);
            comparator.register({
                kind: 'action',
                name,
                fn,
                priority,
                acceptedArgs,
            });
        },
        removeAction(name, fn, priority) {
            primary.removeAction(name, fn, priority);
            comparator.remove({ kind: 'action', name, fn, priority });
        },
        doAction(name, ...args) {
            comparator.comparePlan('action', name);
            return primary.doAction(name, ...args);
        },
        doActionSync(name, ...args) {
            comparator.comparePlan('action', name);
            primary.doActionSync(name, ...args);
        },
        hasFilter: (name, fn) => primary.hasFilter(name, fn),
        hasAction: (name, fn) => primary.hasAction(name, fn),
        removeAllCallbacks(priority) {
            primary.removeAllCallbacks(priority);
            comparator.removeAll(priority);
        },
        currentPriority: () => primary.currentPriority(),
        onceAction(name, fn, priority) {
            let settled = false;
            const wrapper = (...args: unknown[]) => {
                if (settled) return;
                settled = true;
                facade.removeAction(name, wrapper, priority);
                return fn(...args);
            };
            facade.addAction(name, wrapper, priority);
            return () => facade.removeAction(name, wrapper, priority);
        },
        on(name, fn, onOptions?: OnOptions) {
            const kind = resolveOnKind(name, onOptions?.kind);
            if (kind === 'filter') {
                facade.addFilter(
                    name,
                    fn,
                    onOptions?.priority,
                    onOptions?.acceptedArgs,
                );
                return () => facade.removeFilter(name, fn, onOptions?.priority);
            }
            facade.addAction(
                name,
                fn,
                onOptions?.priority,
                onOptions?.acceptedArgs,
            );
            return () => facade.removeAction(name, fn, onOptions?.priority);
        },
        off: (disposer) => primary.off(disposer),
        _diagnostics: primary._diagnostics,
    };
    return facade;
}
