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
try {
    const port = await reservePort();
    const child = Bun.spawn(
        [
            'bunx',
            'playwright',
            'test',
            'tests/e2e/cloud-sign-in-gate.spec.ts',
            '--workers=1',
            '--reporter=line',
            '--trace=on',
        ],
        {
            cwd: process.cwd(),
            stdout: 'inherit',
            stderr: 'inherit',
            env: {
                ...process.env,
                SSR_AUTH_ENABLED: 'true',
                AUTH_PROVIDER: 'basic-auth',
                OR3_AUTH_PROVIDER: 'basic-auth',
                OR3_GUEST_ACCESS_ENABLED: 'false',
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
                OPENROUTER_API_KEY: '',
                OR3_OPENROUTER_API_KEY: '',
                NUXT_OPENROUTER_API_KEY: '',
                OR3_SIGN_IN_GATE_E2E_HARNESS: 'true',
                PW_PORT: String(port),
                PW_SKIP_WEB_SERVER: 'false',
            },
        }
    );
    process.exitCode = await child.exited;
} finally {
    await rm(dataDir, { recursive: true, force: true });
}
