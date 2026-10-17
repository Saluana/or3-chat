import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/**
 * Builds the standalone setup wizard (app/wizard/index.html) with Vite once and
 * reuses it until its sources change. The output lives in the checkout's
 * node_modules/.cache, never in the target instance.
 */

// Everything the browser bundle imports, plus the dependency lockfile.
const SOURCE_PATHS = [
    'app/wizard',
    'app/theme/blank',
    'app/theme/_shared',
    'app/composables/ui',
    'app/assets/css',
    'shared/cloud',
    'app.config.ts',
    'bun.lock',
];

async function collectFiles(path: string, files: string[]): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info) return;
    if (info.isFile()) {
        files.push(path);
        return;
    }
    for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        await collectFiles(join(path, entry.name), files);
    }
}

export async function wizardUiSourceHash(repoRoot: string): Promise<string> {
    const files: string[] = [];
    for (const path of SOURCE_PATHS) await collectFiles(resolve(repoRoot, path), files);
    const hash = createHash('sha256');
    for (const file of files.sort()) {
        hash.update(relative(repoRoot, file)).update('\0').update(await readFile(file)).update('\0');
    }
    return hash.digest('hex').slice(0, 16);
}

/** app.config.ts's Nuxt UI config with the Blank theme's patch, as the app applies it. */
async function loadWizardUiConfig(repoRoot: string): Promise<Record<string, unknown>> {
    // app.config.ts calls Nuxt's `defineAppConfig` macro; outside Nuxt it is identity.
    const globals = globalThis as { defineAppConfig?: (config: unknown) => unknown };
    globals.defineAppConfig ??= (config) => config;
    const [{ default: appConfig }, { default: blankTheme }, { computeEffectiveAppConfig }] =
        await Promise.all([
            import(resolve(repoRoot, 'app.config.ts')) as Promise<{ default: Record<string, unknown> }>,
            import(resolve(repoRoot, 'app/theme/blank/theme.ts')) as Promise<{ default: { ui?: Record<string, unknown> } }>,
            import(resolve(repoRoot, 'app/theme/_shared/theme-core.ts')) as Promise<typeof import('../../../app/theme/_shared/theme-core')>,
        ]);
    const effective = computeEffectiveAppConfig(appConfig, { uiPatch: blankTheme.ui });
    return (effective.ui ?? {}) as Record<string, unknown>;
}

/** Returns a directory holding the built wizard UI (index.html and assets/). */
export async function buildWizardUi(repoRoot: string): Promise<string> {
    const cacheRoot = resolve(repoRoot, 'node_modules/.cache/or3-wizard-ui');
    const outDir = join(cacheRoot, await wizardUiSourceHash(repoRoot));
    if (await stat(join(outDir, 'index.html')).catch(() => null)) return outDir;

    const [{ build }, { default: vue }, { default: ui }] = await Promise.all([
        import('vite'),
        import('@vitejs/plugin-vue'),
        import('@nuxt/ui/vite'),
    ]);
    // Vue SFC transforms read the repo tsconfig, which references .nuxt/.
    if (!(await stat(resolve(repoRoot, '.nuxt/tsconfig.app.json')).catch(() => null))) {
        throw new Error('Run bun install (or npm install) first: setup needs the files its postinstall step prepares.');
    }
    const staging = `${outDir}.${process.pid}.tmp`;
    await build({
        configFile: false,
        root: resolve(repoRoot, 'app/wizard'),
        base: '/',
        logLevel: 'warn',
        plugins: [
            vue(),
            ui({
                router: false,
                colorMode: false,
                dts: false,
                ui: await loadWizardUiConfig(repoRoot),
                icon: { clientBundle: { scan: true } },
            }),
        ],
        resolve: {
            alias: {
                '~~': repoRoot,
                '~': resolve(repoRoot, 'app'),
            },
        },
        define: {
            'import.meta.client': 'true',
            'import.meta.server': 'false',
            'import.meta.dev': 'false',
        },
        // One local page; splitting it would not make setup faster.
        build: { outDir: staging, emptyOutDir: true, chunkSizeWarningLimit: 2048 },
    });

    // Keep only the current build; a concurrent build of the same hash is fine.
    await mkdir(cacheRoot, { recursive: true });
    for (const entry of await readdir(cacheRoot)) {
        if (join(cacheRoot, entry) !== staging) {
            await rm(join(cacheRoot, entry), { recursive: true, force: true });
        }
    }
    await rename(staging, outDir).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
        await rm(staging, { recursive: true, force: true });
    });
    return outDir;
}
