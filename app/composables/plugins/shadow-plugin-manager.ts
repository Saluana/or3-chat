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
