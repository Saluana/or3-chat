import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// The runner owns this contract: its real child must receive a disposable local
// profile even when the invoking shell selected remote providers or user files.
// No Nuxt server, provider CLI or network is started by this subprocess fixture.
describe('admin auth E2E launcher', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    it.each([0, 7])('isolates the child profile, cleans it and preserves exit %s', (exitCode) => {
        const root = mkdtempSync(join(tmpdir(), 'or3-admin-launcher-test-'));
        roots.push(root);
        const bin = join(root, 'bin');
        const receipt = join(root, 'receipt.json');
        mkdirSync(bin);
        writeFileSync(join(bin, 'bunx'), `#!${process.execPath}
const fs = require('node:fs');
const keys = ['OR3_SYNC_PROVIDER', 'OR3_SYNC_ENABLED', 'OR3_CLOUD_SYNC_ENABLED',
    'OR3_CONNECT_ENABLED', 'OR3_BACKGROUND_STREAMING_ENABLED', 'OR3_WORKSPACE_CLOUD_E2E',
    'PW_SKIP_WEB_SERVER', 'OR3_LOCAL_PROVIDERS', 'OR3_ADMIN_DATA_DIR',
    'OR3_BASIC_AUTH_DB_PATH', 'OR3_SQLITE_DB_PATH', 'OR3_BASIC_AUTH_JWT_SECRET',
    'OR3_BASIC_AUTH_REFRESH_SECRET'];
fs.writeFileSync(process.env.RECEIPT, JSON.stringify({
    env: Object.fromEntries(keys.map(key => [key, process.env[key]])), args: process.argv.slice(2)
}));
process.exit(${exitCode});
`, { mode: 0o755 });
        const child = spawnSync('bun', [resolve('scripts/test/run-admin-auth-e2e.ts')], {
            cwd: root, encoding: 'utf8', timeout: 20_000,
            env: {
                PATH: `${bin}:${process.env.PATH}`, RECEIPT: receipt,
                OR3_SYNC_PROVIDER: 'convex', OR3_CONNECT_ENABLED: 'true',
                OR3_BACKGROUND_STREAMING_ENABLED: 'true',
                OR3_BASIC_AUTH_DB_PATH: join(root, 'user-auth.sqlite'),
                OR3_SQLITE_DB_PATH: join(root, 'user-sync.sqlite'),
                OR3_BASIC_AUTH_JWT_SECRET: 'inherited-user-secret',
                OR3_BASIC_AUTH_REFRESH_SECRET: 'inherited-user-secret',
                PW_SKIP_WEB_SERVER: 'true', OR3_WORKSPACE_CLOUD_E2E: 'true',
            },
        });
        expect(child.status, child.stderr).toBe(exitCode);
        const { env, args } = JSON.parse(readFileSync(receipt, 'utf8'));
        expect(args).toContain('tests/e2e/or3-cloud-auth.spec.ts');
        expect(env.OR3_SYNC_PROVIDER).toBe('sqlite');
        expect(env.OR3_SYNC_ENABLED).toBe('false');
        expect(env.OR3_CLOUD_SYNC_ENABLED).toBe('false');
        expect(env.OR3_CONNECT_ENABLED).toBe('false');
        expect(env.OR3_BACKGROUND_STREAMING_ENABLED).toBe('false');
        expect(env.OR3_WORKSPACE_CLOUD_E2E).toBe('false');
        expect(env.PW_SKIP_WEB_SERVER).toBe('false');
        expect(env.OR3_LOCAL_PROVIDERS).toBe('false');
        for (const path of [env.OR3_BASIC_AUTH_DB_PATH, env.OR3_SQLITE_DB_PATH]) {
            expect(path.startsWith(`${env.OR3_ADMIN_DATA_DIR}${sep}`)).toBe(true);
        }
        for (const secret of [env.OR3_BASIC_AUTH_JWT_SECRET, env.OR3_BASIC_AUTH_REFRESH_SECRET]) {
            expect(secret).not.toBe('inherited-user-secret');
            expect(secret.length).toBeGreaterThanOrEqual(32);
        }
        expect(existsSync(env.OR3_ADMIN_DATA_DIR)).toBe(false);
        expect(existsSync(join(root, 'user-auth.sqlite'))).toBe(false);
        expect(existsSync(join(root, 'user-sync.sqlite'))).toBe(false);
    });
});
