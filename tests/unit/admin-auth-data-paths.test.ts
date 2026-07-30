import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    resolveAdminCredentialsPath,
    resolveAdminDataDir,
    resolveAdminJwtSecretPath,
} from '../../server/admin/auth/data-paths';
import {
    credentialsFileExists,
    readAdminCredentials,
    writeAdminCredentials,
} from '../../server/admin/auth/credentials';

describe('admin auth data paths', () => {
    const previousDataDir = process.env.OR3_ADMIN_DATA_DIR;
    const temporaryDirs: string[] = [];

    afterEach(async () => {
        if (previousDataDir === undefined) {
            delete process.env.OR3_ADMIN_DATA_DIR;
        } else {
            process.env.OR3_ADMIN_DATA_DIR = previousDataDir;
        }
        await Promise.all(
            temporaryDirs.splice(0).map((path) =>
                rm(path, { recursive: true, force: true })
            )
        );
    });

    it('uses .data by default for credentials and generated JWT secrets', () => {
        delete process.env.OR3_ADMIN_DATA_DIR;
        const dataDir = resolve('.data');

        expect(resolveAdminDataDir()).toBe(dataDir);
        expect(resolveAdminCredentialsPath()).toBe(
            resolve(dataDir, 'admin-credentials.json')
        );
        expect(resolveAdminJwtSecretPath()).toBe(
            resolve(dataDir, 'admin-jwt-secret')
        );
    });

    it('resolves relative and absolute OR3_ADMIN_DATA_DIR overrides', () => {
        process.env.OR3_ADMIN_DATA_DIR = 'tmp/admin-auth';
        expect(resolveAdminDataDir()).toBe(resolve('tmp/admin-auth'));

        const absoluteDir = resolve(tmpdir(), 'or3-admin-auth');
        process.env.OR3_ADMIN_DATA_DIR = absoluteDir;
        expect(resolveAdminDataDir()).toBe(absoluteDir);
        expect(resolveAdminCredentialsPath()).toBe(
            resolve(absoluteDir, 'admin-credentials.json')
        );
        expect(resolveAdminJwtSecretPath()).toBe(
            resolve(absoluteDir, 'admin-jwt-secret')
        );
    });

    it('reads and writes credentials only in the configured directory', async () => {
        const dataDir = await mkdtemp(resolve(tmpdir(), 'or3-admin-auth-'));
        temporaryDirs.push(dataDir);
        process.env.OR3_ADMIN_DATA_DIR = dataDir;
        const credentials = {
            username: 'isolated-admin',
            password_hash_bcrypt: '$2b$12$test-only-placeholder',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        };

        expect(await credentialsFileExists()).toBe(false);
        await writeAdminCredentials(credentials);

        expect(await readAdminCredentials()).toEqual(credentials);
        expect(
            JSON.parse(await readFile(resolveAdminCredentialsPath(), 'utf8'))
        ).toEqual(credentials);
    });
});
