import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Real CLI/subprocess boundary, with installed executables that report the
// runtime and effective environment instead of performing a Nuxt build.
describe('Nuxt task launcher', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    function launch(task = 'build', env: NodeJS.ProcessEnv = {}, signal?: string) {
        const root = mkdtempSync(join(tmpdir(), 'or3-nuxt-task-'));
        roots.push(root);
        const bin = join(root, 'bin');
        const nuxt = join(root, 'node_modules/nuxt');
        mkdirSync(bin);
        mkdirSync(join(nuxt, 'bin'), { recursive: true });
        mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
        symlinkSync(process.execPath, join(bin, 'node'));
        symlinkSync(execFileSync('bun', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim(), join(bin, 'bun'));
        writeFileSync(join(root, 'package.json'), '{}');
        writeFileSync(join(nuxt, 'package.json'), JSON.stringify({ name: 'nuxt', bin: { nuxt: './bin/nuxt.mjs' } }));
        const receipt = `console.log('RECEIPT=' + JSON.stringify({
            runtime: process.versions.bun ? 'bun' : 'node',
            nodeOptions: process.env.NODE_OPTIONS ?? '',
            ssr: process.env.SSR_AUTH_ENABLED,
            args: process.argv.slice(2),
        }));`;
        const entry = join(nuxt, 'bin/nuxt.mjs');
        writeFileSync(entry, `#!/usr/bin/env node\n${signal ? `process.kill(process.pid, ${JSON.stringify(signal)});` : receipt}`, { mode: 0o755 });
        symlinkSync(entry, join(root, 'node_modules/.bin/nuxt'));
        writeFileSync(join(root, 'node_modules/.bin/tsx'), `#!/usr/bin/env node\n${receipt}`, { mode: 0o755 });
        return spawnSync(process.execPath, [
            '--import', import.meta.resolve('tsx'), resolve('scripts/cli/nuxt-task.ts'), task,
        ], {
            cwd: root, encoding: 'utf8', timeout: 20_000,
            env: {
                PATH: bin, npm_config_user_agent: 'bun/1.3.14',
                NODE_OPTIONS: '', NODE_ENV: 'development', OR3_STRICT_CONFIG: 'false',
                SSR_AUTH_ENABLED: 'true', OR3_AUTH_PROVIDER: 'clerk',
                OR3_SYNC_PROVIDER: 'sqlite', OR3_SYNC_ENABLED: 'false',
                OR3_CLOUD_SYNC_ENABLED: 'false', OR3_SQLITE_DRIVER: 'better-sqlite3',
                ...env,
            },
        });
    }

    function receipts(result: ReturnType<typeof launch>) {
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.split('\n').filter((line) => line.startsWith('RECEIPT='))
            .map((line) => JSON.parse(line.slice('RECEIPT='.length)) as {
                runtime: string; nodeOptions: string; ssr: string; args: string[];
            });
    }

    it('defaults the build heap to 4 GiB while preserving other Node options', () => {
        const result = receipts(launch('build', { NODE_OPTIONS: '--trace-warnings' }));
        expect(result[0]?.nodeOptions).toBe('--trace-warnings --max-old-space-size=4096');
        expect(result[1]?.args).toEqual(['scripts/plugin-runtime/check-production-build.ts', '--mode', 'ssr']);
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

    it('reports a killed build and does not run output checks', () => {
        const result = launch('build', {}, 'SIGKILL');
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('SIGKILL');
        expect(result.stdout).not.toContain('check-production-build.ts');
    });
});
