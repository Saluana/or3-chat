import { mkdtemp, mkdir, rm, writeFile, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareSourceSecrets } from '../../shared/dev/secrets';
import { execFileSync } from 'node:child_process';

const dir = await realpath(await mkdtemp('/tmp/or3-cloud-credentials-'));
let vaultOwner: Awaited<ReturnType<typeof prepareSourceSecrets>> | undefined;
let exitCode = 1;
try {
    await symlink(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'));
    await writeFile(join(dir, 'package.json'), '{}');
    vaultOwner = await prepareSourceSecrets(dir, { PATH: process.env.PATH, HOME: process.env.HOME, SSR_AUTH_ENABLED: 'true', NODE_ENV: 'development' }, { mode: 'auto' });
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('probe') });
    const port = probe.port!; await probe.stop(true);
    await writeFile(join(dir, 'fixture.env'), '');
    const child = Bun.spawn(['bunx', 'playwright', 'test', 'tests/e2e/cloud-credentials.spec.ts', '--workers=1', '--reporter=line', '--retries=0', '--trace=retain-on-failure',
        '--output=test-results/cloud-credentials/browser'], { stdout: 'inherit', stderr: 'inherit', env: {
        ...process.env, CI: 'true', TEST: 'true', DOTENV_CONFIG_PATH: join(dir, 'fixture.env'),
        SSR_AUTH_ENABLED: 'true', AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth',
        OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', OR3_GUEST_ACCESS_ENABLED: 'false',
        OR3_LOCAL_PROVIDERS: 'false', OR3_USE_LOCAL_PACKAGES: 'false',
        OR3_BASIC_AUTH_DB_PATH: join(dir, 'auth.sqlite'), OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'credential-audit@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableCredentialSuite!123',
        OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite', OR3_SQLITE_DB_PATH: join(dir, 'sync.sqlite'),
        OR3_STORAGE_ENABLED: 'true', OR3_STORAGE_PROVIDER: 'fs', NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
        OR3_STORAGE_FS_ROOT: join(dir, 'files'), OR3_STORAGE_FS_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        OR3_ADMIN_DATA_DIR: join(dir, 'admin'), OR3_BACKGROUND_STREAMING_ENABLED: 'false',
        ...Object.fromEntries(Object.entries(vaultOwner.env).filter(([key]) => key.startsWith('NUXT_SECRETS_'))),
        OR3_CREDENTIAL_E2E: 'true', PW_PORT: String(port), PW_SKIP_WEB_SERVER: 'false',
    } });
    exitCode = await child.exited;
} finally {
    await vaultOwner?.close();
    await rm(dir, { recursive: true, force: true });
    await mkdir('test-results/cloud-credentials', { recursive: true });
    await writeFile('test-results/cloud-credentials/receipt.json', JSON.stringify({
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        command: 'bun scripts/test/run-cloud-credentials-e2e.ts', exitCode, syntheticFixturesRemoved: true,
        profile: 'Installed providers, Basic Auth + SQLite + filesystem + automatically provisioned real local vault; Docker test separately verifies UID custody',
    }, null, 2));
}
process.exitCode = exitCode;
