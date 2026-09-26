import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';

let createSurfacePage: typeof import('../portable-clients.client')['createSurfacePage'];
let packageIconUrl: typeof import('../portable-clients.client')['packageIconUrl'];

beforeAll(async () => {
    vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
    ({ createSurfacePage, packageIconUrl } = await import('../portable-clients.client'));
});

function descriptor(icon = true): PackageV2PluginDescriptor {
    return {
        id: 'sample.plugin',
        version: '1.0.0',
        name: 'Sample Plugin',
        pluginApiVersion: '2.0.0',
        workspaceId: 'workspace-1',
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: [],
        descriptorKey: `sha256-${'b'.repeat(64)}`,
        manifestVersion: 2,
        source: 'package',
        trust: 'isolated-client',
        effectiveGrants: [],
        ...(icon ? { icon: { path: 'assets/icon.webp', mediaType: 'image/webp' as const } } : {}),
        artifact: {
            kind: 'package-v2',
            packageDigest: `sha256-${'a'.repeat(64)}`,
            client: {
                entry: 'client.mjs',
                isolation: 'worker',
                digest: `sha256-${'c'.repeat(64)}`,
            },
            serverRoutes: [],
        },
    };
}

describe('portable plugin icon projection', () => {
    it('resolves a declared icon through the selected digest asset route', () => {
        const source = descriptor();
        const image = packageIconUrl(source);

        expect(image).toBe(
            `/api/plugins/packages/sample.plugin/${source.artifact.packageDigest}/assets/icon.webp`
        );
        expect(createSurfacePage(source)).toMatchObject({
            icon: 'i-lucide-app-window',
            image,
        });
    });

    it('keeps the Iconify fallback when the descriptor has no image', () => {
        expect(createSurfacePage(descriptor(false))).toMatchObject({
            icon: 'i-lucide-app-window',
        });
        expect(createSurfacePage(descriptor(false))).not.toHaveProperty('image');
    });
});
