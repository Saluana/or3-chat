import type {
    BundledV1PluginDescriptor,
    PluginLifecycleCoverage,
} from '~~/shared/plugins/runtime-descriptor';
import type { PluginRuntimeRecord } from '~~/shared/plugins/runtime-state';

export type ShadowPluginRuntimeRecord = PluginRuntimeRecord & {
    readonly descriptor: BundledV1PluginDescriptor;
    readonly status: 'active';
    readonly desired: 'active';
    readonly loader: 'bundled-v1';
};

export type ShadowDivergenceKind =
    | 'desired-not-observed'
    | 'observed-not-desired'
    | 'identity-mismatch'
    | 'source-mismatch'
    | 'workspace-mismatch'
    | 'rebuild-required';

export interface ShadowDivergenceRecord {
    readonly sequence: number;
    readonly observedAt: number;
    readonly kind: ShadowDivergenceKind;
    readonly desiredPluginId?: string;
    readonly observedPluginId?: string;
    readonly desiredSource?: 'builtin' | 'extension' | 'package';
    readonly observedSource?: 'builtin' | 'extension';
    readonly desiredWorkspaceId?: string;
    readonly observedWorkspaceId?: string;
    readonly rebuildRequiredReason?: 'not-in-host-build' | 'entrypoint-mismatch';
}

export type ShadowDivergenceInput = Omit<
    ShadowDivergenceRecord,
    'sequence' | 'observedAt'
> & { readonly observedAt?: number };

const MAX_DIAGNOSTIC_IDENTIFIER_LENGTH = 256;

function boundedIdentifier(value: string | undefined): string | undefined {
    return value?.slice(0, MAX_DIAGNOSTIC_IDENTIFIER_LENGTH);
}

function freezeDescriptor(descriptor: BundledV1PluginDescriptor): BundledV1PluginDescriptor {
    return Object.freeze({
        ...descriptor,
        resolvedDependencyKeys: Object.freeze([...descriptor.resolvedDependencyKeys]),
        artifact: Object.freeze({ ...descriptor.artifact }),
    });
}

function freezeRecord(record: ShadowPluginRuntimeRecord): ShadowPluginRuntimeRecord {
    return Object.freeze({
        ...record,
        descriptor: freezeDescriptor(record.descriptor),
    });
}

/** Read-only observer of V1 outcomes. It owns no imports, registrations, or cleanup. */
export class ShadowPluginManager {
    private readonly records = new Map<string, ShadowPluginRuntimeRecord>();
    private readonly generations = new Map<string, number>();
    private readonly divergences: ShadowDivergenceRecord[] = [];
    private divergenceSequence = 0;

    constructor(private readonly divergenceLimit = 100) {
        if (!Number.isSafeInteger(divergenceLimit) || divergenceLimit < 1 || divergenceLimit > 1000) {
            throw new RangeError('Shadow divergence limit must be an integer from 1 to 1000');
        }
    }

    observeManagedActivation(input: {
        descriptor: BundledV1PluginDescriptor;
        lifecycleCoverage: PluginLifecycleCoverage;
        observedAt?: number;
    }): ShadowPluginRuntimeRecord {
        const current = this.records.get(input.descriptor.id);
        if (current?.descriptor.descriptorKey === input.descriptor.descriptorKey) {
            return current;
        }

        const observedAt = input.observedAt ?? Date.now();
        const generation = (this.generations.get(input.descriptor.id) ?? 0) + 1;
        this.generations.set(input.descriptor.id, generation);
        const record = freezeRecord({
            descriptor: input.descriptor,
            desired: 'active',
            status: 'active',
            generation,
            lifecycleCoverage: input.lifecycleCoverage,
            loader: 'bundled-v1',
            discoveredAt: observedAt,
            updatedAt: observedAt,
            startedAt: observedAt,
            failureCount: 0,
            contributionCount: 0,
            hookCount: 0,
        });
        this.records.set(input.descriptor.id, record);
        return record;
    }

    observeManagedStop(pluginId: string): boolean {
        return this.records.delete(pluginId);
    }

    listRecords(): readonly ShadowPluginRuntimeRecord[] {
        return Object.freeze(
            Array.from(this.records.values())
                .sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id))
                .map((record) => freezeRecord(record))
        );
    }

    listManagedPluginIds(): readonly string[] {
        return Object.freeze(this.listRecords().map((record) => record.descriptor.id));
    }

    recordDivergence(input: ShadowDivergenceInput): ShadowDivergenceRecord {
        // Construct from an explicit allowlist so plugin payloads, errors,
        // settings, and secrets cannot be retained by diagnostics.
        const record = Object.freeze({
            sequence: ++this.divergenceSequence,
            observedAt: input.observedAt ?? Date.now(),
            kind: input.kind,
            desiredPluginId: boundedIdentifier(input.desiredPluginId),
            observedPluginId: boundedIdentifier(input.observedPluginId),
            desiredSource: input.desiredSource,
            observedSource: input.observedSource,
            desiredWorkspaceId: boundedIdentifier(input.desiredWorkspaceId),
            observedWorkspaceId: boundedIdentifier(input.observedWorkspaceId),
            rebuildRequiredReason: input.rebuildRequiredReason,
        });
        this.divergences.push(record);
        if (this.divergences.length > this.divergenceLimit) {
            this.divergences.splice(0, this.divergences.length - this.divergenceLimit);
        }
        return record;
    }

    listDivergences(): readonly ShadowDivergenceRecord[] {
        return Object.freeze(this.divergences.map((record) => Object.freeze({ ...record })));
    }
}

type ShadowRuntimeGlobals = typeof globalThis & {
    __or3PluginManagerShadow?: ShadowPluginManager;
};

export function getShadowPluginManager(): ShadowPluginManager {
    const globals = globalThis as ShadowRuntimeGlobals;
    return (
        globals.__or3PluginManagerShadow ??
        (globals.__or3PluginManagerShadow = new ShadowPluginManager())
    );
}
