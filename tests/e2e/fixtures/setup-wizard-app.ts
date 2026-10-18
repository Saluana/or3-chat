import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

// What an OR3 checkout needs to install, prepare and start; never its
// configuration, secrets, generated files or Nuxt output.
const INSTANCE_PATHS = [
    'package.json', 'nuxt.config.ts', 'app.config.ts', 'config.or3.ts',
    'config.or3cloud.ts', 'tsconfig.json', 'types.d.ts', 'raw-assets.d.ts',
    'app', 'convex', 'extensions', 'modules', 'plugins', 'public', 'server',
    'shared', 'types', 'utils', 'packages/plugin-sdk', 'scripts/cli',
    'scripts/plugin-runtime', 'scripts/docker', 'scripts/build-theme-css.ts',
    'scripts/compile-themes.ts', 'scripts/theme-compiler.ts', 'scripts/theme-discovery.ts',
];
const EXCLUDED = new Set([
    '.git', '.data', '.nuxt', '.output', 'node_modules', 'dist', 'coverage',
    '__tests__', '__benchmarks__', '.or3-initial-credentials',
    'or3.providers.generated.json',
]);

/**
 * A disposable OR3 instance for the wizard to configure and start: a copy of
 * the checkout's source with each installed package linked, so it never
 * touches the developer's .env or Nuxt output.
 */
export async function createDisposableInstance(sourceDir: string): Promise<string> {
    const instanceDir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-instance-'));
    try {
        for (const entry of INSTANCE_PATHS) {
            const source = resolve(sourceDir, entry);
            if (!(await stat(source).catch(() => null))) continue;
            const target = resolve(instanceDir, entry);
            await mkdir(dirname(target), { recursive: true });
            await cp(source, target, {
                recursive: true,
                filter: (path) => !EXCLUDED.has(basename(path)) && !basename(path).startsWith('.env'),
            });
        }
        const dependencies = resolve(sourceDir, 'node_modules');
        await mkdir(resolve(instanceDir, 'node_modules'));
        for (const entry of await readdir(dependencies, { withFileTypes: true })) {
            if (entry.name === '.cache') continue;
            await symlink(resolve(dependencies, entry.name), resolve(instanceDir, 'node_modules', entry.name));
        }
        return instanceDir;
    } catch (error) {
        await rm(instanceDir, { recursive: true, force: true });
        throw error;
    }
}

/**
 * Stops the OR3 server the wizard started on `port`. The wizard launches it
 * detached in its own process group, so signal the whole group.
 */
export function stopAppServer(port: number): void {
    let pids: string[];
    try {
        pids = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
            .split('\n')
            .filter(Boolean);
    } catch {
        return; // nothing is listening
    }
    for (const pid of pids) {
        let group = Number(pid);
        try {
            group = Number(execFileSync('ps', ['-o', 'pgid=', '-p', pid], { encoding: 'utf8' }).trim()) || group;
        } catch {
            // Fall back to the listener itself.
        }
        try {
            process.kill(-group, 'SIGTERM');
        } catch {
            try {
                process.kill(Number(pid), 'SIGTERM');
            } catch {
                // Already gone.
            }
        }
    }
}
