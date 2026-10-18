#!/usr/bin/env bun
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { managedRestartFixture } from './managed-restart-fixture';
import { fixtureCall, sseFrame, toolResponse } from '../../tests/e2e/fixtures/chat-tool-script';

const modes = ['--dev', '--managed', '--failure', '--performance', '--https'];
const flags = process.argv.slice(2);
const backgroundProvider = flags.find(arg => arg.startsWith('--background='))?.slice('--background='.length) ?? 'memory';
if (!['memory', 'sqlite', 'convex'].includes(backgroundProvider)) throw new Error('Choose --background=memory, sqlite or convex');
const target = flags.includes('--managed') ? 'managed' : 'dev';
const mode = flags.includes('--failure') ? '--failure' : flags.includes('--performance') ? '--performance' : `--${target}`;
if (flags.some(arg => arg.startsWith('--') && !modes.includes(arg) && arg !== `--background=${backgroundProvider}`)) throw new Error('Choose --dev, --managed, --failure or --performance');
if (backgroundProvider !== 'memory' && (mode !== '--failure' || target !== 'dev')) throw new Error('Provider execution qualification requires --failure --dev');
const data = await mkdtemp(join(tmpdir(), 'or3-restart-e2e-'));
const output = resolve('test-results/server-restarts', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
let httpsPort: number | undefined;
let certificateSpki: string | undefined;
if (flags.includes('--https')) {
    if (target !== 'dev') throw new Error('HTTPS source qualification requires --dev');
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    httpsPort = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const certificate = Bun.spawn(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(data, 'dev.key'), '-out', join(data, 'dev.crt'),
        '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
    if (await certificate.exited) throw new Error('Disposable HTTPS certificate generation failed');
    certificateSpki = createHash('sha256').update(new X509Certificate(await readFile(join(data, 'dev.crt'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
}
const envFile = join(data, '.env');
const settings: Record<string, string> = {
    SSR_AUTH_ENABLED: 'true', OR3_AUTH_PROVIDER: 'basic-auth', AUTH_PROVIDER: 'basic-auth',
    OR3_GUEST_ACCESS_ENABLED: 'false', OR3_AUTH_REGISTRATION_MODE: 'open',
    OR3_AUTH_AUTO_PROVISION: 'true', OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true',
    OR3_SYNC_PROVIDER: 'sqlite', OR3_SQLITE_DB_PATH: join(data, 'sync.sqlite'),
    OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true', NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
    OR3_STORAGE_FS_ROOT: join(data, 'storage'), OR3_STORAGE_FS_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BACKGROUND_STREAMING_ENABLED: 'false', OR3_BASIC_AUTH_DB_PATH: join(data, 'auth.sqlite'),
    OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'restart@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableRestart!123',
    OR3_ADMIN_DATA_DIR: join(data, 'admin'), OR3_ADMIN_USERNAME: 'restart-admin', OR3_ADMIN_PASSWORD: 'DisposableRestartAdmin!123',
    OR3_ADMIN_ALLOW_RESTART: 'true', OR3_AUTH_INVITE_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_PRODUCTION_JOURNEY_TEST_HARNESS: 'true', OPENROUTER_API_KEY: '', OR3_OPENROUTER_API_KEY: '',
    OR3_DEV_RESTART_STATE_DIR: join(data, 'lifecycle'),
    OR3_RESTART_E2E: 'true', OR3_RESTART_CLOSE_EVIDENCE: join(data, 'lifecycle-close.jsonl'),
    OR3_RESTART_HISTORY_EVIDENCE: join(output, 'history-recovery.jsonl'),
    ...(httpsPort ? { OR3_DEV_HTTPS_CERT: join(data, 'dev.crt'), OR3_DEV_HTTPS_KEY: join(data, 'dev.key'), OR3_DEV_HTTPS_PORT: String(httpsPort), OR3_TRUST_PROXY: 'true' } : {}),
};
const modelRequests: Array<{ toolResults: number }> = [];
let releaseModel!: () => void;
const modelReleased = new Promise<void>(resolve => { releaseModel = resolve; });
const model = mode === '--failure' && target === 'dev' ? Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/state') return Response.json({ requests: modelRequests });
    if (path === '/release') { releaseModel(); return Response.json({ ok: true }); }
    if (path !== '/api/v1/chat/completions' || request.method !== 'POST') return Response.json({ data: [] });
    const body = await request.json() as { messages: Array<{ role: string; content: string }>; tools: Array<{ function: { name: string } }> };
    const toolResults = body.messages.filter(message => message.role === 'tool').length;
    modelRequests.push({ toolResults });
    const id = body.messages.find(message => message.role === 'user')!.content.split(':').at(-1)!;
    if (toolResults) await modelReleased;
    return new Response(toolResults ? sseFrame({ content: 'Restart fixture completed.' }, 'stop') + 'data: [DONE]\n\n'
        : toolResponse([fixtureCall(id, body.tools[0]!.function.name, 'fixture')]), { headers: { 'content-type': 'text/event-stream' } });
} }) : undefined;
if (model) Object.assign(settings, {
    OR3_BACKGROUND_STREAMING_ENABLED: 'true', OR3_BACKGROUND_STREAMING_PROVIDER: backgroundProvider,
    OR3_CHAT_TOOLS_CLOUD_TEST_HARNESS: 'true', OR3_BACKGROUND_ENCRYPTION_KEY: crypto.randomUUID() + crypto.randomUUID(),
    OPENROUTER_API_KEY: 'disposable-fixture-key', OR3_OPENROUTER_API_KEY: 'disposable-fixture-key', NUXT_OPENROUTER_API_KEY: 'disposable-fixture-key',
    NUXT_OPENROUTER_BASE_URL: `http://127.0.0.1:${model.port}/api/v1`,
});
if (model && backgroundProvider === 'convex') {
    // Only the disposable backend lifecycle owner supplies these credentials.
    const backendUrl = new URL(process.env.OR3_RESTART_E2E_CONVEX_URL ?? '');
    const adminKey = process.env.OR3_RESTART_E2E_CONVEX_ADMIN_KEY;
    if (backendUrl.protocol !== 'http:' || backendUrl.hostname !== '127.0.0.1' || !adminKey) throw new Error('Convex qualification requires the disposable loopback backend');
    Object.assign(settings, { VITE_CONVEX_URL: backendUrl.origin, CONVEX_SELF_HOSTED_URL: backendUrl.origin,
        CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey, OR3_CONVEX_ALLOW_INSECURE_HTTP: 'true' });
}
await writeFile(envFile, Object.entries(settings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
const env = { ...process.env, DOTENV_CONFIG_PATH: envFile, OR3_RESTART_E2E: 'true', OR3_RESTART_E2E_MODE: mode,
    OR3_RESTART_E2E_TARGET: target,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    OR3_RESTART_E2E_ENV: envFile, OR3_RESTART_E2E_OUTPUT: output, PW_PORT: String(port), PW_SKIP_WEB_SERVER: 'false' };
if (model) Object.assign(env, { OR3_RESTART_E2E_MODEL: `http://127.0.0.1:${model.port}` });
if (httpsPort) Object.assign(env, { PW_HTTPS_PORT: String(httpsPort), PW_RESTART_TLS_SPKI: certificateSpki });
let code = 1;
let managed: Awaited<ReturnType<typeof managedRestartFixture>> | undefined;
let before: unknown;
let beforeChecksum: string | undefined;
let portClosed = false;
try {
    if (mode === '--failure') {
        const failures = Bun.spawn([process.execPath, 'x', 'vitest', 'run', 'scripts/__tests__/restart-supervisor.test.ts', 'server/plugins/__tests__/graceful-shutdown.test.ts', '--reporter=dot'], { cwd: process.cwd(), env, stdout: 'inherit', stderr: 'inherit' });
        const failureCode = await failures.exited;
        if (failureCode) throw new Error('Lifecycle fault qualification failed');
    }
    if (target === 'managed') {
        managed = await managedRestartFixture(data, port, settings);
        await managed.start();
        before = await managed.inspect(); beforeChecksum = await managed.checksum();
        env.PW_SKIP_WEB_SERVER = 'true';
    }
    // Playwright owns the standard launcher and its process-group cleanup.
    const child = Bun.spawn([process.execPath, 'x', 'playwright', 'test', 'tests/e2e/server-restarts.spec.ts',
        '--workers=1', '--reporter=line', '--trace=off', '--output', join(output, 'browser')], { cwd: process.cwd(), env, stdout: 'inherit', stderr: 'inherit' });
    code = await child.exited;
    if (managed) {
        const after = await managed.inspect(); const afterChecksum = await managed.checksum();
        await writeFile(join(output, 'managed-identity.json'), JSON.stringify({ before, after, beforeChecksum, afterChecksum, operatorImage: managed.operatorImage }, null, 2));
        const original = before as typeof after;
        if (after.image !== original.image || after.volume !== original.volume || afterChecksum !== beforeChecksum || !after.readOnly || after.grace !== 25) code = 1;
    }
    const closed = (managed ? await managed.closeEvidence() : await readFile(settings.OR3_RESTART_CLOSE_EVIDENCE!, 'utf8'))
        .trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { bootId: string; pid: number; closedAt: string });
    await writeFile(join(output, 'runtime-close.json'), JSON.stringify(closed, null, 2));
    if (code === 0) {
        const { boots } = JSON.parse(await readFile(join(output, mode === '--performance' ? 'runtime-boots.json' : 'boots.json'), 'utf8')) as { boots: string[] };
        // The managed service remains running until fixture cleanup. All replaced
        // boots must already have completed their actual async close hook once.
        if (!boots.slice(0, -1).every(boot => closed.filter(row => row.bootId === boot).length === 1)) code = 1;
    }
} finally {
    releaseModel(); await model?.stop(true);
    if (model) await writeFile(join(output, 'model-requests.json'), JSON.stringify(modelRequests));
    let cleanupError = false;
    try { await managed?.stop(); } catch { code = 1; cleanupError = true; }
    try {
        for (const ownedPort of [port, ...(httpsPort ? [httpsPort] : [])]) {
            const probe = createServer();
            await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(ownedPort, '127.0.0.1', resolve); });
            await new Promise<void>(resolve => probe.close(() => resolve()));
        }
        portClosed = true;
    } catch { code = 1; }
    // Retain the deployment definition if container cleanup failed, so it can be
    // inspected and removed by its exact project identity instead of orphaned.
    if (!cleanupError) await rm(data, { recursive: true, force: true });
    await writeFile(join(output, 'result.json'), JSON.stringify({ mode, target, backgroundProvider: model ? backgroundProvider : null, https: Boolean(httpsPort), exitCode: code, runtime: Bun.version, portClosed, temporaryDataRemoved: !cleanupError,
        ...(cleanupError ? { cleanupDirectory: data } : {}) }, null, 2));
}
process.exitCode = code;
