/* @vitest-environment node */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ensureExtensionsDirs, EXTENSIONS_BASE_DIR } from '../paths';
import { listInstalledExtensions, invalidateExtensionsCache } from '../extension-manager';

const pluginDir = join(EXTENSIONS_BASE_DIR, 'plugins', 'test-plugin');
const manifestPath = join(pluginDir, 'or3.manifest.json');

async function writeManifest() {
    await ensureExtensionsDirs();
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
        manifestPath,
        JSON.stringify({
            kind: 'plugin',
            id: 'test-plugin',
            name: 'Test Plugin',
            version: '0.0.1',
            capabilities: [],
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
        await writeManifest();
        const first = await listInstalledExtensions();
        expect(first.some((item) => item.id === 'test-plugin')).toBe(true);

        await cleanup();
        invalidateExtensionsCache();
        const second = await listInstalledExtensions();
        expect(second.some((item) => item.id === 'test-plugin')).toBe(false);
    });
});
