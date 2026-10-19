#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function reservePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(0, '127.0.0.1', resolvePromise);
    });
    const address = server.address();
    const port =
        typeof address === 'object' && address !== null ? address.port : 0;
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) =>
            error ? rejectPromise(error) : resolvePromise()
        );
    });
    if (!port) throw new Error('Could not reserve a Playwright port');
    return port;
}

// The managed profile (Basic Auth + SQLite + filesystem storage, invite-only,
// guest access off) with no OpenRouter key. Every database, storage root, and
// the bootstrap user live in a disposable directory.
const dataDir = await mkdtemp(join(tmpdir(), 'or3-sign-in-gate-e2e-'));
const siteSettings = process.argv.includes('--site-settings');
const waitlist = process.argv.includes('--waitlist');
const withoutExtension = process.argv.includes('--without-extension');
try {
    const port = await reservePort();
    const httpsPort = await reservePort();
    const args = [
        'bunx', 'playwright', 'test',
        waitlist ? 'tests/e2e/cloud-waitlist.spec.ts' : 'tests/e2e/cloud-sign-in-gate.spec.ts',
        '--workers=1', '--reporter=line', '--trace=off',
        ...(waitlist ? ['--grep', 'optional waitlist:'] : siteSettings ? ['--grep', 'admin experience settings', '--output', 'test-results/admin-settings'] : []),
        ...(waitlist ? ['--output', withoutExtension ? 'test-results/waitlist-absent' : 'test-results/waitlist-enabled'] : []),
        ...process.argv.slice(2).filter(arg => !['--waitlist', '--without-extension', '--site-settings'].includes(arg)),
    ];
    const options = {
        cwd: process.cwd(),
        stdout: 'inherit' as const,
        stderr: 'inherit' as const,
        env: {
            ...process.env,
            // This host-only journey must not rebuild sibling dist folders used by a live dev server.
            ...(siteSettings ? { OR3_LOCAL_PROVIDERS: 'false' } : {}),
            SSR_AUTH_ENABLED: 'true',
            AUTH_PROVIDER: 'basic-auth',
            OR3_AUTH_PROVIDER: 'basic-auth',
            OR3_GUEST_ACCESS_ENABLED: 'false',
            OR3_CLOUD_WAITLIST_ENABLED: String(waitlist && !withoutExtension),
            OR3_AUTH_LOCK_PAGE_ENABLED: String(waitlist),
            OR3_AUTH_LOCK_PAGE_ADAPTER: 'default',
            OR3_PRODUCTION_JOURNEY_TEST_HARNESS: 'true',
            // Rapid disposable browser contexts share a loopback IP; production guards are unchanged.
            DISABLE_RATE_LIMIT: '1',
            OR3_AUTH_REGISTRATION_MODE: 'invite_only',
            OR3_AUTH_AUTO_PROVISION: 'false',
            OR3_AUTH_INVITE_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_SYNC_ENABLED: 'true',
            OR3_CLOUD_SYNC_ENABLED: 'true',
            OR3_SYNC_PROVIDER: 'sqlite',
            OR3_SQLITE_DB_PATH: join(dataDir, 'sync.sqlite'),
            OR3_STORAGE_ENABLED: 'true',
            OR3_CLOUD_STORAGE_ENABLED: 'true',
            NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
            OR3_STORAGE_FS_ROOT: join(dataDir, 'storage'),
            OR3_STORAGE_FS_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BACKGROUND_STREAMING_ENABLED: 'false',
            OR3_BASIC_AUTH_DB_PATH: join(dataDir, 'auth.sqlite'),
            OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'sign-in-gate-e2e@example.test',
            OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableSignInGate!123',
            OR3_ADMIN_DATA_DIR: join(dataDir, 'admin'),
            OR3_ADMIN_USERNAME: 'sign-in-gate-admin',
            OR3_ADMIN_PASSWORD: 'DisposableSignInGateAdmin!123',
            // The admin scope regression prepares an inactive V2 ZIP candidate.
            OR3_PLUGIN_RUNTIME_V2_ENABLED: 'true',
            OR3_PLUGIN_MODULE_LOADER_V2_ENABLED: 'true',
            OPENROUTER_API_KEY: '',
            OR3_OPENROUTER_API_KEY: '',
            NUXT_OPENROUTER_API_KEY: '',
            OR3_SIGN_IN_GATE_E2E_HARNESS: 'true',
            OR3_SITE_SETTINGS_RESTART_E2E: String(siteSettings),
            OR3_DEV_HTTPS_PORT: String(httpsPort),
            PW_PORT: String(port),
            PW_SKIP_WEB_SERVER: 'false',
        },
    };
    process.exitCode = await Bun.spawn(args, options).exited;
    if (process.exitCode === 0 && siteSettings) {
        const restartArgs = args.map(arg => arg === 'admin experience settings' ? 'admin settings persistence after restart'
            : arg === 'test-results/admin-settings' ? 'test-results/admin-settings-restart' : arg);
        process.exitCode = await Bun.spawn(restartArgs, {
            ...options,
            env: { ...options.env, OR3_SITE_SETTINGS_RESTART_STAGE: 'true', PW_PORT: String(await reservePort()), OR3_DEV_HTTPS_PORT: String(await reservePort()) },
        }).exited;
    }
    if (process.exitCode === 0 && waitlist && !withoutExtension) {
        // A second Playwright-owned server opens the same database on fresh ports.
        // This proves persistence across process shutdown, without touching the user's server.
        const restartArgs = args.map(arg => arg === 'optional waitlist:' ? 'waitlist persistence after restart'
            : arg === 'test-results/waitlist-enabled' ? 'test-results/waitlist-restart' : arg);
        process.exitCode = await Bun.spawn(restartArgs, {
            ...options,
            env: { ...options.env, PW_PORT: String(await reservePort()), OR3_DEV_HTTPS_PORT: String(await reservePort()) },
        }).exited;
    }
} finally {
    await rm(dataDir, { recursive: true, force: true });
}
