/* @vitest-environment node */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ExtensionIdSchema } from '../types';
import {
    invalidateExtensionsCache,
    listInstalledExtensions,
    uninstallExtension,
} from '../extension-manager';
import { ensureExtensionsDirs, EXTENSIONS_BASE_DIR } from '../paths';

const PLUGIN_ID = 'uninstall-security-plugin';
const pluginDir = join(EXTENSIONS_BASE_DIR, 'plugins', PLUGIN_ID);

async function seedPlugin() {
    await ensureExtensionsDirs();
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
        join(pluginDir, 'or3.manifest.json'),
        JSON.stringify({
            kind: 'plugin',
            id: PLUGIN_ID,
            name: 'Uninstall Security',
            version: '0.0.1',
            capabilities: [],
            runtime: { client: { entry: 'plugin.client.js' } },
        }),
        'utf8'
    );
    await fs.writeFile(join(pluginDir, 'plugin.client.js'), 'export default {}', 'utf8');
    invalidateExtensionsCache();
}

async function cleanup() {
    await fs.rm(pluginDir, { recursive: true, force: true });
    invalidateExtensionsCache();
}

describe('uninstallExtension security edges', () => {
    afterEach(async () => {
        await cleanup();
    });

    it('rejects traversal-like and empty ids via ExtensionIdSchema', () => {
        for (const id of ['../evil', '..', 'evil/../x', 'a/b', '', 'with space', 'id;rm']) {
            expect(ExtensionIdSchema.safeParse(id).success).toBe(false);
        }
        expect(ExtensionIdSchema.safeParse('ok.plugin_1-2').success).toBe(true);
    });

    it('rejects traversal ids before deleting anything', async () => {
        await seedPlugin();
        const before = await listInstalledExtensions();
        expect(before.some((item) => item.id === PLUGIN_ID)).toBe(true);

        await expect(uninstallExtension('plugin', '../evil')).rejects.toThrow(
            'Invalid extension id'
        );
        await expect(uninstallExtension('plugin', '..')).rejects.toThrow(
            'Invalid extension id'
        );
        await expect(uninstallExtension('plugin', 'evil/nested')).rejects.toThrow(
            'Invalid extension id'
        );

        invalidateExtensionsCache();
        const after = await listInstalledExtensions();
        expect(after.some((item) => item.id === PLUGIN_ID)).toBe(true);
        await expect(fs.access(pluginDir)).resolves.toBeUndefined();
    });

    it('rejects missing extension with a clear error', async () => {
        await ensureExtensionsDirs();
        await expect(uninstallExtension('plugin', 'does-not-exist')).rejects.toThrow(
            'Extension not found'
        );
    });

    it('removes a valid plugin and preserves sibling plugins', async () => {
        await seedPlugin();
        const siblingId = 'uninstall-security-sibling';
        const siblingDir = join(EXTENSIONS_BASE_DIR, 'plugins', siblingId);
        await fs.mkdir(siblingDir, { recursive: true });
        await fs.writeFile(
            join(siblingDir, 'or3.manifest.json'),
            JSON.stringify({
                kind: 'plugin',
                id: siblingId,
                name: 'Sibling',
                version: '0.0.1',
                capabilities: [],
            }),
            'utf8'
        );
        invalidateExtensionsCache();

        await uninstallExtension('plugin', PLUGIN_ID);
        invalidateExtensionsCache();

        const installed = await listInstalledExtensions();
        expect(installed.some((item) => item.id === PLUGIN_ID)).toBe(false);
        expect(installed.some((item) => item.id === siblingId)).toBe(true);

        await fs.rm(siblingDir, { recursive: true, force: true });
    });

    it('refuses to delete a directory whose manifest identity does not match', async () => {
        await seedPlugin();
        await fs.writeFile(
            join(pluginDir, 'or3.manifest.json'),
            JSON.stringify({
                kind: 'plugin',
                id: 'different-plugin',
                name: 'Mismatch',
                version: '0.0.1',
                capabilities: [],
            }),
            'utf8'
        );

        await expect(uninstallExtension('plugin', PLUGIN_ID)).rejects.toThrow(
            'Extension identity mismatch'
        );
        await expect(fs.access(pluginDir)).resolves.toBeUndefined();
    });
});
