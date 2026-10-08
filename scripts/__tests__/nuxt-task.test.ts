import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

// Real CLI/subprocess boundary, with installed executables that report the
// runtime and effective environment instead of performing a Nuxt build.
describe('Nuxt task launcher', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    function launch(
        task = 'build', env: NodeJS.ProcessEnv = {}, signal?: string,
        options: {
            envFile?: Record<string, string>;
            entry?: 'node' | 'npm' | 'bun';
            explicitEnv?: NodeJS.ProcessEnv;
            providerExitCode?: number;
            args?: string[];
        } = {},
    ) {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'or3-nuxt-task-')));
        roots.push(root);
        const bin = join(root, 'bin');
        const nuxt = join(root, 'node_modules/nuxt');
        mkdirSync(bin);
        mkdirSync(join(nuxt, 'bin'), { recursive: true });
        mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
        symlinkSync(process.execPath, join(bin, 'node'));
        symlinkSync(execFileSync('bun', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim(), join(bin, 'bun'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({
            type: 'module', scripts: { build: 'tsx scripts/cli/nuxt-task.ts build' },
        }));
        mkdirSync(join(root, 'scripts/cli'), { recursive: true });
        const launcher = join(root, 'scripts/cli/nuxt-task.ts');
        writeFileSync(launcher, readFileSync(resolve('scripts/cli/nuxt-task.ts')));
        symlinkSync(resolve('shared'), join(root, 'shared'));
        for (const dependency of ['cross-spawn', 'dotenv', 'tsx']) {
            symlinkSync(resolve('node_modules', dependency), join(root, 'node_modules', dependency));
        }
        if (options.providerExitCode !== undefined) {
            const provider = join(root, 'node_modules/or3-provider-convex');
            mkdirSync(join(provider, 'dist'), { recursive: true });
            mkdirSync(join(provider, 'scripts'), { recursive: true });
            writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: 'or3-provider-convex', exports: { './nuxt': { import: './dist/module.mjs' } } }));
            writeFileSync(join(provider, 'dist/module.mjs'), 'export default {};');
            writeFileSync(join(provider, 'scripts/init.mjs'), `console.log('BACKEND_CHECK=' + process.argv.slice(2).join(' ')); process.exit(${options.providerExitCode});`);
        }
        if (options.envFile) {
            writeFileSync(join(root, '.env'), Object.entries(options.envFile)
                .map(([key, value]) => `${key}=${value}`).join('\n'));
        }
        writeFileSync(join(nuxt, 'package.json'), JSON.stringify({ name: 'nuxt', bin: { nuxt: './bin/nuxt.mjs' } }));
        const receipt = `console.log('RECEIPT=' + JSON.stringify({
            runtime: process.versions.bun ? 'bun' : 'node',
            nodeOptions: process.env.NODE_OPTIONS ?? '',
            ssr: process.env.SSR_AUTH_ENABLED,
            auth: process.env.OR3_AUTH_PROVIDER,
            driver: process.env.OR3_SQLITE_DRIVER,
            args: process.argv.slice(2),
        }));`;
        const entry = join(nuxt, 'bin/nuxt.mjs');
        writeFileSync(entry, `#!/usr/bin/env node\n${signal ? `process.kill(process.pid, ${JSON.stringify(signal)});` : receipt}`, { mode: 0o755 });
        symlinkSync(entry, join(root, 'node_modules/.bin/nuxt'));
        symlinkSync(resolve('node_modules/tsx/dist/cli.mjs'), join(root, 'node_modules/.bin/tsx'));
        mkdirSync(join(root, 'scripts/plugin-runtime'), { recursive: true });
        writeFileSync(join(root, 'scripts/plugin-runtime/check-production-build.ts'), receipt);
        let command = process.execPath;
        let args = ['--import', import.meta.resolve('tsx'), launcher, task, ...(options.args ?? [])];
        if (options.entry === 'npm' || options.entry === 'bun') {
            command = options.entry;
            args = ['run', 'build'];
        } else if (options.explicitEnv) {
            const caller = join(root, 'call-task.mts');
            writeFileSync(caller, `
                import { runNuxtTask } from ${JSON.stringify(launcher)};
                const inheritedBefore = JSON.stringify(process.env);
                const env = { ...process.env, ...${JSON.stringify(options.explicitEnv)} };
                const passedBefore = JSON.stringify(env);
                await runNuxtTask(${JSON.stringify(task)}, env);
                console.log('ENV_UNCHANGED=' + (inheritedBefore === JSON.stringify(process.env)));
                console.log('PASSED_ENV_UNCHANGED=' + (passedBefore === JSON.stringify(env)));
            `);
            args = ['--import', import.meta.resolve('tsx'), caller];
        }
        return spawnSync(command, args, {
            cwd: root, encoding: 'utf8', timeout: 20_000,
            env: {
                PATH: [bin, process.env.PATH].join(delimiter),
                npm_config_user_agent: 'bun/1.3.14', npm_config_cache: join(root, 'npm-cache'),
                NODE_ENV: 'development', OR3_STRICT_CONFIG: 'false',
                ...(!options.envFile && {
                    NODE_OPTIONS: '', SSR_AUTH_ENABLED: 'true', OR3_AUTH_PROVIDER: 'clerk',
                    OR3_SYNC_PROVIDER: 'sqlite', OR3_SYNC_ENABLED: 'false',
                    OR3_CLOUD_SYNC_ENABLED: 'false', OR3_SQLITE_DRIVER: 'better-sqlite3',
                    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
                }),
                ...env,
            },
        });
    }

    function receipts(result: ReturnType<typeof launch>) {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('RECEIPT=');
        return result.stdout.split('\n').filter((line) => line.startsWith('RECEIPT='))
            .map((line) => JSON.parse(line.slice('RECEIPT='.length)) as {
                runtime: string; nodeOptions: string; ssr?: string; auth?: string;
                driver?: string; args: string[];
            });
    }

    it('checks the selected installed Convex backend before production preview', () => {
        const result = launch('preview', {}, undefined, { envFile: { SSR_AUTH_ENABLED: 'true', OR3_SYNC_PROVIDER: 'convex', VITE_CONVEX_URL: 'https://preview.example.test' }, providerExitCode: 0, args: ['--port', '4173'] });
        const rows = receipts(result);
        expect(result.stdout).toContain('BACKEND_CHECK=deploy');
        expect(result.stdout.indexOf('BACKEND_CHECK=')).toBeLessThan(result.stdout.indexOf('RECEIPT='));
        expect(rows[0]?.args).toEqual(['preview', '--port', '4173']);
    });

    it('does not start preview when backend deployment or verification fails', () => {
        const result = launch('preview', { SSR_AUTH_ENABLED: 'true', OR3_SYNC_PROVIDER: 'convex' }, undefined, { providerExitCode: 1 });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('BACKEND_CHECK=deploy');
        expect(result.stdout).not.toContain('RECEIPT=');
    });

    it('updates an enabled direct Convex sync backend without SSR auth', () => {
        const result = launch('preview', { SSR_AUTH_ENABLED: 'false', OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'convex' }, undefined, { providerExitCode: 0 });
        receipts(result);
        expect(result.stdout).toContain('BACKEND_CHECK=deploy');
    });

    it('updates Convex storage enabled by default with SQLite sync', () => {
        const result = launch('preview', { SSR_AUTH_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: 'convex' }, undefined, { providerExitCode: 0 });
        receipts(result);
        expect(result.stdout).toContain('BACKEND_CHECK=deploy');
    });

    it('builds Convex source without invoking remote deployment', () => {
        const result = launch('build', { SSR_AUTH_ENABLED: 'true', OR3_SYNC_PROVIDER: 'convex' }, undefined, { providerExitCode: 1 });
        receipts(result);
        expect(result.stdout).not.toContain('BACKEND_CHECK=');
    });

    it('starts SQLite preview without a Convex package', () => {
        expect(receipts(launch('preview'))[0]?.args).toEqual(['preview']);
    });

    it('starts the setup wizard before a Convex deployment is configured', () => {
        expect(receipts(launch('preview', { OR3_WIZARD_UI_ENABLED: 'true', OR3_SYNC_PROVIDER: 'convex' }))[0]?.args).toEqual(['preview']);
    });

    it('defaults the build heap to 4 GiB while preserving other Node options', () => {
        const result = receipts(launch('build', { NODE_OPTIONS: '--trace-warnings' }));
        expect(result[0]?.nodeOptions).toBe('--trace-warnings --max-old-space-size=4096');
        expect(result[1]?.args).toEqual(['--mode', 'ssr']);
    });

    it.each([
        '--max-old-space-size=1536',
        '--max_old_space_size=1536',
        '"--max-old-space-size=1536" --trace-warnings',
        '--max-old-space-size="1536"',
        '--max-old-space-size-percentage=10',
        '--max-old-space-size-percentage 10',
        '--max_old_space_size_percentage=10',
    ])('preserves the explicit heap limit in NODE_OPTIONS=%s', (nodeOptions) => {
        const result = receipts(launch('build', { NODE_OPTIONS: nodeOptions }));
        expect(result[0]?.nodeOptions).toBe(nodeOptions);
        expect(result[1]?.nodeOptions).toBe(nodeOptions);
    });

    it.each([
        ['build', 'clerk', 'bun', 'bun', 'true'],
        ['build', 'clerk', 'bun:sqlite', 'bun', 'true'],
        ['build', 'basic-auth', 'better-sqlite3', 'node', 'true'],
        ['build', 'basic-auth', 'turso', 'node', 'true'],
        ['generate-static', 'basic-auth', 'bun', 'node', 'false'],
        ['type-check', 'clerk', 'bun', 'node', 'true'],
    ])('runs %s for %s / %s with the required runtime', (task, auth, driver, runtime, ssr) => {
        const result = receipts(launch(task, { OR3_AUTH_PROVIDER: auth, OR3_SQLITE_DRIVER: driver }));
        expect(result[0]?.runtime).toBe(runtime);
        expect(result[0]?.ssr).toBe(ssr);
    });

    const bunEnvFile = {
        SSR_AUTH_ENABLED: 'true', OR3_AUTH_PROVIDER: 'clerk',
        OR3_SYNC_PROVIDER: 'sqlite', OR3_SYNC_ENABLED: 'false',
        OR3_CLOUD_SYNC_ENABLED: 'false', OR3_SQLITE_DRIVER: 'bun',
        NODE_OPTIONS: '--max-old-space-size=1536',
    };

    it.each([
        ['node', 'basic-auth', 'better-sqlite3', 'node'],
        ['node', 'clerk', 'bun', 'bun'],
        ['npm', 'basic-auth', 'better-sqlite3', 'node'],
        ['npm', 'clerk', 'bun', 'bun'],
        ['bun', 'basic-auth', 'better-sqlite3', 'node'],
        ['bun', 'clerk', 'bun', 'bun'],
    ] as const)('loads .env-only %s builds for %s / %s', (entry, auth, driver, runtime) => {
        const result = receipts(launch('build', {}, undefined, {
            entry, envFile: { ...bunEnvFile, OR3_AUTH_PROVIDER: auth, OR3_SQLITE_DRIVER: driver },
        }));
        expect(result[0]).toMatchObject({
            runtime, auth, driver, ssr: 'true', nodeOptions: '--max-old-space-size=1536',
        });
        expect(result[1]?.nodeOptions).toBe('--max-old-space-size=1536');
    });

    it('preserves inherited environment values over .env defaults', () => {
        const result = receipts(launch('build', {
            SSR_AUTH_ENABLED: 'false', OR3_SQLITE_DRIVER: 'better-sqlite3',
            NODE_OPTIONS: '--max-old-space-size=2048',
        }, undefined, { envFile: bunEnvFile }));
        expect(result[0]).toMatchObject({
            runtime: 'node', ssr: 'false', auth: 'clerk', driver: 'better-sqlite3',
            nodeOptions: '--max-old-space-size=2048',
        });
    });

    it.each([
        ['generate-static', 'true', 'false', 'generate'],
        ['type-check', 'false', 'true', 'typecheck'],
    ])('keeps %s overrides after loading .env', (task, fileSsr, ssr, argument) => {
        const result = receipts(launch(task, {}, undefined, {
            envFile: { ...bunEnvFile, SSR_AUTH_ENABLED: fileSsr },
        }));
        expect(result[0]).toMatchObject({ runtime: 'node', ssr, driver: 'bun', args: [argument] });
    });

    it('keeps explicit environment maps isolated from .env and does not mutate callers', () => {
        const launched = launch('build', {}, undefined, {
            envFile: bunEnvFile, explicitEnv: { OR3_SQLITE_DRIVER: 'better-sqlite3' },
        });
        const result = receipts(launched);
        expect(result[0]).toMatchObject({
            runtime: 'node', driver: 'better-sqlite3', nodeOptions: '--max-old-space-size=4096',
        });
        expect(result[0]?.ssr).toBeUndefined();
        expect(result[0]?.auth).toBeUndefined();
        expect(launched.stdout).toContain('ENV_UNCHANGED=true');
        expect(launched.stdout).toContain('PASSED_ENV_UNCHANGED=true');
    });

    it('reports a killed build and does not run output checks', () => {
        const result = launch('build', {}, 'SIGKILL');
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('SIGKILL');
        expect(result.stdout).not.toContain('RECEIPT=');
    });
});
