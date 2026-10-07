#!/usr/bin/env bun
import { mkdtemp, readdir, readFile, writeFile, symlink, mkdir, rm, cp, lstat, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveQualificationProvider } from './workspace-cloud-providers';

// Installed provider artifacts are the default. Development source overlays
// require an explicit flag and never produce an installed qualification receipt.
const sourceRoot = process.cwd();
const development = process.argv.includes('--development-providers');
const convexIndex = process.argv.indexOf('--convex-local');
const convex = convexIndex < 0 ? null : await Bun.file(join(process.argv[convexIndex + 1]!, 'sandbox.json')).json() as { root: string; url: string; adminKey: string };
if (convex && (!convex.root.startsWith('/private/tmp/or3-files-convex-') || new URL(convex.url).hostname !== '127.0.0.1')) {
    throw new Error('Convex qualification requires the disposable loopback sandbox.');
}
const storageProvider = process.argv.includes('--convex-storage') ? 'convex' : 'fs';
if (storageProvider === 'convex' && !convex) throw new Error('--convex-storage requires --convex-local.');
const syncPackage = await resolveQualificationProvider(sourceRoot, convex ? 'or3-provider-convex' : 'or3-provider-sqlite', development);
const storagePackage = storageProvider === 'fs' ? await resolveQualificationProvider(sourceRoot, 'or3-provider-fs', development) : syncPackage;
const providers = [syncPackage, ...(storagePackage === syncPackage ? [] : [storagePackage])];
if (convex && (convex as { provider?: typeof syncPackage }).provider?.mode !== syncPackage.mode)
    throw new Error('Convex sandbox template and app provider qualification modes must match. Recreate the sandbox in the selected mode.');
const root = await mkdtemp('/private/tmp/or3-workspace-cloud-e2e-');
async function removeOverlay() {
    // Installed extension copies have read-only directories. Never follow the
    // overlay's dependency/source symlinks when restoring deletion permissions.
    async function writableDirectories(path: string): Promise<void> {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return;
        await chmod(path, stat.mode | 0o700);
        for (const name of await readdir(path)) await writableDirectories(join(path, name));
    }
    try { await writableDirectories(root); }
    catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
    await rm(root, { recursive: true, force: true });
}
try {
    for (const name of await readdir(sourceRoot)) {
        if (name.startsWith('.') || ['node_modules', 'output', 'test-results', 'playwright-report'].includes(name)) continue;
        if (['package.json', 'nuxt.config.ts', 'config.or3.ts', 'config.or3cloud.ts', 'playwright.config.ts', 'tsconfig.json'].includes(name)) {
            let contents = await readFile(join(sourceRoot, name), 'utf8');
            if (name === 'nuxt.config.ts') {
                const allow = "allow: [resolve(__dirname, '..')]";
                if (!contents.includes(allow)) throw new Error('The disposable profile must preserve the source Vite allow tree.');
                contents = contents.replace(allow, `allow: [resolve(__dirname, '..'), ${JSON.stringify(resolve(sourceRoot, '..'))}]`);
            }
            await writeFile(join(root, name), contents);
        } else if (['scripts', 'app', 'server', 'shared', 'utils', 'plugins', 'extensions', 'official-plugins', 'modules', 'types'].includes(name)) {
            await cp(join(sourceRoot, name), join(root, name), { recursive: true });
        }
        else if (name !== 'or3.providers.generated.ts') await symlink(join(sourceRoot, name), join(root, name));
    }
    await mkdir(join(root, 'node_modules'));
    for (const name of await readdir(join(sourceRoot, 'node_modules'))) {
        // Vite writes transformed modules here. Sharing this symlink between
        // disposable servers lets one optimizer invalidate another's chunks.
        if (name === '.cache' || name === '.vite') continue;
        const provider = providers.find(pkg => pkg.name === name);
        if (provider) await cp(provider.path, join(root, 'node_modules', name), { recursive: true, dereference: true });
        else await symlink(join(sourceRoot, 'node_modules', name), join(root, 'node_modules', name));
    }
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('port probe') });
    const port = probe.port!;
    await probe.stop(true);
    await writeFile(join(root, 'profile.json'), JSON.stringify({ root, origin: `http://127.0.0.1:${port}`, syncProvider: convex ? 'convex' : 'sqlite', storageProvider, providers }));
    const watch = process.argv.includes('--watch');
    const command = watch ? ['bun', 'run', 'dev', '--host', '127.0.0.1', '--port', String(port)]
        : ['bunx', 'playwright', 'test', 'tests/e2e/or3-cloud-auth.spec.ts', '--grep', 'workspace cloud profile', '--workers=1', '--reporter=line', '--trace=on'];
    if (watch) console.log(`Disposable cloud Chrome profile: http://127.0.0.1:${port}/`);
    const child = Bun.spawn(command, {
        cwd: root, stdout: 'inherit', stderr: 'inherit', env: {
            ...process.env,
            SSR_AUTH_ENABLED: 'true', AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth',
            OR3_GUEST_ACCESS_ENABLED: 'false', OR3_AUTH_REGISTRATION_MODE: 'open', OR3_AUTH_AUTO_PROVISION: 'true',
            OR3_LOCAL_PROVIDERS: 'false', OR3_USE_LOCAL_PACKAGES: 'false',
            OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: convex ? 'convex' : 'sqlite',
            VITE_CONVEX_URL: convex?.url ?? '', CONVEX_SELF_HOSTED_ADMIN_KEY: convex?.adminKey ?? '',
            OR3_CONVEX_ALLOW_INSECURE_HTTP: convex ? 'true' : 'false',
            OR3_SQLITE_DRIVER: 'better-sqlite3', OR3_SQLITE_DB_PATH: join(root, 'sync.sqlite'),
            OR3_PLUGIN_DEV_COOKIE_SCOPE: root.split('/').at(-1),
            OR3_BASIC_AUTH_DB_PATH: join(root, 'auth.sqlite'),
            OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'workspace-e2e@example.test',
            OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableWorkspaceE2e!123',
            OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true', NUXT_PUBLIC_STORAGE_PROVIDER: storageProvider,
            OR3_STORAGE_FS_ROOT: join(root, 'storage'), OR3_STORAGE_FS_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_PRODUCTION_JOURNEY_TEST_HARNESS: process.argv.includes('--journeys') ? 'true' : 'false',
            OR3_BACKGROUND_STREAMING_ENABLED: 'false', OR3_WORKSPACE_CLOUD_E2E: 'true', OR3_WORKSPACE_CLOUD_E2E_DIR: root,
            OR3_ADMIN_DATA_DIR: join(root, 'admin'), PW_PORT: String(port), PW_SKIP_WEB_SERVER: 'false',
            OR3_ADMIN_USERNAME: 'workspace-e2e-admin', OR3_ADMIN_PASSWORD: 'DisposableAdminE2e!123',
            OPENROUTER_API_KEY: '', OR3_OPENROUTER_API_KEY: '', NUXT_OPENROUTER_API_KEY: '',
        },
    });
    process.exitCode = await child.exited;
    const output = join(sourceRoot, `output/workspace-assistant-files/review-fixes/cloud-${convex ? 'convex' : 'sqlite'}-${storageProvider}-${development ? 'development' : 'installed'}`);
    await mkdir(output, { recursive: true });
    try { await cp(join(root, 'test-results'), join(output, 'test-results'), { recursive: true }); }
    catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
    await removeOverlay();
    await writeFile(join(output, 'profile.json'), JSON.stringify({
        profile: `Basic Auth + ${convex ? 'Convex' : 'native SQLite'} + ${storageProvider} storage`,
        sourceRoot, providers, port,
        temporaryDataRemoved: true, exitCode: process.exitCode,
    }, null, 2) + '\n');
} finally {
    await removeOverlay();
}
