import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixtureCall, sseFrame, toolResponse } from '../../tests/e2e/fixtures/chat-tool-script';

const directory = await mkdtemp('/tmp/or3-chat-tools-cloud-');
const captured: { mode: string; toolResults: number }[] = [];
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/v1/chat/completions')
        return Response.json({ data: [] });
    const body = await request.json() as { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
    const [, mode, id] = body.messages.find(message => message.role === 'user')!.content.split(':');
    const toolResults = body.messages.filter(message => message.role === 'tool').length;
    captured.push({ mode: mode!, toolResults });
    const needsReplay = (mode === 'duplicate' || mode === 'conflict') && toolResults === 1;
    const data = toolResults === 0 || needsReplay
        ? toolResponse([fixtureCall(id!, body.tools[0]!.function.name, needsReplay && mode === 'conflict' ? 'conflicting value' : 'fixture')])
        : sseFrame({ content: 'Cloud fixture completed.' }, 'stop') + 'data: [DONE]\n\n';
    return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
} });
const portProbe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('probe') });
const port = portProbe.port!;
await portProbe.stop(true);
let exitCode = 1;
try {
    const child = Bun.spawn(['bunx', 'playwright', 'test', 'tests/e2e/chat-tools-cloud.spec.ts', '--workers=1', '--reporter=line,json',
        '--output=test-results/chat-tools-cloud/browser', ...process.argv.slice(2)], {
        stdout: 'inherit', stderr: 'inherit', env: { ...process.env,
            SSR_AUTH_ENABLED: 'true', AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth',
            OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', OR3_GUEST_ACCESS_ENABLED: 'false',
            OR3_LOCAL_PROVIDERS: 'false', OR3_USE_LOCAL_PACKAGES: 'false',
            OR3_BASIC_AUTH_DB_PATH: join(directory, 'auth.sqlite'), OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'chat-tools@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableToolSuite!123',
            OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite',
            OR3_SQLITE_DB_PATH: join(directory, 'sync.sqlite'), OR3_SQLITE_DRIVER: 'better-sqlite3',
            OR3_STORAGE_ENABLED: 'false', OR3_CLOUD_STORAGE_ENABLED: 'false',
            OR3_BACKGROUND_STREAMING_ENABLED: 'true', OR3_BACKGROUND_STREAMING_PROVIDER: 'memory',
            OR3_CHAT_TOOLS_CLOUD_TEST_HARNESS: 'true',
            OR3_BACKGROUND_ENCRYPTION_KEY: crypto.randomUUID() + crypto.randomUUID(),
            OR3_ADMIN_DATA_DIR: join(directory, 'admin'),
            OPENROUTER_API_KEY: 'disposable-fixture-key', OR3_OPENROUTER_API_KEY: 'disposable-fixture-key', NUXT_OPENROUTER_API_KEY: 'disposable-fixture-key',
            NUXT_OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.port}/api/v1`,
            PW_PORT: String(port), PW_SKIP_WEB_SERVER: 'false',
            PLAYWRIGHT_JSON_OUTPUT_NAME: join(process.cwd(), 'test-results/chat-tools-cloud/results.json'),
        },
    });
    exitCode = await child.exited;
    process.exitCode = exitCode;
} finally {
    await provider.stop(true);
    await rm(directory, { recursive: true, force: true });
    await mkdir('test-results/chat-tools-cloud', { recursive: true });
    await writeFile('test-results/chat-tools-cloud/receipt.json', JSON.stringify({
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
        command: 'bun run test:e2e:chat-tools:cloud', timestamp: new Date().toISOString(),
        arguments: process.argv.slice(2),
        profile: 'Basic Auth + installed SQLite + memory job provider + loopback scripted model',
        exitCode, temporaryDataRemoved: true, requests: captured,
    }, null, 2));
}
