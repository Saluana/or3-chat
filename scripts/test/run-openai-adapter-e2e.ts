#!/usr/bin/env bun
// Direct-OpenAI adapter journey: a real local vault, the fixed Cloud profile and one
// scripted upstream that answers both OpenRouter and a strict Chat Completions surface.
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { prepareSourceSecrets } from '../../shared/dev/secrets';

const output = resolve(process.env.OR3_OPENAI_E2E_OUTPUT_DIR ?? 'output/openai-adapter-e2e');
await mkdir(output, { recursive: true });
const data = await realpath(await mkdtemp('/tmp/or3-openai-adapter-'));
const instanceOpenRouterKey = 'disposable-openrouter-instance-key';
const adminPassword = crypto.randomUUID();

type Captured = { path: string; credential: 'personal-openai' | 'instance-openrouter' | 'other'; model?: unknown; keys: string[];
    messageKeys: string[]; reasoningEffort?: unknown; maxCompletionTokens?: unknown; includeUsage?: unknown; tools: string[] };
const requests: Captured[] = [];
let personalOpenAiKey = '';
const OPENAI_KEYS = new Set(['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice', 'parallel_tool_calls',
    'max_completion_tokens', 'reasoning_effort', 'temperature', 'top_p', 'stop', 'seed', 'response_format',
    'frequency_penalty', 'presence_penalty', 'logit_bias', 'user']);
const openRouterModel = { id: 'fixture/router', canonical_slug: 'fixture/router', name: 'Fixture Router', created: 0,
    context_length: 100_000, default_parameters: null, per_request_limits: null, supported_voices: null,
    links: { details: 'https://example.test/fixture' }, pricing: { prompt: '0', completion: '0' },
    architecture: { input_modalities: ['text'], output_modalities: ['text'], modality: 'text->text' },
    top_provider: { context_length: 100_000, max_completion_tokens: 4096, is_moderated: false }, supported_parameters: ['tools', 'max_tokens'] };
const sse = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text } }] })}\n\n`
    + `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } })}\n\n`
    + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__capture') return Response.json({ requests });
    if (url.pathname === '/__key' && request.method === 'POST') { personalOpenAiKey = await request.text(); return new Response('ok'); }
    const auth = request.headers.get('authorization') ?? '';
    const credential = personalOpenAiKey && auth === `Bearer ${personalOpenAiKey}` ? 'personal-openai'
        : auth === `Bearer ${instanceOpenRouterKey}` ? 'instance-openrouter' : 'other';
    if (url.pathname === '/api/v1/models') return Response.json({ data: [openRouterModel], links: { next: null }, total_count: 1 });
    if (url.pathname === '/v1/models') {
        if (credential !== 'personal-openai') return Response.json({ error: { message: 'Incorrect API key provided.' } }, { status: 401 });
        return Response.json({ object: 'list', data: ['gpt-e2e-mini', 'o9-e2e', 'text-embedding-e2e'].map(id => ({ id, object: 'model', created: 1, owned_by: 'openai' })) });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown> & { messages?: Record<string, unknown>[] };
    requests.push({ path: url.pathname, credential, model: body.model, keys: Object.keys(body).sort(),
        messageKeys: [...new Set((body.messages ?? []).flatMap(message => Object.keys(message)))].sort(),
        reasoningEffort: body.reasoning_effort, maxCompletionTokens: body.max_completion_tokens,
        includeUsage: (body.stream_options as { include_usage?: unknown } | undefined)?.include_usage,
        tools: Array.isArray(body.tools) ? body.tools.map(tool => (tool as { function?: { name?: string } }).function?.name ?? '') : [] });
    if (url.pathname === '/v1/decisions') {
        if (credential !== 'personal-openai') return Response.json({ error: { message: 'Incorrect API key provided.' } }, { status: 401 });
        const questions = body.questions as Array<{ name?: string; choices?: Array<{ value: string }> }> | undefined;
        // The native contract: a JSON-text input, named questions with choices, and an answers array.
        if (typeof body.input !== 'string' || !Array.isArray(questions) || 'state' in body)
            return Response.json({ error: { message: 'Invalid Decisions request.' } }, { status: 400 });
        return Response.json({ model: body.model, answers: questions.map(question => ({ type: 'choice', name: question.name,
            choice: question.choices![1]!.value, confidence: 0.97, probabilities: question.choices!.map((choice, index) =>
                ({ value: choice.value, probability: index === 1 ? 0.98 : index === 0 ? 0.02 : 0 })) })),
        usage: { input_tokens: 40, output_tokens: 0, total_tokens: 40 } });
    }
    if (url.pathname === '/v1/chat/completions') {
        // The real API refuses unknown arguments and keys.
        if (credential !== 'personal-openai') return Response.json({ error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } }, { status: 401 });
        const extra = Object.keys(body).filter(key => !OPENAI_KEYS.has(key));
        if (extra.length) return Response.json({ error: { message: `Unrecognized request argument supplied: ${extra.join(', ')}` } }, { status: 400 });
        return body.stream === false ? Response.json({ choices: [{ message: { content: 'Fixture title' } }] }) : sse('OpenAI fixture reply');
    }
    if (url.pathname === '/api/v1/chat/completions')
        return body.stream === false ? Response.json({ choices: [{ message: { content: 'Fixture title' } }] }) : sse('OpenRouter fixture reply');
    return new Response('Not found', { status: 404 });
} });

const port = await new Promise<number>((accept, reject) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => typeof address === 'object' && address ? accept(address.port) : reject(new Error('No port')));
    });
});
const environment: Record<string, string> = {
    PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? '/tmp',
    OR3_LOCAL_PROVIDERS: 'false', OR3_USE_LOCAL_PACKAGES: 'false', SSR_AUTH_ENABLED: 'true',
    AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth', OR3_AUTH_REGISTRATION_MODE: 'invite_only',
    OR3_AUTH_AUTO_PROVISION: 'false', OR3_GUEST_ACCESS_ENABLED: 'false',
    OR3_BASIC_AUTH_DB_PATH: join(data, 'auth.sqlite'), OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'openai-adapter@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableOpenAiAdapter!123',
    OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite', OR3_SQLITE_DRIVER: 'better-sqlite3',
    OR3_SQLITE_DB_PATH: join(data, 'sync.sqlite'), OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_STORAGE_FS_ROOT: join(data, 'storage'), OR3_STORAGE_FS_TOKEN_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OR3_BACKGROUND_STREAMING_ENABLED: 'true', OR3_BACKGROUND_STREAMING_PROVIDER: 'sqlite', OR3_BACKGROUND_ENCRYPTION_KEY: crypto.randomUUID() + crypto.randomUUID(),
    OR3_ADMIN_DATA_DIR: join(data, 'admin'),
    // Only a deployment admin saves the workspace fast model.
    OR3_ADMIN_USERNAME: 'openai-adapter-admin', OR3_ADMIN_PASSWORD: adminPassword, OR3_ADMIN_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    OPENROUTER_API_KEY: instanceOpenRouterKey, OR3_OPENROUTER_API_KEY: instanceOpenRouterKey, NUXT_OPENROUTER_API_KEY: instanceOpenRouterKey,
    OR3_OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.port}/api/v1`, NUXT_OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.port}/api/v1`,
    OR3_OPENAI_BASE_URL: `http://127.0.0.1:${provider.port}/v1`,
    PW_PORT: String(port), PW_SKIP_WEB_SERVER: 'true', OR3_OPENAI_E2E: 'true', OR3_OPENAI_E2E_FIXTURE_URL: `http://127.0.0.1:${provider.port}`,
    OR3_OPENAI_E2E_OUTPUT: output, OR3_OPENAI_E2E_EMAIL: 'openai-adapter@example.test', OR3_OPENAI_E2E_PASSWORD: 'DisposableOpenAiAdapter!123',
    OR3_OPENAI_E2E_ADMIN_PASSWORD: adminPassword,
};

let server: ReturnType<typeof Bun.spawn> | undefined;
let vault: Awaited<ReturnType<typeof prepareSourceSecrets>> | undefined;
let exitCode = 1;
try {
    // Personal keys need the real vault; never weaken Cloud credential policy for a test.
    await symlink(join(process.cwd(), 'node_modules'), join(data, 'node_modules'));
    await writeFile(join(data, 'package.json'), '{}');
    vault = await prepareSourceSecrets(data, { PATH: process.env.PATH, HOME: process.env.HOME, SSR_AUTH_ENABLED: 'true', NODE_ENV: 'development' }, { mode: 'auto' });
    Object.assign(environment, Object.fromEntries(Object.entries(vault.env).filter(([key]) => key.startsWith('NUXT_SECRETS_'))));
    const log = openSync(join(output, 'server.log'), 'w');
    server = Bun.spawn(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], { env: environment, stdout: log, stderr: log });
    const deadline = Date.now() + 180_000;
    while (!await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(4_000) }).then(response => response.ok, () => false)) {
        if (server.exitCode !== null) throw new Error(`Server exited; inspect ${output}/server.log`);
        if (Date.now() > deadline) throw new Error('Server startup timed out.');
        await Bun.sleep(250);
    }
    closeSync(log);
    const child = Bun.spawn(['bunx', 'playwright', 'test', 'tests/e2e/openai-adapter.spec.ts', '--workers=1', '--reporter=line',
        '--output', join(output, 'browser'), ...process.argv.slice(2)], { env: environment, stdout: 'inherit', stderr: 'inherit' });
    exitCode = await child.exited;
} finally {
    await writeFile(join(output, 'upstream-requests.json'), JSON.stringify(requests, null, 2));
    server?.kill('SIGTERM');
    await server?.exited;
    await provider.stop(true);
    await vault?.close();
    // The vault leaves its custody files read-only.
    await Bun.spawn(['chmod', '-R', 'u+w', data]).exited;
    await rm(data, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(exitCode);
