/* @vitest-environment node */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ensureExtensionsDirs, EXTENSIONS_BASE_DIR } from '../paths';
import { listInstalledExtensions, invalidateExtensionsCache } from '../extension-manager';

const PLUGIN_ID = 'test-plugin-manager';
const pluginDir = join(EXTENSIONS_BASE_DIR, 'plugins', PLUGIN_ID);
const manifestPath = join(pluginDir, 'or3.manifest.json');

async function writeManifest(
    overrides: Record<string, unknown> = {}
) {
    await ensureExtensionsDirs();
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
        manifestPath,
        JSON.stringify({
            kind: 'plugin',
            id: PLUGIN_ID,
            name: 'Test Plugin',
            version: '0.0.1',
            capabilities: [],
            ...overrides,
        }),
        'utf8'
    );
}

async function cleanup() {
    await fs.rm(pluginDir, { recursive: true, force: true });
}

	describe('extension manager cache', () => {
	    afterEach(async () => {
	        await cleanup();
	        invalidateExtensionsCache();
	    });

    it('reflects changes after cache invalidation', async () => {
        // Ensure we don't inherit cache from other tests in the same worker
        invalidateExtensionsCache();
        await writeManifest();
        const first = await listInstalledExtensions();
        expect(first.some((item) => item.id === PLUGIN_ID)).toBe(true);

        await cleanup();
        invalidateExtensionsCache();
        const second = await listInstalledExtensions();
        expect(second.some((item) => item.id === PLUGIN_ID)).toBe(false);
    });

    it('preserves runtime and access metadata from disk manifests', async () => {
        invalidateExtensionsCache();
        await writeManifest({
            access: { authRequired: true, requiredWorkspaceRoles: ['owner'] },
            runtime: {
                client: { entry: 'client/main.client.ts' },
                server: {
                    routes: [
                        {
                            method: 'GET',
                            path: 'ping',
                            handler: 'server/ping.get.js',
                        },
                    ],
                },
            },
        });

        const items = await listInstalledExtensions();
        const plugin = items.find((item) => item.id === PLUGIN_ID);
        expect(plugin?.access).toEqual({
            authRequired: true,
            requiredWorkspaceRoles: ['owner'],
        });
        expect(plugin?.runtime).toEqual({
            client: { entry: 'client/main.client.ts' },
            server: {
                routes: [
                    {
                        method: 'GET',
                        path: 'ping',
                        handler: 'server/ping.get.js',
                    },
                ],
            },
        });
    });

    it('skips invalid manifests without failing the inventory scan', async () => {
        invalidateExtensionsCache();
        await writeManifest();
        const badDir = join(EXTENSIONS_BASE_DIR, 'plugins', 'broken-plugin');
        await fs.mkdir(badDir, { recursive: true });
        await fs.writeFile(
            join(badDir, 'or3.manifest.json'),
            JSON.stringify({ kind: 'plugin', id: '!!!' }),
            'utf8'
        );

        const items = await listInstalledExtensions();
        expect(items.some((item) => item.id === PLUGIN_ID)).toBe(true);
        expect(items.some((item) => item.id === 'broken-plugin')).toBe(false);

        await fs.rm(badDir, { recursive: true, force: true });
    });
});
