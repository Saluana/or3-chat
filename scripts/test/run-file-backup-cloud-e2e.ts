import { mkdtemp, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareS3TestBucket } from './s3-test-bucket';

const args = process.argv.slice(2);
const tarballIndex = args.indexOf('--provider-tarball');
const providerTarball = tarballIndex < 0 ? undefined : resolve(args[tarballIndex + 1] || '');
if (tarballIndex >= 0 && !args[tarballIndex + 1]) throw new Error('--provider-tarball requires a path');
if (providerTarball) {
    const target = 'node_modules/or3-provider-sqlite';
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    execFileSync('tar', ['-xzf', providerTarball, '-C', target, '--strip-components=1']);
    args.splice(tarballIndex, 2);
}
const providerTarballSha256 = providerTarball ? createHash('sha256').update(new Uint8Array(await Bun.file(providerTarball).arrayBuffer())).digest('hex') : undefined;

const directory = await mkdtemp('/tmp/or3-file-backup-cloud-');
const s3 = process.argv.includes('--s3');
const storageProvider = s3 ? 's3' : 'fs';
const syncFault = process.argv.includes('--sync-fault');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const syncRecovery = process.argv.includes('--sync-recovery');
const outputRoot = syncFault ? `test-results/sync-fault/${stamp}` : syncRecovery ? 'test-results/sync-hardening-cloud' : `test-results/file-backup-cloud${s3 ? '-s3' : ''}`;
const development = process.argv.includes('--development-providers');
const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('probe') });
const port = probe.port!;
await probe.stop(true);
let exitCode = 1;
let s3CleanupComplete: boolean | undefined;
let bucket: Awaited<ReturnType<typeof prepareS3TestBucket>> | undefined;
try {
    if (s3) bucket = await prepareS3TestBucket(`http://127.0.0.1:${port}`);
    const envFile = join(directory, 'fixture.env');
    await writeFile(envFile, '', { mode: 0o600 });
    await mkdir(outputRoot, { recursive: true });
    const log = syncFault ? createWriteStream(join(outputRoot, 'server-and-runner.log')) : undefined;
    const child = Bun.spawn(['bunx', 'playwright', 'test', syncFault ? 'tests/e2e/cloud-sync-fault.e2e.ts' : syncRecovery ? 'tests/e2e/cloud-offline-recovery.e2e.ts' : 'tests/e2e/cloud-file-backup.spec.ts', '--workers=1', (syncRecovery || syncFault) ? '--reporter=line,json' : '--reporter=line',
        '--trace=retain-on-failure', '--retries=0', `--output=${outputRoot}/browser`, ...args.filter(value => !['--development-providers', '--sync-recovery', '--sync-fault', '--s3'].includes(value))], {
        stdout: syncFault ? 'pipe' : 'inherit', stderr: syncFault ? 'pipe' : 'inherit', env: { ...process.env,
            CI: 'true', TEST: 'true',
            ...(syncFault ? { DISABLE_RATE_LIMIT: '1' } : {}),
            ...((syncRecovery || syncFault) ? { PLAYWRIGHT_JSON_OUTPUT_NAME: join(process.cwd(), outputRoot, 'playwright.json') } : {}),
            DOTENV_CONFIG_PATH: envFile,
            SSR_AUTH_ENABLED: 'true', AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth',
            OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', OR3_GUEST_ACCESS_ENABLED: 'false',
            OR3_LOCAL_PROVIDERS: development ? 'true' : 'false', OR3_USE_LOCAL_PACKAGES: 'false',
            OR3_BASIC_AUTH_DB_PATH: join(directory, 'auth.sqlite'), OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'file-backup@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableBackupSuite!123',
            OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite',
            OR3_SQLITE_DB_PATH: join(directory, 'sync.sqlite'), OR3_SQLITE_DRIVER: 'better-sqlite3',
            OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true', OR3_STORAGE_PROVIDER: storageProvider, NUXT_PUBLIC_STORAGE_PROVIDER: storageProvider,
            ...bucket?.env,
            OR3_STORAGE_FS_ROOT: join(directory, 'files'), OR3_STORAGE_FS_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_MAX_CLOUD_FILE_SIZE_BYTES: String(64 * 1024 * 1024),
            OR3_BACKGROUND_STREAMING_ENABLED: 'false',
            // File-backup qualification does not store account model credentials.
            NUXT_SECRETS_PROVIDER: '',
            OR3_ADMIN_DATA_DIR: join(directory, 'admin'), OR3_ADMIN_USERNAME: 'backup-audit', OR3_ADMIN_PASSWORD: 'DisposableAdminSuite!123',
            OR3_ADMIN_ALLOW_RESTART: 'true', OR3_DEV_RESTART_STATE_DIR: join(directory, 'lifecycle'),
            OR3_FILE_BACKUP_E2E_DIR: directory,
            PW_PORT: String(port), PW_SKIP_WEB_SERVER: syncFault ? 'true' : 'false',
        },
    });
    const copy = async (stream: ReadableStream<Uint8Array>, target: NodeJS.WriteStream) => {
        for await (const chunk of stream) { target.write(chunk); log?.write(chunk); }
    };
    const output = syncFault ? Promise.all([copy(child.stdout as ReadableStream<Uint8Array>, process.stdout), copy(child.stderr as ReadableStream<Uint8Array>, process.stderr)]) : Promise.resolve();
    exitCode = await child.exited;
    await output;
    if (log) await new Promise<void>(resolve => log.end(resolve));
    process.exitCode = exitCode;
} finally {
    try { if (bucket) { s3CleanupComplete = false; await bucket.cleanup(); s3CleanupComplete = true; } } catch (error) { exitCode = 1; process.exitCode = 1; console.error('S3 fixture cleanup failed:', error instanceof Error ? error.message : 'unknown error'); }
    await rm(directory, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });
    await writeFile(join(outputRoot, 'receipt.json'), JSON.stringify({
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
        largeFixture: process.env.OR3_BACKUP_LARGE_E2E === 'true',
        command: syncFault ? 'bun run test:e2e:sync:fault' : syncRecovery ? 'bun run test:e2e:sync:cloud' : s3 ? 'bun run test:e2e:file-backup:s3' : 'bun run test:e2e:file-backup:cloud', timestamp: new Date().toISOString(), arguments: process.argv.slice(2),
        providerTarball, providerTarballSha256,
        harnessSha256: syncFault ? createHash('sha256').update(await Bun.file('tests/e2e/cloud-sync-fault.e2e.ts').text()).digest('hex') : undefined,
        providerSourceSha: process.env.OR3_E2E_PROVIDER_SOURCE_SHA,
        comparison: process.env.OR3_E2E_COMPARISON,
        sqliteProviderVersion: syncFault ? JSON.parse(await Bun.file('node_modules/or3-provider-sqlite/package.json').text()).version : undefined,
        providerResolution: development ? 'OR3_LOCAL_PROVIDERS=true (development wrapper resolves available sibling provider sources)' : 'installed node_modules/or3-provider-sqlite',
        profile: `Disposable Basic Auth + ${development ? 'development' : 'installed'} providers + SQLite + ${storageProvider} storage`, s3Prefix: bucket?.prefix, exitCode, temporaryDataRemoved: true, s3CleanupComplete,
    }, null, 2));
    if (syncFault) {
        await writeFile(join(outputRoot, 'summary.md'), `# Sync fault run\n\nExit code: ${exitCode}. See playwright.json and the individual scenario JSON files for results. Server and runner output is in server-and-runner.log.\n`);
        const destination = join('/Users/brendon/Documents/or3/.worktrees/sync-hardening/findings/e2e-artifacts', stamp);
        await mkdir(destination, { recursive: true });
        await cp(outputRoot, destination, { recursive: true });
        console.log(`Sync fault artifacts: ${destination}`);
    }
}
