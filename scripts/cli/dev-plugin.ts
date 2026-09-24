#!/usr/bin/env node
/**
 * @module scripts/cli/dev-plugin
 *
 * Purpose:
 * Start the dedicated, loopback-only development instance used to admit and
 * exercise unpublished plugin candidates. It is a separate instance with
 * separate application data and extension storage: it never borrows the
 * everyday development checkout's (or production's) databases or extensions.
 *
 * Behavior:
 * - With --plugin, gives each external plugin a stable isolated profile with
 *   its own SQLite, admin auth and filesystem storage. The watched launcher
 *   clears inherited application env and pins local providers; no checkout
 *   .env or generated provider file may choose shared services.
 * - Without --plugin, keeps the existing manual candidate instance and its
 *   explicit operator override behavior.
 * - Sets `OR3_PLUGIN_DEVELOPMENT=1` and `OR3_PLUGIN_DEV_PROFILE` for this
 *   process tree only, then delegates to the standard dev launcher, defaulting
 *   to SSR on 127.0.0.1:3101.
 *
 * Constraints:
 * - Development builds only. Production builds reject admission even with the
 *   flag set; there is no flag combination that enables it in production.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { isPortAvailable } from '../../shared/cloud/wizard/dev-server';

const PROFILE_DIR_NAME = '.or3-plugin-dev';
const DEFAULT_PLUGIN_DEV_PORT = '3101';
const DEFAULT_PLUGIN_DEV_HOST = '127.0.0.1';

function hasFlag(argv: readonly string[], flag: string): boolean {
    return argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function flagValue(argv: readonly string[], flag: string): string | null {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]!;
        if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
        if (arg === flag && index + 1 < argv.length && !argv[index + 1]!.startsWith('--')) {
            return argv[index + 1]!;
        }
    }
    return null;
}

async function freeLoopbackPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(0, DEFAULT_PLUGIN_DEV_HOST, done);
    });
    const address = server.address();
    await new Promise<void>((done) => server.close(() => done()));
    if (!address || typeof address === 'string') throw new Error('Could not choose a local development port.');
    return address.port;
}

export function pluginDevProfile(projectRoot = process.cwd(), pluginRoot?: string): string {
    if (!pluginRoot) return resolve(projectRoot, PROFILE_DIR_NAME);
    const canonical = realpathSync(resolve(pluginRoot));
    const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
    return resolve(projectRoot, PROFILE_DIR_NAME, 'projects', digest);
}

function persistedSecret(profileRoot: string, name: string): string {
    const path = join(profileRoot, name);
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
    const secret = randomBytes(32).toString('base64url');
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, `${secret}\n`); } finally { closeSync(fd); }
    return secret;
}

export function pluginDevEnvironment(projectRoot = process.cwd(), pluginRoot?: string): NodeJS.ProcessEnv {
    const profileRoot = pluginDevProfile(projectRoot, pluginRoot);
    mkdirSync(join(profileRoot, 'extensions'), { recursive: true });
    mkdirSync(join(profileRoot, 'sqlite'), { recursive: true });
    mkdirSync(join(profileRoot, 'auth'), { recursive: true });
    mkdirSync(join(profileRoot, 'storage'), { recursive: true });
    mkdirSync(join(profileRoot, 'admin'), { recursive: true, mode: 0o700 });
    if (pluginRoot) {
        // Both dotenv/config and Nuxt CLI must read this file, never the checkout's .env.
        writeFileSync(join(profileRoot, 'empty.env'), '');
        const forbidden: Array<[string, string]> = [
            ['OR3_AUTH_PROVIDER', 'basic-auth'], ['AUTH_PROVIDER', 'basic-auth'],
            ['OR3_SYNC_PROVIDER', 'sqlite'], ['NUXT_PUBLIC_STORAGE_PROVIDER', 'fs'],
        ];
        for (const [key, expected] of forbidden) {
            if (process.env[key] && process.env[key] !== expected) {
                throw new Error(`${key} points outside the local plugin profile; unset it before running plugin development.`);
            }
        }
        for (const key of ['OR3_EXTENSIONS_ROOT', 'OR3_SQLITE_DB_PATH', 'OR3_BASIC_AUTH_DB_PATH', 'OR3_STORAGE_FS_ROOT', 'OR3_ADMIN_DATA_DIR']) {
            if (process.env[key]) throw new Error(`${key} overrides the isolated plugin profile; unset it before running plugin development.`);
        }
    }
    return {
        OR3_PLUGIN_DEVELOPMENT: '1',
        OR3_PLUGIN_DEV_PROFILE: profileRoot,
        OR3_PLUGIN_DEV_COOKIE_SCOPE: createHash('sha256').update(profileRoot).digest('hex').slice(0, 16),
        ...(pluginRoot ? {
            OR3_PLUGIN_WATCH_ROOT: realpathSync(resolve(pluginRoot)),
            DOTENV_CONFIG_PATH: join(profileRoot, 'empty.env'),
            OR3_ADMIN_DATA_DIR: join(profileRoot, 'admin'),
            OR3_ADMIN_USERNAME: 'plugin-dev',
            OR3_ADMIN_PASSWORD: persistedSecret(profileRoot, 'password'),
            OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'plugin-dev@example.test',
            OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: persistedSecret(profileRoot, 'password'),
            OR3_BASIC_AUTH_JWT_SECRET: persistedSecret(profileRoot, 'basic-auth-jwt-secret'),
            OR3_BASIC_AUTH_REFRESH_SECRET: persistedSecret(profileRoot, 'basic-auth-refresh-secret'),
            OR3_STORAGE_FS_TOKEN_SECRET: persistedSecret(profileRoot, 'fs-token-secret'),
            OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true',
            OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true',
            OR3_AUTH_REGISTRATION_MODE: 'invite_only',
            OR3_LOCAL_PROVIDERS: 'true',
            OR3_CONNECT_ENABLED: 'false',
        } : {}),
        OR3_EXTENSIONS_ROOT: process.env.OR3_EXTENSIONS_ROOT ?? join(profileRoot, 'extensions'),
        OR3_SQLITE_DB_PATH:
            process.env.OR3_SQLITE_DB_PATH ?? join(profileRoot, 'sqlite', 'or3-sync.sqlite'),
        OR3_BASIC_AUTH_DB_PATH:
            process.env.OR3_BASIC_AUTH_DB_PATH ?? join(profileRoot, 'auth', 'or3-basic-auth.sqlite'),
        // The dedicated instance must not borrow shared backing services: pin
        // the effective auth, sync and storage providers to the local profile.
        // An explicit operator override is preserved, and the admission gate
        // then reports the instance ineligible instead of sharing state.
        OR3_AUTH_PROVIDER:
            process.env.OR3_AUTH_PROVIDER ?? process.env.AUTH_PROVIDER ?? 'basic-auth',
        OR3_SYNC_PROVIDER: process.env.OR3_SYNC_PROVIDER ?? 'sqlite',
        NUXT_PUBLIC_STORAGE_PROVIDER: process.env.NUXT_PUBLIC_STORAGE_PROVIDER ?? 'fs',
        OR3_STORAGE_FS_ROOT: process.env.OR3_STORAGE_FS_ROOT ?? join(profileRoot, 'storage'),
        // Admitted candidates run through the immutable package flow, which
        // needs the V2 module loader. An explicit false keeps working but
        // leaves nothing to run the candidate.
        OR3_PLUGIN_MODULE_LOADER_V2_ENABLED:
            process.env.OR3_PLUGIN_MODULE_LOADER_V2_ENABLED ?? 'true',
    };
}

function takeValue(argv: string[], flag: string): string | undefined {
    const index = argv.indexOf(flag);
    if (index < 0) return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing ${flag} value`);
    argv.splice(index, 2);
    return value;
}

export function acquireProfile(profileRoot: string): () => void {
    const path = join(profileRoot, 'launcher.lock');
    if (existsSync(path)) {
        const pid = Number(readFileSync(path, 'utf8').trim());
        if (Number.isInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); throw new Error(`Plugin profile already in use by process ${pid}.`); }
            catch (error) { if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
        rmSync(path);
    }
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, `${process.pid}\n`); } finally { closeSync(fd); }
    return () => rmSync(path, { force: true });
}

async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
    const forwarded = [...argv];
    const createRoot = takeValue(forwarded, '--create');
    const requestedId = takeValue(forwarded, '--id');
    let pluginRoot = takeValue(forwarded, '--plugin');
    if (createRoot) {
        if (pluginRoot) throw new Error('Choose either --create or --plugin.');
        const root = resolve(createRoot);
        if (existsSync(root) && readdirSync(root).length > 0) {
            throw new Error(`Refusing to overwrite nonempty directory ${root}. Choose a new path or run or3-plugin dev in an existing plugin.`);
        }
        mkdirSync(root, { recursive: true });
        const sdkRoot = resolve(process.cwd(), 'packages/plugin-sdk');
        const profileRoot = pluginDevProfile(process.cwd(), root);
        const sdkArtifacts = join(profileRoot, 'sdk');
        mkdirSync(sdkArtifacts, { recursive: true, mode: 0o700 });
        try {
            execFileSync('bun', ['pm', 'pack', '--destination', sdkArtifacts], { cwd: sdkRoot, stdio: 'inherit' });
        } catch (error) {
            // Bun may exit after prepack but before postpack; restore only the
            // SDK manifest state that its own packaging script changed.
            execFileSync('node', ['scripts/publish-manifest.mjs', '--restore'], { cwd: sdkRoot, stdio: 'inherit' });
            throw error;
        }
        const tarball = readdirSync(sdkArtifacts).filter((name) => name.endsWith('.tgz')).sort().at(-1);
        if (!tarball) throw new Error('SDK packaging produced no tarball.');
        const { createV2Package } = await import('../../packages/plugin-sdk/src/cli/create');
        const { resolveDevHost } = await import('../../packages/plugin-sdk/src/cli/dev');
        const pluginId = requestedId ?? `or3.${basename(root).toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`;
        createV2Package({ pluginId, directory: root, sdkSource: join(sdkArtifacts, tarball) });
        try {
            execFileSync('bun', ['install'], { cwd: root, stdio: 'inherit' });
            resolveDevHost(root, process.cwd());
        } catch (error) {
            throw new Error(`Starter created at ${root}, but dependency setup failed. Run bun install there, then or3-plugin dev . --host ${process.cwd()}.`, { cause: error });
        }
        console.log(`[plugin-dev] Created ${pluginId} at ${root}`);
        pluginRoot = root;
    }
    if (pluginRoot) {
        const manifest = JSON.parse(readFileSync(resolve(pluginRoot, 'or3.manifest.json'), 'utf8')) as { trust?: string };
        if (manifest.trust !== 'isolated-client') throw new Error('Live development currently supports portable isolated-client plugins.');
        // `bun run` loads the checkout's .env before this script starts. Remove
        // inherited application configuration, then install only this profile's
        // local values. The child Nuxt CLI also receives --dotenv empty.env.
        for (const key of Object.keys(process.env)) {
            if (/^(OR3_|NUXT_|VITE_|CLERK_|CONVEX_|OPENROUTER_|AUTH_)/.test(key) ||
                key === 'SSR_AUTH_ENABLED' || key === 'AUTH_PROVIDER' || key === 'PORT' || key === 'HOST') {
                delete process.env[key];
            }
        }
    }
    Object.assign(process.env, pluginDevEnvironment(process.cwd(), pluginRoot));
    const releaseProfile = pluginRoot ? acquireProfile(process.env.OR3_PLUGIN_DEV_PROFILE!) : () => {};
    let stopWatch = () => {};
    try {
        const explicitPort = hasFlag(forwarded, '--port');
        if (!hasFlag(forwarded, '--host')) forwarded.unshift('--host', DEFAULT_PLUGIN_DEV_HOST);
        if (!hasFlag(forwarded, '--port')) forwarded.unshift('--port', DEFAULT_PLUGIN_DEV_PORT);
        if (!forwarded.includes('--or3-ssr') && !forwarded.includes('--or3-offline')) {
            forwarded.unshift('--or3-ssr');
        }
        const host = flagValue(forwarded, '--host') ?? DEFAULT_PLUGIN_DEV_HOST;
        let port = Number(flagValue(forwarded, '--port') ?? DEFAULT_PLUGIN_DEV_PORT);
        if (pluginRoot) {
            if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error('Watched plugin development must bind to 127.0.0.1 and a valid port.');
            }
            if (!await isPortAvailable(port, host)) {
                if (explicitPort) throw new Error(`Port ${port} is already in use. Stop that process or pass --port <free-port>.`);
                port = await freeLoopbackPort();
                const flagIndex = forwarded.indexOf('--port');
                forwarded[flagIndex + 1] = String(port);
            }
        }
        // The admission gate uses this bind record if the development proxy hides the socket.
        const profileRoot = process.env.OR3_PLUGIN_DEV_PROFILE!;
        writeFileSync(join(profileRoot, 'launcher.json'), `${JSON.stringify({ host, port, startedAt: new Date().toISOString() })}\n`);
        console.log(`\n  OR3 plugin development instance: http://${host}:${port}${pluginRoot ? '/chat' : ''}`);
        console.log(`  Profile root: ${profileRoot}`);
        if (pluginRoot) {
            console.log(`  Local sign-in password: ${process.env.OR3_ADMIN_PASSWORD}`);
            forwarded.push('--dotenv', join(profileRoot, 'empty.env'));
            const { watchPluginCandidate } = await import('./plugin-candidate-watch');
            stopWatch = watchPluginCandidate(pluginRoot, profileRoot);
        }
        console.log('  Ordinary registries, production pointers and user data are outside this instance.\n');
        if (pluginRoot && !process.env.CI) {
            const url = `http://${host}:${port}/admin/login?next=/chat`;
            void (async () => {
                for (let attempt = 0; attempt < 120; attempt++) {
                    const ready = await fetch(`http://${host}:${port}/api/admin/auth/session`).then(() => true, () => false);
                    if (ready) {
                        const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
                        const browser = spawn(command, [url], { stdio: 'ignore', detached: true });
                        browser.on('error', () => console.log(`  Open ${url}`));
                        browser.unref();
                        return;
                    }
                    await new Promise((done) => setTimeout(done, 500));
                }
            })();
        }
        const { main } = await import('./dev');
        return await main(forwarded);
    } finally {
        stopWatch();
        releaseProfile();
    }
}

const isDirectRun = Boolean(process.argv[1]?.endsWith('dev-plugin.ts'));
if (isDirectRun) {
    run().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    );
}
