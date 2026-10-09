#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const username = 'or3-e2e-admin';
const password = 'Or3AdminE2ePass123!';

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

async function run(): Promise<number> {
    const dataDir = await mkdtemp(join(tmpdir(), 'or3-admin-auth-e2e-'));

    try {
        const port = await reservePort();
        const child = spawn(
            'bunx',
            [
                'playwright',
                'test',
                'tests/e2e/or3-cloud-auth.spec.ts',
                '--workers=1',
                '--reporter=line',
            ],
            {
                cwd: process.cwd(),
                stdio: 'inherit',
                env: {
                    ...process.env,
                    SSR_AUTH_ENABLED: 'true',
                    AUTH_PROVIDER: 'basic-auth',
                    OR3_AUTH_PROVIDER: 'basic-auth',
                    OR3_GUEST_ACCESS_ENABLED: 'false',
                    OR3_AUTH_REGISTRATION_MODE: 'invite_only',
                    OR3_AUTH_AUTO_PROVISION: 'false',
                    OR3_SYNC_ENABLED: 'false',
                    OR3_CLOUD_SYNC_ENABLED: 'false',
                    // Auth still provisions workspace records through the sync
                    // provider even when transfer is off. Keep both stores local.
                    OR3_SYNC_PROVIDER: 'sqlite',
                    OR3_SQLITE_DRIVER: 'better-sqlite3',
                    OR3_SQLITE_DB_PATH: join(dataDir, 'sync.sqlite'),
                    OR3_BASIC_AUTH_DB_PATH: join(dataDir, 'auth.sqlite'),
                    OR3_BASIC_AUTH_JWT_SECRET: randomUUID() + randomUUID(),
                    OR3_BASIC_AUTH_REFRESH_SECRET: randomUUID() + randomUUID(),
                    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: '',
                    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: '',
                    OR3_STORAGE_ENABLED: 'false',
                    OR3_CLOUD_STORAGE_ENABLED: 'false',
                    OR3_CONNECT_ENABLED: 'false',
                    OR3_BACKGROUND_STREAMING_ENABLED: 'false',
                    OR3_LOCAL_PROVIDERS: 'false',
                    OR3_USE_LOCAL_PACKAGES: 'false',
                    OR3_WORKSPACE_CLOUD_E2E: 'false',
                    OPENROUTER_API_KEY: '',
                    OR3_OPENROUTER_API_KEY: '',
                    NUXT_OPENROUTER_API_KEY: '',
                    OR3_ADMIN_AUTH_E2E_HARNESS: 'true',
                    OR3_ADMIN_DATA_DIR: dataDir,
                    OR3_ADMIN_USERNAME: username,
                    OR3_ADMIN_PASSWORD: password,
                    OR3_ADMIN_E2E_USERNAME: username,
                    OR3_ADMIN_E2E_PASSWORD: password,
                    PW_PORT: String(port),
                    PW_SKIP_WEB_SERVER: 'false',
                },
            }
        );

        return await new Promise<number>((resolvePromise, rejectPromise) => {
            child.once('error', rejectPromise);
            child.once('exit', (code, signal) => {
                if (signal) {
                    rejectPromise(
                        new Error(`Playwright terminated by ${signal}`)
                    );
                    return;
                }
                resolvePromise(code ?? 1);
            });
        });
    } finally {
        await rm(dataDir, { recursive: true, force: true });
    }
}

process.exitCode = await run();
