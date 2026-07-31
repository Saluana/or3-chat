import { describe, expect, it, vi } from 'vitest';
import type { BundledPluginCatalog } from '../bundled-plugin-catalog';
import { createDescriptorKey } from '../descriptor-key';
import { createDescriptorResolver } from '../descriptor-resolver';
import type { PluginDescriptorIdentity } from '../runtime-descriptor';

const catalog: BundledPluginCatalog = {
    schemaVersion: 1,
    marker: 'or3-bundled-plugin-catalog:v1',
    hostBuildId: 'host-build-1',
    entries: [
        {
            pluginId: 'alpha',
            clientEntry: 'plugin.client.ts',
            moduleKey: '../../extensions/plugins/alpha/plugin.client.ts',
        },
    ],
};

function identity(overrides: Partial<PluginDescriptorIdentity> = {}): PluginDescriptorIdentity {
    return {
        id: 'alpha',
        version: '1.0.0',
        manifestVersion: 1,
        pluginApiVersion: '1',
        source: 'extension',
        trust: 'trusted-host',
        workspaceId: 'workspace-1',
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: [],
        artifact: {
            kind: 'bundled-v1',
            hostBuildId: 'host-build-1',
            moduleKey: '../../extensions/plugins/alpha/plugin.client.ts',
            rebuildRequired: true,
        },
        ...overrides,
    } as PluginDescriptorIdentity;
}

async function readyEntry(overrides: Record<string, unknown> = {}) {
    const descriptorIdentity = identity();
    return {
        clientEntry: 'plugin.client.ts',
        hasServerRoutes: false,
        loadAllowed: true,
        lifecycleCoverage: 'legacy-global-possible',
        descriptorStatus: 'ready',
        descriptor: {
            ...descriptorIdentity,
            descriptorKey: await createDescriptorKey(descriptorIdentity),
        },
        ...overrides,
    };
}

async function attemptLoad(runtimeEntry: unknown, loader: (moduleKey: string) => unknown) {
    const resolution = await createDescriptorResolver(catalog).resolveBundled({
        pluginId: 'alpha',
        workspaceId: 'workspace-1',
        runtimeEntry,
    });
    if (resolution.status === 'ready') loader(resolution.descriptor.artifact.moduleKey);
    return resolution;
}

describe('DescriptorResolver', () => {
    it('returns a verified descriptor and exact catalog module key', async () => {
        const loader = vi.fn();
        const result = await attemptLoad(await readyEntry(), loader);

        expect(result.status).toBe('ready');
        expect(loader).toHaveBeenCalledOnce();
        expect(loader).toHaveBeenCalledWith(
            '../../extensions/plugins/alpha/plugin.client.ts'
        );
    });

    it.each([
        [
            'legacy envelope without a descriptor',
            async () => ({
                clientEntry: 'plugin.client.ts',
                hasServerRoutes: false,
                loadAllowed: true,
            }),
        ],
        ['malformed descriptor', () => readyEntry({ descriptor: { id: 'alpha' } })],
        [
            'access denial',
            () => readyEntry({ loadAllowed: false, loadDeniedReason: 'forbidden' }),
        ],
        [
            'rebuild-required catalog state',
            async () => ({
                ...(await readyEntry()),
                descriptorStatus: 'rebuild-required',
                descriptor: undefined,
                rebuildRequiredReason: 'not-in-host-build',
            }),
        ],
    ])('blocks %s before loader invocation', async (_label, createRuntimeEntry) => {
        const loader = vi.fn();
        const result = await attemptLoad(await createRuntimeEntry(), loader);
        expect(result.status).toBe('blocked');
        expect(loader).not.toHaveBeenCalled();
    });

    it.each([
        ['plugin-id-mismatch', { id: 'other' }],
        ['workspace-id-mismatch', { workspaceId: 'workspace-2' }],
        [
            'catalog-artifact-mismatch',
            {
                artifact: {
                    kind: 'bundled-v1',
                    hostBuildId: 'host-build-2',
                    moduleKey: '../../extensions/plugins/alpha/plugin.client.ts',
                    rebuildRequired: true,
                },
            },
        ],
    ])('blocks %s identity before loader invocation', async (code, descriptorOverrides) => {
        const descriptorIdentity = identity(descriptorOverrides as Partial<PluginDescriptorIdentity>);
        const runtimeEntry = await readyEntry({
            descriptor: {
                ...descriptorIdentity,
                descriptorKey: await createDescriptorKey(descriptorIdentity),
            },
        });
        const loader = vi.fn();
        const result = await attemptLoad(runtimeEntry, loader);
        expect(result).toMatchObject({ status: 'blocked', failure: { code } });
        expect(loader).not.toHaveBeenCalled();
    });

    it('blocks a descriptor-key mismatch before loader invocation', async () => {
        const runtimeEntry = await readyEntry();
        runtimeEntry.descriptor.descriptorKey = `sha256-${'0'.repeat(64)}`;
        const loader = vi.fn();
        const result = await attemptLoad(runtimeEntry, loader);
        expect(result).toMatchObject({
            status: 'blocked',
            failure: { code: 'descriptor-key-mismatch' },
        });
        expect(loader).not.toHaveBeenCalled();
    });
});
