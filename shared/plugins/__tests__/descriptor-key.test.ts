import { describe, expect, it } from 'vitest';
import {
    canonicalJson,
    createDescriptorKey,
    descriptorIdentityPayload,
} from '../descriptor-key';
import type { PluginDescriptorIdentity } from '../runtime-descriptor';

function bundledIdentity(
    overrides: Partial<Extract<PluginDescriptorIdentity, { manifestVersion: 1 }>> = {}
): Extract<PluginDescriptorIdentity, { manifestVersion: 1 }> {
    return {
        id: 'example',
        version: '1.0.0',
        manifestVersion: 1,
        pluginApiVersion: '1',
        source: 'extension',
        trust: 'trusted-host',
        workspaceId: 'workspace-1',
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: ['sha256-dependency-a', 'sha256-dependency-b'],
        artifact: {
            kind: 'bundled-v1',
            hostBuildId: 'host-build-1',
            moduleKey: '/extensions/plugins/example/plugin.client.ts',
            rebuildRequired: true,
        },
        ...overrides,
    };
}

function packageIdentity(
    overrides: Partial<Extract<PluginDescriptorIdentity, { manifestVersion: 2 }>> = {}
): Extract<PluginDescriptorIdentity, { manifestVersion: 2 }> {
    return {
        id: 'package-example',
        version: '2.0.0',
        manifestVersion: 2,
        pluginApiVersion: '2',
        source: 'package',
        trust: 'isolated-server',
        workspaceId: 'workspace-1',
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: [],
        artifact: {
            kind: 'package-v2',
            packageDigest: 'sha256-package',
            clientEntry: 'client/main.js',
            serverRoutes: [{ method: 'GET', path: 'ping', handler: 'server/ping.js' }],
        },
        ...overrides,
    };
}

describe('canonicalJson', () => {
    it('sorts object keys recursively while preserving array order', () => {
        const left = { z: 1, nested: { b: true, a: 'value' }, list: [{ y: 2, x: 1 }, 'tail'] };
        const right = { list: [{ x: 1, y: 2 }, 'tail'], nested: { a: 'value', b: true }, z: 1 };

        expect(canonicalJson(left)).toBe(canonicalJson(right));
        expect(canonicalJson(left)).toBe(
            '{"list":[{"x":1,"y":2},"tail"],"nested":{"a":"value","b":true},"z":1}'
        );
        expect(canonicalJson(['a', 'b'])).not.toBe(canonicalJson(['b', 'a']));
    });

    it.each([
        ['undefined', undefined],
        ['non-finite number', Number.POSITIVE_INFINITY],
        ['bigint', 1n],
        ['date object', new Date(0)],
    ])('rejects lossy %s values', (_label, value) => {
        expect(() => canonicalJson(value)).toThrow(TypeError);
    });

    it('rejects cycles', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => canonicalJson(cyclic)).toThrow('cyclic');
    });
});

describe('createDescriptorKey', () => {
    it('hashes reordered object keys identically', async () => {
        const identity = bundledIdentity();
        const reordered = Object.fromEntries(Object.entries(identity).reverse()) as unknown as PluginDescriptorIdentity;
        await expect(createDescriptorKey(reordered)).resolves.toBe(await createDescriptorKey(identity));
    });

    it('changes for every descriptor identity boundary', async () => {
        const baseline = bundledIdentity();
        const baselineKey = await createDescriptorKey(baseline);
        const variants: PluginDescriptorIdentity[] = [
            bundledIdentity({ id: 'other' }),
            bundledIdentity({ version: '1.0.1' }),
            bundledIdentity({ pluginApiVersion: '2' }),
            bundledIdentity({ source: 'builtin' }),
            bundledIdentity({ workspaceId: 'workspace-2' }),
            bundledIdentity({ policyRevision: 'policy-2' }),
            bundledIdentity({ grantsRevision: 'grants-2' }),
            bundledIdentity({ resolvedDependencyKeys: [...baseline.resolvedDependencyKeys].reverse() }),
            bundledIdentity({
                artifact: { ...baseline.artifact, hostBuildId: 'host-build-2' },
            }),
            bundledIdentity({
                artifact: { ...baseline.artifact, moduleKey: '/extensions/plugins/example/other.client.ts' },
            }),
            packageIdentity(),
        ];

        for (const variant of variants) {
            await expect(createDescriptorKey(variant)).resolves.not.toBe(baselineKey);
        }
    });

    it('includes package digest, trust mode, and validated entrypoints', async () => {
        const baseline = packageIdentity();
        const baselineKey = await createDescriptorKey(baseline);
        const artifact = baseline.artifact;
        const variants: PluginDescriptorIdentity[] = [
            packageIdentity({ trust: 'isolated-client' }),
            packageIdentity({ artifact: { ...artifact, packageDigest: 'sha256-other-package' } }),
            packageIdentity({ artifact: { ...artifact, clientEntry: 'client/other.js' } }),
            packageIdentity({
                artifact: {
                    ...artifact,
                    serverRoutes: [{ method: 'POST', path: 'submit', handler: 'server/submit.js' }],
                },
            }),
        ];

        for (const variant of variants) {
            await expect(createDescriptorKey(variant)).resolves.not.toBe(baselineKey);
        }
        expect(baselineKey).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    it('cannot collide through delimiter-like field values', async () => {
        const left = bundledIdentity({ workspaceId: 'workspace|policy', policyRevision: 'revision' });
        const right = bundledIdentity({ workspaceId: 'workspace', policyRevision: 'policy|revision' });

        expect(canonicalJson(descriptorIdentityPayload(left))).not.toBe(
            canonicalJson(descriptorIdentityPayload(right))
        );
        await expect(createDescriptorKey(left)).resolves.not.toBe(await createDescriptorKey(right));
    });

    it('ignores properties outside the canonical descriptor projection', async () => {
        const identity = bundledIdentity();
        const withInjectedField = { ...identity, pluginPayload: { secret: 'not-identity' } };
        await expect(createDescriptorKey(withInjectedField)).resolves.toBe(
            await createDescriptorKey(identity)
        );
    });
});
