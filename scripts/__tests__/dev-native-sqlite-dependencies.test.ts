import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
