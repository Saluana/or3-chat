import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = await realpath(await mkdtemp('/tmp/or3-cloud-credentials-'));
const cli = join(process.cwd(), 'node_modules/@or3/secrets/dist/cli.js');
const socket = join(dir, 'api.sock'), key = join(dir, 'master.key'), operator = join(dir, 'operator.token'), token = join(dir, 'app.token');
const vault = join(dir, 'vault');
const invoke = (args: string[]) => JSON.parse(execFileSync('bun', ['--no-env-file', cli, ...args], { encoding: 'utf8' }));
let service: ReturnType<typeof Bun.spawn> | undefined;
let exitCode = 1;
try {
    const initialized = invoke(['init', '--vault-dir', vault, '--key-file', key, '--operator-file', operator]);
    service = Bun.spawn(['bun', '--no-env-file', cli, 'serve', '--vault-dir', vault, '--key-file', key, '--socket', socket], { stdout: 'pipe', stderr: 'inherit' });
    const reader = service.stdout.getReader();
    const ready = await reader.read();
    if (!JSON.parse(new TextDecoder().decode(ready.value)).ready) throw new Error('Vault not ready');
    invoke(['token', 'issue', '--socket', socket, '--vault-id', initialized.vaultId, '--service-uid', String(process.getuid!()), '--token-file', operator,
        '--kind', 'service', '--namespace', 'or3', '--capabilities', 'metadata,read,write,delete', '--expires-in', '1d', '--out-file', token]);
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
        NUXT_SECRETS_PROVIDER: 'or3-secrets', NUXT_SECRETS_SOCKET_PATH: socket, NUXT_SECRETS_TOKEN_FILE: token,
        NUXT_SECRETS_VAULT_ID: initialized.vaultId, NUXT_SECRETS_NAMESPACE: 'or3', NUXT_SECRETS_SERVICE_UID: String(process.getuid!()),
        OR3_CREDENTIAL_E2E: 'true', PW_PORT: String(port), PW_SKIP_WEB_SERVER: 'false',
    } });
    exitCode = await child.exited;
} finally {
    service?.kill('SIGTERM'); if (service) await service.exited;
    await rm(dir, { recursive: true, force: true });
    await mkdir('test-results/cloud-credentials', { recursive: true });
    await writeFile('test-results/cloud-credentials/receipt.json', JSON.stringify({
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        command: 'bun scripts/test/run-cloud-credentials-e2e.ts', exitCode, syntheticFixturesRemoved: true,
        profile: 'Installed providers, Basic Auth + SQLite + filesystem + real local vault; Docker test separately verifies UID custody',
    }, null, 2));
}
process.exitCode = exitCode;
