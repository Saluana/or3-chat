import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
 * Stop only a process group belonging to the disposable wizard instance.
 * The port is not ownership: another program may have acquired it after the
 * preflight check or after the wizard's app stopped.
 */
export function stopAppServer(port: number, instanceDir: string): void {
    const instance = realpathSync(instanceDir);
    const temp = realpathSync(tmpdir());
    if (dirname(instance) !== temp || !/^or3-wizard-instance-[a-zA-Z0-9]{6}$/.test(basename(instance))) {
        throw new Error('Refusing to stop an app without a disposable wizard instance.');
    }

    let listeners: number[];
    try {
        listeners = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }).split('\n').filter(Boolean).map(Number);
    } catch (error) {
        const failure = error as { status?: number; stderr?: string | Buffer };
        if (failure.status === 1 && !String(failure.stderr ?? '').trim()) return;
        throw new Error(`Cannot identify listeners on port ${port}; refusing cleanup.`, { cause: error });
    }
    if (listeners.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) {
        throw new Error(`Cannot identify listeners on port ${port}; refusing cleanup.`);
    }

    const processes = execFileSync('ps', ['-A', '-o', 'pid=,pgid='], { encoding: 'utf8' })
        .split('\n').map(line => line.trim().split(/\s+/).map(Number))
        .filter(([pid, group]) => Number.isSafeInteger(pid) && pid! > 0 && Number.isSafeInteger(group) && group! > 0)
        .map(([pid, group]) => ({ pid: pid!, group: group! }));
    const ownGroup = processes.find(entry => entry.pid === process.pid)?.group;
    const groups = new Set<number>();
    for (const pid of listeners) {
        const group = processes.find(process => process.pid === pid)?.group;
        if (!group || !ownGroup || group === ownGroup) {
            throw new Error(`Cannot establish listener ownership on port ${port}; refusing cleanup.`);
        }
        groups.add(group);
    }
    for (const group of groups) {
        const members = processes.filter(process => process.group === group);
        for (const member of members) {
            let cwd: string;
            try {
                const output = execFileSync('lsof', ['-a', '-p', String(member.pid), '-d', 'cwd', '-Fn'], {
                    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                });
                const path = output.split('\n').find(line => line.startsWith('n'))?.slice(1);
                if (!path) throw new Error('No working directory returned.');
                cwd = realpathSync(path);
            } catch (error) {
                throw new Error(`Cannot establish process ownership on port ${port}; refusing cleanup.`, { cause: error });
            }
            if (cwd !== instance) {
                throw new Error(`Listener on port ${port} is not owned by the disposable wizard instance; refusing cleanup.`);
            }
        }
    }
    // All groups are checked before signalling any of them. Never fall back to
    // signalling a listener whose process group could not be verified.
    for (const group of groups) {
        try { process.kill(-group, 'SIGTERM'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    }
}
