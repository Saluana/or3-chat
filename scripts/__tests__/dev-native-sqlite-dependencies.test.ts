import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareLocalProviders, resolveDevProviderModule } from '../../shared/dev/local-providers';
import {
    ensureNativeSqliteDependencies,
    isNativeAddonAbiMismatch,
    nativeSqliteDependencyTargets,
    nuxtDevEnvironment,
    usesNativeSqlite,
    type NativeSqliteDependencyTarget,
} from '../cli/dev';

const nativeAddonMismatch = new Error(
    `The module was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires
NODE_MODULE_VERSION 147.`,
);

// Exercise the real launcher and subprocess boundary without starting Nuxt or
// writing application databases. The installed CLI fixture reports its runtime.
describe('dev launcher runtime', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    async function launch(driver: string, args: string[] = [], withBun = true, auth = 'clerk') {
        const root = mkdtempSync(join(tmpdir(), 'or3-dev-runtime-'));
        roots.push(root);
        const bin = join(root, 'bin');
        const nuxt = join(root, 'node_modules/nuxt');
        mkdirSync(bin);
        mkdirSync(join(nuxt, 'bin'), { recursive: true });
        mkdirSync(join(root, 'node_modules/.bin'));
        symlinkSync(process.execPath, join(bin, 'node'));
        if (withBun) symlinkSync(execFileSync('bun', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim(), join(bin, 'bun'));
        writeFileSync(join(root, 'package.json'), '{}');
        writeFileSync(join(nuxt, 'package.json'), JSON.stringify({ name: 'nuxt', bin: { nuxt: './bin/nuxt.mjs' } }));
        const entry = join(nuxt, 'bin/nuxt.mjs');
        writeFileSync(entry, `#!/usr/bin/env node
            console.log('NUXT_RECEIPT=' + JSON.stringify({
                runtime: process.versions.bun ? 'bun' : 'node',
                args: process.argv.slice(2),
                nodeOptions: process.env.NODE_OPTIONS ?? '',
                ssr: process.env.SSR_AUTH_ENABLED,
            }));
        `, { mode: 0o755 });
        symlinkSync(entry, join(root, 'node_modules/.bin/nuxt'));
        if (auth === 'basic-auth') {
            const addon = join(root, 'node_modules/better-sqlite3');
            mkdirSync(addon);
            writeFileSync(join(addon, 'package.json'), JSON.stringify({ name: 'better-sqlite3', main: 'index.cjs' }));
            // An incompatible native dependency must fail before Nuxt starts.
            writeFileSync(join(addon, 'index.cjs'), `module.exports = class {
                constructor() { if (process.versions.bun) throw new Error('incompatible SQLite binding'); }
                close() {}
            };`);
        }
        const server = createServer();
        const port = await new Promise<number>((resolvePort, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address() as { port: number };
                server.close(() => resolvePort(address.port));
            });
        });
        return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
            resolve('scripts/cli/dev.ts'), '--or3-ssr', '--port', String(port), ...args], {
            cwd: root, encoding: 'utf8', timeout: 20_000,
            env: {
                PATH: bin, npm_config_user_agent: 'bun/1.3.14', CI: '1',
                SSR_AUTH_ENABLED: 'true', OR3_AUTH_PROVIDER: auth,
                OR3_SYNC_PROVIDER: 'sqlite', OR3_SYNC_ENABLED: 'false',
                OR3_CLOUD_SYNC_ENABLED: 'false', OR3_SQLITE_DRIVER: driver,
                NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
                OR3_LOCAL_PROVIDERS: 'false', NODE_OPTIONS: '',
            },
        });
    }

    it.each(['bun', 'bun:sqlite'])('selects Bun for %s with SQLite sync transfer disabled and no bunx', async (driver) => {
        const result = await launch(driver);
        expect(result.status, result.stderr).toBe(0);
        const receipt = JSON.parse(result.stdout.split('NUXT_RECEIPT=')[1]!);
        expect(receipt.runtime).toBe('bun');
        expect(receipt.nodeOptions).not.toContain('--localstorage-file');
        expect(receipt.args.slice(0, 2)).toEqual(['dev', '--port']);
        expect(Number(receipt.args[2])).toBeGreaterThan(0);
    });

    it('keeps the default SQLite and offline launchers under Node', async () => {
        for (const [driver, args, ssr] of [['better-sqlite3', [], 'true'], ['bun', ['--or3-offline'], 'false']] as const) {
            const result = await launch(driver, [...args]);
            expect(result.status, result.stderr).toBe(0);
            const receipt = JSON.parse(result.stdout.split('NUXT_RECEIPT=')[1]!);
            expect(receipt.runtime).toBe('node');
            expect(receipt.ssr).toBe(ssr);
        }
    });

    it('explains missing Bun before launching Nuxt', async () => {
        const result = await launch('bun', [], false);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/Bun.*OR3_SQLITE_DRIVER|OR3_SQLITE_DRIVER.*Bun/);
        expect(result.stdout).not.toContain('NUXT_RECEIPT=');
    });

    it.each(['bun', 'bun:sqlite'])('rejects Basic Auth with %s before probing its native binding', async (driver) => {
        const result = await launch(driver, [], true, 'basic-auth');
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/Basic Auth.*Node 24/);
        expect(result.stderr).not.toContain('incompatible SQLite binding');
        expect(result.stdout).not.toContain('NUXT_RECEIPT=');
    });

    it('launches Basic Auth with its default native driver under Node', async () => {
        const result = await launch('better-sqlite3', [], true, 'basic-auth');
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout.split('NUXT_RECEIPT=')[1]!).runtime).toBe('node');
    });
});

describe('native SQLite dev dependency repair', () => {
    it('gives Nuxt devtools an ignored localStorage file on modern Node', () => {
        const environment = nuxtDevEnvironment(
            { NODE_OPTIONS: '--max-old-space-size=4096' },
            '/workspace/or3-chat',
        );
        const nodeMajor = Number(process.versions.node.split('.')[0]);

        if (nodeMajor >= 22) {
            expect(environment.NODE_OPTIONS).toBe(
                '--max-old-space-size=4096 --localstorage-file=/workspace/or3-chat/.nuxt/node-localstorage',
            );
        } else {
            expect(environment.NODE_OPTIONS).toBe('--max-old-space-size=4096');
        }
    });

    it('keeps a user-provided localStorage file unchanged', () => {
        const environment = nuxtDevEnvironment(
            { NODE_OPTIONS: '--localstorage-file=/tmp/custom-storage' },
            '/workspace/or3-chat',
        );

        expect(environment.NODE_OPTIONS).toBe('--localstorage-file=/tmp/custom-storage');
    });

    it('recognizes the native addon ABI mismatch reported by Node', () => {
        expect(isNativeAddonAbiMismatch(nativeAddonMismatch)).toBe(true);
        expect(isNativeAddonAbiMismatch(new Error('Cannot find module'))).toBe(false);
    });

    it('only checks native SQLite when the active providers need it', () => {
        expect(
            usesNativeSqlite({
                SSR_AUTH_ENABLED: 'true',
                OR3_AUTH_PROVIDER: 'clerk',
                OR3_SYNC_ENABLED: 'true',
                OR3_SYNC_PROVIDER: 'sqlite',
                OR3_SQLITE_DRIVER: 'd1',
            }),
        ).toBe(false);

        const targets = nativeSqliteDependencyTargets(
            {
                SSR_AUTH_ENABLED: 'true',
                OR3_AUTH_PROVIDER: 'basic-auth',
                OR3_SYNC_ENABLED: 'true',
                OR3_SYNC_PROVIDER: 'sqlite',
            },
            '/workspace/or3-chat',
        );

        expect(targets).toEqual([
            { cwd: '/workspace/or3-chat', label: 'OR3 Chat' },
            {
                cwd: '/workspace/or3-provider-basic-auth',
                label: 'or3-provider-basic-auth',
            },
            {
                cwd: '/workspace/or3-provider-sqlite',
                label: 'or3-provider-sqlite',
            },
        ]);
    });

    it('repairs only stale bindings, then verifies the repair', async () => {
        const targets: NativeSqliteDependencyTarget[] = [
            { cwd: '/workspace/or3-chat', label: 'OR3 Chat' },
            { cwd: '/workspace/or3-provider-basic-auth', label: 'Basic Auth' },
        ];
        const stale = new Set(['/workspace/or3-chat']);
        const checks: string[] = [];
        const repairs: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await ensureNativeSqliteDependencies(targets, 'bun', {
                verify(target) {
                    checks.push(target.cwd);
                    if (stale.has(target.cwd)) throw nativeAddonMismatch;
                },
                async repair(target, packageManager) {
                    expect(packageManager).toBe('bun');
                    repairs.push(target.cwd);
                    stale.delete(target.cwd);
                },
            });
        } finally {
            log.mockRestore();
        }

        expect(repairs).toEqual(['/workspace/or3-chat']);
        expect(checks).toEqual([
            '/workspace/or3-chat',
            '/workspace/or3-provider-basic-auth',
            '/workspace/or3-chat',
        ]);
    });

    it('does not disguise other native loading failures as ABI drift', async () => {
        const repair = vi.fn();

        await expect(
            ensureNativeSqliteDependencies(
                [{ cwd: '/workspace/or3-chat', label: 'OR3 Chat' }],
                'bun',
                {
                    verify() {
                        throw new Error('Permission denied');
                    },
                    repair,
                },
            ),
        ).rejects.toThrow('Permission denied');
        expect(repair).not.toHaveBeenCalled();
    });
});


describe('local provider dev selection', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function fixture() {
        const root = mkdtempSync(join(tmpdir(), 'or3-local-providers-'));
        roots.push(root);
        const project = join(root, 'or3-chat');
        const provider = join(root, 'or3-provider-sqlite');
        mkdirSync(project);
        mkdirSync(join(provider, 'dist'), { recursive: true });
        writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: {
            'or3-provider-sqlite': '0.0.10', 'or3-provider-fs': '0.0.7',
        } }));
        writeFileSync(join(provider, 'package.json'), JSON.stringify({
            name: 'or3-provider-sqlite', version: '0.0.10',
            exports: { './nuxt': { import: './dist/module.mjs' } },
        }));
        const entry = join(provider, 'dist/module.mjs');
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        return { project, provider, entry, warning };
    }

    it('builds local packages and warns when a sibling is absent', async () => {
        const f = fixture();
        const build = vi.fn(async () => { writeFileSync(f.entry, 'export default {}'); });
        const modules = await prepareLocalProviders(f.project, {}, build);
        expect(build).toHaveBeenCalledWith(f.provider, 'or3-provider-sqlite');
        expect(modules).toEqual({ 'or3-provider-sqlite/nuxt': f.entry });
        expect(f.warning).toHaveBeenCalledWith(expect.stringContaining('or3-provider-fs: using installed package'));
        expect(resolveDevProviderModule('or3-provider-sqlite/nuxt', {
            NODE_ENV: 'development', OR3_DEV_PROVIDER_MODULES: JSON.stringify(modules),
        })).toBe(f.entry);
    });

    it('falls back after build failure even if an old dist exists', async () => {
        const f = fixture();
        writeFileSync(f.entry, 'stale build');
        expect(await prepareLocalProviders(f.project, {}, async () => { throw new Error('build failed'); })).toEqual({});
        expect(f.warning).toHaveBeenCalledWith(expect.stringContaining('build failed'));
    });

    it('does not select a stale sibling Convex version for automatic backend updates', async () => {
        const f = fixture();
        const provider = resolve(f.project, '../or3-provider-convex');
        mkdirSync(join(provider, 'dist'), { recursive: true });
        writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: 'or3-provider-convex', version: '0.0.12', exports: { './nuxt': { import: './dist/module.mjs' } } }));
        writeFileSync(join(f.project, 'package.json'), JSON.stringify({ dependencies: { 'or3-provider-convex': '0.0.13' } }));
        const build = vi.fn(async () => { writeFileSync(join(provider, 'dist/module.mjs'), 'export default {}'); });
        expect(await prepareLocalProviders(f.project, {}, build)).toEqual({});
        expect(build).not.toHaveBeenCalled();
        expect(f.warning).toHaveBeenCalledWith(expect.stringContaining('does not match'));
    });

    it('requires the scoped Basic Auth build for watched plugin development', async () => {
        const f = fixture();
        const authRoot = resolve(f.project, '../or3-provider-basic-auth');
        mkdirSync(join(authRoot, 'dist'), { recursive: true });
        writeFileSync(join(authRoot, 'package.json'), JSON.stringify({
            name: 'or3-provider-basic-auth',
            exports: { './nuxt': { import: './dist/module.mjs' } },
        }));
        writeFileSync(join(f.project, 'package.json'), JSON.stringify({ dependencies: {
            'or3-provider-basic-auth': '0.0.9', 'or3-provider-sqlite': '0.0.10',
        } }));
        const build = vi.fn(async () => {
            writeFileSync(join(authRoot, 'dist/module.mjs'), 'export default {}');
        });
        const env = { OR3_PLUGIN_WATCH_ROOT: '/plugin', OR3_LOCAL_PROVIDERS: 'true' };
        expect(await prepareLocalProviders(f.project, env, build)).toEqual({
            'or3-provider-basic-auth/nuxt': join(authRoot, 'dist/module.mjs'),
        });
        expect(build).toHaveBeenCalledExactlyOnceWith(authRoot, 'or3-provider-basic-auth');
        await expect(prepareLocalProviders(f.project, env, async () => { throw new Error('build failed'); }))
            .rejects.toThrow('Plugin development needs the local or3-provider-basic-auth source checkout');
        expect(() => resolveDevProviderModule('or3-provider-basic-auth/nuxt', {
            NODE_ENV: 'development', ...env, OR3_DEV_PROVIDER_MODULES: '{}',
        })).toThrow('requires the prepared local Basic Auth provider');
    });

    it('rejects a successful command without built output', async () => {
        const f = fixture();
        expect(await prepareLocalProviders(f.project, {}, async () => {})).toEqual({});
        expect(f.warning).toHaveBeenCalledWith(expect.stringContaining('did not produce'));
    });

    it('uses installed packages for opt-out, CI and production', async () => {
        const f = fixture();
        const build = vi.fn();
        expect(await prepareLocalProviders(f.project, { OR3_LOCAL_PROVIDERS: 'false' }, build)).toEqual({});
        expect(await prepareLocalProviders(f.project, { CI: 'true' }, build)).toEqual({});
        expect(build).not.toHaveBeenCalled();
        writeFileSync(f.entry, 'export default {}');
        expect(resolveDevProviderModule('or3-provider-sqlite/nuxt', {
            NODE_ENV: 'production', OR3_DEV_PROVIDER_MODULES: JSON.stringify({ 'or3-provider-sqlite/nuxt': f.entry }),
        })).toBe('or3-provider-sqlite/nuxt');
    });

    it('falls back if a prepared local build disappears', () => {
        const f = fixture();
        expect(resolveDevProviderModule('or3-provider-sqlite/nuxt', {
            NODE_ENV: 'development', OR3_DEV_PROVIDER_MODULES: JSON.stringify({ 'or3-provider-sqlite/nuxt': f.entry }),
        })).toBe('or3-provider-sqlite/nuxt');
        expect(f.warning).toHaveBeenCalledWith(expect.stringContaining('disappeared'));
    });
});
