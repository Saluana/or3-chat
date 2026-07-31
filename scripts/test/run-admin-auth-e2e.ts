#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
                    OR3_ADMIN_AUTH_E2E_HARNESS: 'true',
                    OR3_ADMIN_DATA_DIR: dataDir,
                    OR3_ADMIN_USERNAME: username,
                    OR3_ADMIN_PASSWORD: password,
                    OR3_ADMIN_E2E_USERNAME: username,
                    OR3_ADMIN_E2E_PASSWORD: password,
                    PW_PORT: String(port),
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
