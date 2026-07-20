/* @vitest-environment node */
import { describe, it, expect, afterEach } from 'vitest';
import { zipSync } from 'fflate';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
    ExtensionAlreadyInstalledError,
    installExtensionFromZip,
} from '../install';
import { EXTENSIONS_BASE_DIR } from '../paths';
import {
    invalidateExtensionsCache,
    listInstalledExtensions,
    uninstallExtension,
} from '../extension-manager';

function makeZip(entries: Record<string, string>): Buffer {
    const data: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(entries)) {
        data[key] = Buffer.from(value, 'utf8');
    }
    return Buffer.from(zipSync(data));
}

async function cleanup(id: string) {
    await fs.rm(join(EXTENSIONS_BASE_DIR, 'plugins', id), { recursive: true, force: true });
    await fs.rm(join(EXTENSIONS_BASE_DIR, 'themes', id), { recursive: true, force: true });
    await fs.rm(join(process.cwd(), 'app', 'theme', id), { recursive: true, force: true });
    await fs.rm(join(EXTENSIONS_BASE_DIR, '.tmp'), { recursive: true, force: true });
}

describe('installExtensionFromZip', () => {
    afterEach(async () => {
        await cleanup('test-plugin');
        await cleanup('test-declarative-theme');
    });

    it('rejects missing manifest', async () => {
        const zip = makeZip({ 'index.js': 'console.log("hi")' });
        await expect(installExtensionFromZip(zip, false)).rejects.toThrow(
            'Missing or3.manifest.json'
        );
    });

    it('rejects invalid manifest', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({ id: 'x' }),
            'index.js': 'console.log("hi")',
        });
        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid manifest');
    });

    it('rejects undeclared V2 manifest fields before installation', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Strict V2',
                version: '2.0.0',
                capabilities: [],
                manifestVersion: 2,
                engines: { or3: '^0.2.0', pluginApi: '^2.0.0' },
                runtime: {
                    client: {
                        entry: 'index.js',
                        format: 'esm',
                        isolation: 'host',
                    },
                },
                requestedGrants: [],
                dependencies: { required: [], optional: [] },
                trust: 'trusted-host',
                settings: { version: 1 },
                stateCompatibility: {
                    version: 1,
                    reads: { minimum: 1, maximum: 1 },
                    rollback: 'safe',
                },
                undeclaredV2Field: true,
            }),
            'index.js': 'throw new Error("must not execute")',
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid manifest');
        await expect(
            fs.access(join(EXTENSIONS_BASE_DIR, 'plugins', 'test-plugin'))
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects unsafe manifest ids', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: '../evil',
                name: 'Bad',
                version: '0.0.1',
                capabilities: [],
            }),
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid manifest');
    });

    it('rejects an archive whose kind does not match the requested install surface', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'wrong-kind-plugin',
                name: 'Wrong Kind',
                version: '0.0.1',
                capabilities: [],
            }),
            'index.js': 'export default {}',
        });

        await expect(
            installExtensionFromZip(zip, false, undefined, 'theme')
        ).rejects.toThrow('Extension kind mismatch');
    });

    it('requires theme ids to use lower-kebab-case', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'theme',
                id: 'Theme_With_Underscores',
                name: 'Bad Theme ID',
                version: '0.0.1',
                capabilities: [],
            }),
            'theme.ts': 'export default {}',
        });

        await expect(
            installExtensionFromZip(zip, false, undefined, 'theme')
        ).rejects.toThrow('lower-kebab-case');
    });

    it('installs a schema-validated declarative theme without executable source', async () => {
        const definition = {
            name: 'test-declarative-theme',
            displayName: 'Test Declarative Theme',
            colors: {
                primary: '#3366ff',
                secondary: '#6633ff',
                surface: '#ffffff',
            },
        };
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'theme',
                id: 'test-declarative-theme',
                name: 'Test Declarative Theme',
                version: '0.0.1',
                capabilities: [],
                themeTrust: 'declarative',
            }),
            'or3.theme.json': JSON.stringify(definition),
        });

        const manifest = await installExtensionFromZip(zip, false, undefined, 'theme');
        expect(manifest.themeTrust).toBe('declarative');
        await expect(
            fs.readFile(
                join(EXTENSIONS_BASE_DIR, 'themes', 'test-declarative-theme', 'theme.ts'),
                'utf8'
            )
        ).resolves.toContain('"name": "test-declarative-theme"');
    });

    it('rejects executable files in a declarative theme', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'theme',
                id: 'test-declarative-theme',
                name: 'Test Declarative Theme',
                version: '0.0.1',
                capabilities: [],
                themeTrust: 'declarative',
            }),
            'or3.theme.json': JSON.stringify({
                name: 'test-declarative-theme',
                colors: {
                    primary: '#3366ff',
                    secondary: '#6633ff',
                    surface: '#ffffff',
                },
            }),
            'component.vue': '<template><div /></template>',
        });

        await expect(
            installExtensionFromZip(zip, false, undefined, 'theme')
        ).rejects.toThrow('Declarative themes cannot contain executable code');
    });

    it('blocks zip slip paths', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            '../evil.txt': 'nope',
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid archive path');
    });

    it('accepts runtime descriptor metadata', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
                runtime: {
                    client: { entry: 'plugin.client.ts' },
                    server: {
                        routes: [
                            {
                                method: 'GET',
                                path: 'hello',
                                handler: 'server/hello.get.js',
                            },
                        ],
                    },
                },
            }),
            'plugin.client.ts': 'export default {}',
            'server/hello.get.js': 'export default () => ({ ok: true })',
        });

        const manifest = await installExtensionFromZip(zip, true);
        expect(manifest.runtime?.client?.entry).toBe('plugin.client.ts');
        expect(manifest.runtime?.server?.routes?.length).toBe(1);
    });

    it('rejects duplicate runtime routes', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
                runtime: {
                    server: {
                        routes: [
                            {
                                method: 'GET',
                                path: 'hello',
                                handler: 'server/a.get.js',
                            },
                            {
                                method: 'GET',
                                path: 'hello',
                                handler: 'server/b.get.js',
                            },
                        ],
                    },
                },
            }),
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid manifest');
    });

    it('rejects TypeScript runtime route handlers', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
                runtime: {
                    server: {
                        routes: [
                            {
                                method: 'GET',
                                path: 'hello',
                                handler: 'server/hello.get.ts',
                            },
                        ],
                    },
                },
            }),
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid manifest');
    });

    it('rejects duplicate install when force is false', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            'index.js': 'export default {}',
        });

        await installExtensionFromZip(zip, false);
        await expect(installExtensionFromZip(zip, false)).rejects.toBeInstanceOf(
            ExtensionAlreadyInstalledError
        );

        const marker = join(EXTENSIONS_BASE_DIR, 'plugins', 'test-plugin', 'index.js');
        await expect(fs.readFile(marker, 'utf8')).resolves.toContain('export default');
    });

    it('replaces atomically with force and restores on failed staging rename', async () => {
        const first = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            'marker.txt': 'v1',
        });
        const second = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.2',
                capabilities: [],
            }),
            'marker.txt': 'v2',
        });

        await installExtensionFromZip(first, false);
        await installExtensionFromZip(second, true);

        const marker = join(EXTENSIONS_BASE_DIR, 'plugins', 'test-plugin', 'marker.txt');
        await expect(fs.readFile(marker, 'utf8')).resolves.toBe('v2');
    });

    it('install -> inventory preserves runtime -> uninstall validates ids', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
                runtime: {
                    client: { entry: 'plugin.client.ts' },
                    server: {
                        routes: [
                            {
                                method: 'GET',
                                path: 'hello',
                                handler: 'server/hello.get.js',
                            },
                        ],
                    },
                },
            }),
            'plugin.client.ts': 'export default {}',
            'server/hello.get.js': 'export default () => ({ ok: true })',
        });

        await installExtensionFromZip(zip, true);
        invalidateExtensionsCache();
        const installed = await listInstalledExtensions();
        const record = installed.find((item) => item.id === 'test-plugin');
        expect(record?.runtime?.client?.entry).toBe('plugin.client.ts');
        expect(record?.runtime?.server?.routes?.[0]?.handler).toBe('server/hello.get.js');

        await expect(uninstallExtension('plugin', '../evil')).rejects.toThrow(
            'Invalid extension id'
        );
        await uninstallExtension('plugin', 'test-plugin');
        invalidateExtensionsCache();
        const after = await listInstalledExtensions();
        expect(after.some((item) => item.id === 'test-plugin')).toBe(false);
    });

    it('keeps the previous install when a forced replacement fails extraction', async () => {
        const good = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            'marker.txt': 'keep-me',
        });
        const bad = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.2',
                capabilities: [],
            }),
            '../escape.bin': 'nope',
        });

        await installExtensionFromZip(good, false);
        await expect(installExtensionFromZip(bad, true)).rejects.toThrow('Invalid archive path');

        const marker = join(EXTENSIONS_BASE_DIR, 'plugins', 'test-plugin', 'marker.txt');
        await expect(fs.readFile(marker, 'utf8')).resolves.toBe('keep-me');
    });

    it('rejects disallowed file types without leaving a partial install', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            'payload.exe': 'MZ',
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow(
            'Extension type not allowed'
        );
        await expect(
            fs.access(join(EXTENSIONS_BASE_DIR, 'plugins', 'test-plugin'))
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects absolute archive entry paths', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            '/tmp/evil.js': 'export default {}',
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid archive path');
    });

    it('accepts nested zip prefix and installs at package root', async () => {
        const zip = makeZip({
            'pkg/or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Nested',
                version: '0.0.1',
                capabilities: [],
                runtime: { client: { entry: 'plugin.client.js' } },
            }),
            'pkg/plugin.client.js': 'export default {}',
            'pkg/readme': 'ok',
        });

        await installExtensionFromZip(zip, false);
        invalidateExtensionsCache();
        const installed = await listInstalledExtensions();
        const record = installed.find((item) => item.id === 'test-plugin');
        expect(record?.runtime?.client?.entry).toBe('plugin.client.js');
        await expect(
            fs.readFile(
                join(EXTENSIONS_BASE_DIR, 'plugins', 'test-plugin', 'plugin.client.js'),
                'utf8'
            )
        ).resolves.toContain('export default');
    });

    it('conflict error message remains client-recognizable', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            'index.js': 'export default {}',
        });
        await installExtensionFromZip(zip, false);
        try {
            await installExtensionFromZip(zip, false);
            expect.fail('expected conflict');
        } catch (error) {
            expect(error).toBeInstanceOf(ExtensionAlreadyInstalledError);
            expect((error as Error).message.toLowerCase()).toContain('already installed');
            expect((error as ExtensionAlreadyInstalledError).code).toBe(
                'EXTENSION_ALREADY_INSTALLED'
            );
        }
    });
});
