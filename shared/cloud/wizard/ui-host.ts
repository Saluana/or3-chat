import { cp, mkdir, mkdtemp, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

// Copy runtime source, not target configuration, secrets, or Nuxt output. The
// separate .nuxt directory prevents Apply + Deploy from restarting its own UI.
const RUNTIME_PATHS = [
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

/** Creates a disposable wizard host with independent source and generated files. */
export async function createWizardUiHost(sourceDir: string): Promise<string> {
    const dependencies = resolve(sourceDir, 'node_modules');
    if (!(await stat(dependencies)).isDirectory()) {
        throw new Error('Install project dependencies before starting the browser wizard.');
    }
    const hostDir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-ui-'));
    try {
        for (const entry of RUNTIME_PATHS) {
            const source = resolve(sourceDir, entry);
            try {
                await stat(source);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
                throw error;
            }
            const target = resolve(hostDir, entry);
            await mkdir(dirname(target), { recursive: true });
            await cp(source, target, {
                recursive: true,
                filter: (path) => !EXCLUDED.has(basename(path)) && !basename(path).startsWith('.env'),
            });
        }
        // Link installed packages individually so Nuxt/Vite can write their
        // caches into this host without changing the target's node_modules/.cache.
        const hostDependencies = resolve(hostDir, 'node_modules');
        await mkdir(hostDependencies);
        for (const entry of await readdir(dependencies, { withFileTypes: true })) {
            if (entry.name === '.cache') continue;
            await symlink(resolve(dependencies, entry.name), resolve(hostDependencies, entry.name),
                process.platform === 'win32' && entry.isDirectory() ? 'junction' : undefined);
        }
        return hostDir;
    } catch (error) {
        await rm(hostDir, { recursive: true, force: true });
        throw error;
    }
}
