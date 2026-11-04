#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { prepareSourceSecrets } from '../../shared/dev/secrets';

const archive = process.env.OR3_AI_WORKFLOW_ARCHIVE;
if (!archive) throw new Error('Set OR3_AI_WORKFLOW_ARCHIVE to the Workflows V2 package archive.');
const archiveSha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
const output = resolve(process.env.OR3_AI_GOVERNANCE_OUTPUT_DIR ?? 'output/ai-router-qualification/governance');
await mkdir(output, { recursive: true });
const data = await realpath(await mkdtemp('/tmp/or3-ai-governance-'));
const fixtureDir = join(data, 'fixture');
await mkdir(fixtureDir);
const fixtureId = 'or3.ai-governance-fixture';
const manifest = { manifestVersion: 2, kind: 'plugin', id: fixtureId, name: 'AI Governance Fixture', version: '1.0.0',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' }, runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'host' } },
    requestedGrants: ['ai.provider', 'network.http'], features: { required: [], optional: [] }, dependencies: { required: [], optional: [] },
    trust: 'trusted-host', settings: { version: 1 }, stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' } };
await writeFile(join(fixtureDir, 'or3.manifest.json'), JSON.stringify(manifest));
await writeFile(join(fixtureDir, 'package.json'), JSON.stringify({ name: 'or3-ai-governance-fixture', version: '1.0.0', type: 'module' }));
await writeFile(join(fixtureDir, 'client.mjs'), `export default { manifest: ${JSON.stringify(manifest)}, setup() {} };\n`);
const fixtureArchive = join(data, 'fixture.zip');
const zip = Bun.spawn(['zip', '-q', fixtureArchive, 'or3.manifest.json', 'package.json', 'client.mjs'], { cwd: fixtureDir, stdout: 'ignore', stderr: 'inherit' });
if (await zip.exited) throw new Error('Unable to create the disposable plugin fixture archive.');
const captured: Array<{ path: string; authorized: boolean; credentialClass: string; body: unknown }> = [];
const model = (id: string) => ({ id, canonical_slug: id, name: id, created: 0, context_length: 100_000,
    default_parameters: null, per_request_limits: null, supported_voices: null, links: { details: 'https://example.test/' },
    pricing: { prompt: '0.000001', completion: '0.000001' },
    architecture: { input_modalities: ['text'], output_modalities: ['text'], modality: 'text->text' },
    top_provider: { context_length: 100_000, max_completion_tokens: 4096, is_moderated: false }, supported_parameters: ['tools'] });
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/__capture') return Response.json({ requests: captured });
    if (path === '/api/v1/models') return Response.json({ data: [model('fixture/model'), model('fixture/expensive'),
        model('openai/gpt-4o-mini'), model('~openai/gpt-luna-latest')], links: { next: null }, total_count: 4 });
    if (path !== '/api/v1/chat/completions' || request.method !== 'POST') return new Response('Unknown fixture endpoint', { status: 404 });
    const body = await request.json() as { model: string; stream?: boolean; messages?: Array<{ content?: unknown }> };
    const authorization = request.headers.get('authorization');
    const credentialClass = authorization === 'Bearer disposable-governed-key' ? 'instance'
        : authorization === 'Bearer sk-or-personal-fixture-123456' ? 'personal' : 'unexpected';
    captured.push({ path, authorized: credentialClass === 'instance', credentialClass, body });
    const prompt = String(body.messages?.at(-1)?.content ?? '');
    if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Governed fixture reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return Response.json({ choices: [{ message: { content: 'Governed fixture reply' }, finish_reason: 'stop' }],
        ...(prompt.includes('missing usage') ? {} : { usage: { prompt_tokens: 10, completion_tokens: 3 } }) });
} });
const listener = createServer();
await new Promise<void>((accept, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', accept); });
const port = (listener.address() as { port: number }).port;
await new Promise<void>((accept, reject) => listener.close(error => error ? reject(error) : accept()));
const providerUrl = `http://127.0.0.1:${provider.port}`;
const environment: Record<string, string> = {
    PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? '/tmp',
    OR3_LOCAL_PROVIDERS: 'false', OR3_USE_LOCAL_PACKAGES: 'false', SSR_AUTH_ENABLED: 'true',
    AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth', OR3_AUTH_REGISTRATION_MODE: 'invite_only',
    OR3_AUTH_AUTO_PROVISION: 'false', OR3_GUEST_ACCESS_ENABLED: 'false',
    OR3_BASIC_AUTH_DB_PATH: join(data, 'auth.sqlite'), OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'ai-router@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableAiRouter!123',
    OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite', OR3_SQLITE_DRIVER: 'better-sqlite3',
    OR3_SQLITE_DB_PATH: join(data, 'sync.sqlite'), OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_STORAGE_FS_ROOT: join(data, 'storage'), OR3_STORAGE_FS_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BACKGROUND_STREAMING_ENABLED: 'true', OR3_BACKGROUND_STREAMING_PROVIDER: 'sqlite', OR3_BACKGROUND_ENCRYPTION_KEY: crypto.randomUUID() + crypto.randomUUID(),
    OR3_EXTENSIONS_ROOT: join(data, 'extensions'), OR3_ADMIN_DATA_DIR: join(data, 'admin'),
    OR3_ADMIN_USERNAME: 'ai-router-admin', OR3_ADMIN_PASSWORD: 'DisposableAiRouterAdmin!123', OR3_ADMIN_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_PLUGIN_MODULE_LOADER_V2_ENABLED: 'true', OR3_PLUGIN_RUNTIME_V2_ENABLED: 'true', OR3_PLUGIN_ISOLATION_ENABLED: 'true',
    OR3_PLUGIN_ALLOWED_MODELS: 'fixture/model,fixture/expensive',
    OR3_PLUGIN_MODEL_PRICES: JSON.stringify({ 'fixture/model': { promptPerMillion: 1, completionPerMillion: 1 },
        'fixture/expensive': { promptPerMillion: 1_000_000, completionPerMillion: 1_000_000 } }),
    NUXT_SECRETS_PROVIDER: '', OR3_OPENROUTER_BASE_URL: `${providerUrl}/api/v1`, NUXT_OPENROUTER_BASE_URL: `${providerUrl}/api/v1`,
    PW_PORT: String(port), PW_SKIP_WEB_SERVER: 'true', OR3_AI_GOVERNANCE_HARNESS: 'true',
    OR3_AI_WORKFLOW_ARCHIVE: resolve(archive), OR3_AI_WORKFLOW_SHA256: archiveSha256,
    OR3_AI_TEST_ARCHIVE: fixtureArchive, OR3_AI_TEST_PLUGIN_ID: fixtureId, OR3_AI_GOVERNANCE_OUTPUT: output, OR3_AI_FIXTURE_URL: providerUrl,
    OR3_WORKFLOW_INSTALLED_TEST_HARNESS: 'true', OR3_WORKFLOW_NO_MODEL_SMOKE: 'true',
    OR3_WORKFLOW_INSTALLED_TEST_EMAIL: 'ai-router@example.test', OR3_WORKFLOW_INSTALLED_TEST_PASSWORD: 'DisposableAiRouter!123',
};
let server: ReturnType<typeof Bun.spawn> | undefined;
let log: number | undefined;
async function stopServer() {
    if (!server) return;
    server.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended = await Promise.race([server.exited.then(() => true), new Promise<boolean>(accept => { timer = setTimeout(() => accept(false), 30_000); })]);
    clearTimeout(timer);
    if (!ended) { server.kill('SIGKILL'); await server.exited; }
    server = undefined;
    if (log !== undefined) closeSync(log);
    log = undefined;
}
async function startServer(instanceKey: string, label: string, root = process.env.OR3_AI_TEST_HOST_ROOT ?? process.cwd()) {
    log = openSync(join(output, `${label}-server.log`), 'w');
    server = Bun.spawn(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], { env: { ...environment,
        ...(root === process.env.OR3_AI_WORKFLOW_PRIOR_ROOT ? { NUXT_SECRETS_PROVIDER: '' } : {}),
        OPENROUTER_API_KEY: instanceKey, OR3_OPENROUTER_API_KEY: instanceKey, NUXT_OPENROUTER_API_KEY: instanceKey },
        cwd: root, stdout: log, stderr: log });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) throw new Error(`${label} server exited; inspect ${output}/${label}-server.log`);
        if (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(4_000) }).then(response => response.ok, () => false)) return;
        await Bun.sleep(250);
    }
    throw new Error(`${label} server startup timed out`);
}
async function runBrowser(file: string, label: string, extra: string[] = [], overrides: Record<string, string> = {}) {
    const child = Bun.spawn(['bunx', 'playwright', 'test', file, '--workers=1', '--reporter=line',
        '--output', join(output, label), ...extra], { env: { ...environment, ...overrides }, stdout: 'inherit', stderr: 'inherit' });
    const code = await child.exited;
    if (code) throw new Error(`${label} browser qualification failed (${code})`);
}
let success = false;
let vaultOwner: Awaited<ReturnType<typeof prepareSourceSecrets>> | undefined;
async function makeFixtureWritable(path: string): Promise<void> {
    const info = await lstat(path).catch(() => null);
    if (!info?.isDirectory()) return;
    await chmod(path, info.mode | 0o700);
    for (const entry of await readdir(path)) await makeFixtureWritable(join(path, entry));
}
try {
    // The installed-workflow journey uses a personal key. Give it a genuine
    // disposable local vault, rather than weakening Cloud credential policy.
    await symlink(join(process.cwd(), 'node_modules'), join(data, 'node_modules'));
    await writeFile(join(data, 'package.json'), '{}');
    vaultOwner = await prepareSourceSecrets(data, { PATH: process.env.PATH, HOME: process.env.HOME,
        SSR_AUTH_ENABLED: 'true', NODE_ENV: 'development' }, { mode: 'auto' });
    Object.assign(environment, Object.fromEntries(Object.entries(vaultOwner.env).filter(([key]) => key.startsWith('NUXT_SECRETS_'))));
    const priorRoot = process.env.OR3_AI_WORKFLOW_PRIOR_ROOT;
    if (priorRoot && process.env.OR3_AI_GOVERNANCE_ONLY !== 'true') {
        // Initialize all stores on the historical host first, using its real
        // installation canary; the current host then upgrades those same stores.
        await startServer('disposable-governed-key', 'workflow-prior', priorRoot);
        await runBrowser('tests/e2e/ai-router-governance.spec.ts', 'workflow-install', [], {
            OR3_AI_TEST_ARCHIVE: resolve(archive), OR3_AI_TEST_PLUGIN_ID: 'or3-workflows', OR3_AI_INSTALL_ONLY: 'true',
        });
        await stopServer();
        if (process.env.OR3_AI_WORKFLOW_INSTALL_ONLY !== 'true') {
            await startServer('', 'workflow');
            await runBrowser('tests/e2e/workflows-installed.spec.ts', 'workflow-browser', ['--grep', 'imports and executes a no-model workflow']);
            await stopServer();
            await startServer('disposable-governed-key', 'governance');
            await runBrowser('tests/e2e/ai-router-governance.spec.ts', 'governance-browser');
        }
    } else {
        await startServer('disposable-governed-key', 'governance');
        if (process.env.OR3_AI_WORKFLOW_INSTALL_ONLY !== 'true')
            await runBrowser('tests/e2e/ai-router-governance.spec.ts', 'governance-browser',
                process.env.OR3_AI_GOVERNANCE_GREP ? ['--grep', process.env.OR3_AI_GOVERNANCE_GREP] : []);
        if (process.env.OR3_AI_GOVERNANCE_ONLY !== 'true') {
            await runBrowser('tests/e2e/ai-router-governance.spec.ts', 'workflow-install', [], {
                OR3_AI_TEST_ARCHIVE: resolve(archive), OR3_AI_TEST_PLUGIN_ID: 'or3-workflows', OR3_AI_INSTALL_ONLY: 'true',
            });
            await stopServer();
            if (process.env.OR3_AI_WORKFLOW_INSTALL_ONLY !== 'true') {
                await startServer('', 'workflow');
                await runBrowser('tests/e2e/workflows-installed.spec.ts', 'workflow-browser', ['--grep', 'imports and executes a no-model workflow']);
            }
        }
    }
    success = true;
} finally {
    await stopServer(); await provider.stop(true); await vaultOwner?.close(); await makeFixtureWritable(data); await rm(data, { recursive: true, force: true });
    await writeFile(join(output, 'run.json'), JSON.stringify({ success, archiveSha256, governanceOnly: process.env.OR3_AI_GOVERNANCE_ONLY === 'true',
        workflowInstallOnly: process.env.OR3_AI_WORKFLOW_INSTALL_ONLY === 'true', hostRoot: process.env.OR3_AI_TEST_HOST_ROOT ?? process.cwd(),
        workflowPriorRoot: process.env.OR3_AI_WORKFLOW_PRIOR_ROOT ?? null,
        profile: 'disposable Basic Auth, SQLite, filesystem, loopback scripted model', temporaryDataRemoved: true }, null, 2));
}
