import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { parse as parseEnv } from 'dotenv';
import { fixtureCall, sseFrame, toolResponse } from '../../tests/e2e/fixtures/chat-tool-script';
import { createDelegationLiveProxy } from './delegation-live-proxy';

const jobProvider = process.env.OR3_CHAT_TOOLS_JOB_PROVIDER ?? 'memory';
if (jobProvider !== 'memory' && jobProvider !== 'sqlite') {
    throw new Error('OR3_CHAT_TOOLS_JOB_PROVIDER must be memory or sqlite.');
}
const sqlitePackage = await Bun.file('node_modules/or3-provider-sqlite/package.json').json() as { version: string };
const captured: { mode: string; toolResults: number }[] = [];
const draftDelegation = process.env.OR3_DELEGATION_DRAFT_E2E === 'true';
const liveDurable = process.env.OR3_DELEGATION_LIVE_DURABLE === 'true';
const liveSimulation = process.env.OR3_DELEGATION_LIVE_SIMULATION === 'true';
if (liveSimulation && (!liveDurable || !draftDelegation)) throw new Error('The simulated live profile requires the isolated draft.');
if (liveDurable && ((draftDelegation && !liveSimulation) || jobProvider !== 'sqlite' || !process.env.OR3_LIVE_ENV_PATH))
    throw new Error('The durable live profile requires installed SQLite and an explicit environment file.');
const liveModel = process.env.OR3_DELEGATION_LIVE_MODEL ?? 'openai/gpt-6-luna';
if (liveDurable && !/^[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~:-]*$/i.test(liveModel))
    throw new Error('The durable live model must be an exact provider/model ID.');
const proxyToken = crypto.randomUUID() + crypto.randomUUID();
const liveKey = liveDurable ? parseEnv(await readFile(process.env.OR3_LIVE_ENV_PATH!, 'utf8')).OPENROUTER_API_KEY : undefined;
if (liveDurable && !liveKey) throw new Error('OPENROUTER_API_KEY is missing from the environment file.');
if (liveSimulation && liveKey !== 'disposable-fixture-key') throw new Error('The simulated profile requires its disposable fixture key.');
const fixtureForward: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/models')) return Response.json({ data: [{ id: liveModel, canonical_slug: liveModel,
        name: 'Fixture', created: 0, context_length: 100_000, default_parameters: null, per_request_limits: null,
        supported_voices: null, links: { details: 'https://example.test/fixture' }, pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'], output_modalities: ['text'], modality: 'text->text' },
        top_provider: { context_length: 100_000, max_completion_tokens: 4096, is_moderated: false }, supported_parameters: ['tools'] }],
        links: { next: null }, total_count: 1 });
    const body = JSON.parse(String(init?.body)) as { tools?: { function?: { name?: string } }[]; messages: { role: string }[] };
    const parent = body.tools?.some(tool => tool.function?.name === 'delegate_chat');
    const data = parent && !body.messages.some(message => message.role === 'tool')
        ? toolResponse([{ id: 'live-fixture-call', name: 'delegate_chat', args: JSON.stringify({ task: 'Reply exactly JADE ORCHID', model: liveModel }) }])
        : sseFrame({ content: 'JADE ORCHID' }, 'stop') + 'data: [DONE]\n\n';
    return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
};
const liveProxy = liveKey ? createDelegationLiveProxy({ apiKey: liveKey, proxyToken, models: [liveModel],
    ...(liveSimulation ? { forward: fixtureForward } : {}) }) : undefined;
const directory = await mkdtemp('/tmp/or3-chat-tools-cloud-');
const managedServer = draftDelegation && process.env.OR3_DELEGATION_MANAGED_SERVER === 'true';
const safeGate = managedServer && process.env.OR3_DELEGATION_SAFE_GATE === 'true';
const settledRestart = safeGate && process.env.OR3_DELEGATION_SETTLED_RESTART === 'true';
const holdParent = managedServer && process.env.OR3_DELEGATION_HOLD_PARENT === 'true';
const gatePath = join(directory, 'coordinator-gate');
let crashAndRestart: (() => Promise<void>) | undefined;
let restartCount = 0;
const controlToken = crypto.randomUUID();
const delegationRequests: string[] = [];
let delegationModelOutcomes: string[] = [];
let delegationParentToolResults = 0;
let searchedModelIds: string[] = [];
let childModel = '';
let releaseChildren!: () => void;
const childrenHeld = new Promise<void>(resolve => { releaseChildren = resolve; });
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (liveDurable && url.pathname === '/control' && request.headers.get('x-fixture-token') === controlToken) {
        if (request.method === 'POST') liveProxy!.release();
        return Response.json(liveProxy!.snapshot());
    }
    if (liveDurable) return liveProxy!.handle(request);
    if (draftDelegation && url.pathname === '/control' && request.headers.get('x-fixture-token') === controlToken) {
        if (request.method === 'POST' && url.searchParams.get('action') === 'crash') {
            if (!crashAndRestart) return new Response('Managed restart unavailable', { status: 409 });
            try { await crashAndRestart(); } catch (error) {
                console.error('Disposable server restart failed:', error);
                return new Response('Disposable server restart failed', { status: 500 });
            }
        } else if (request.method === 'POST' && url.searchParams.get('action') === 'resume' && safeGate) {
            await rm(gatePath, { force: true });
        } else if (request.method === 'POST' && url.searchParams.get('action') === 'pause' && settledRestart) {
            await writeFile(gatePath, 'paused');
        } else if (request.method === 'POST') releaseChildren();
        let checkpoint: { idleParents: number; completedChildren: number; settlements: number } | undefined;
        if (settledRestart) {
            const db = new Database(join(directory, 'sync.sqlite'), { readonly: true });
            try {
                const counts = db.query(`SELECT
                    (SELECT COUNT(*) FROM background_jobs WHERE status = 'streaming' AND lease_owner IS NULL
                        AND json_type(execution_json, '$.delegationWait') IS NOT NULL) AS idleParents,
                    (SELECT COUNT(*) FROM background_jobs WHERE delegation_parent_id IS NOT NULL
                        AND status = 'complete' AND history_phase = 'committed') AS completedChildren,
                    (SELECT COUNT(*) FROM background_jobs, json_each(execution_json, '$.delegationWait.children')
                        WHERE json_type(value, '$.settlement') IS NOT NULL) AS settlements`).get();
                checkpoint = counts as typeof checkpoint;
            } finally { db.close(); }
        }
        return Response.json({ requests: delegationRequests, restartCount, modelOutcomes: delegationModelOutcomes,
            parentToolResults: delegationParentToolResults, searchedModelIds, childModel, checkpoint });
    }
    if (draftDelegation && request.method === 'GET' && url.pathname === '/api/v1/models') {
        const model = { id: 'fixture/model', canonical_slug: 'fixture/model', name: 'Fixture', created: 0,
            context_length: 100_000, default_parameters: null, per_request_limits: null, supported_voices: null,
            links: { details: 'https://example.test/fixture' }, pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'], modality: 'text->text' },
            top_provider: { context_length: 100_000, max_completion_tokens: 4096, is_moderated: false },
            supported_parameters: ['tools'] };
        return Response.json({ data: [model, ...['6.1', '6.10'].map(version => ({ ...model,
            id: `openai/gpt-${version}-terra`, canonical_slug: `openai/gpt-${version}-terra`, name: `GPT-${version} Terra` }))],
            links: { next: null }, total_count: 3 });
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/v1/chat/completions')
        return Response.json({ data: [] });
    const body = await request.json() as { model: string; stream?: boolean; messages: { role: string; content: string | { type: string; text?: string }[] }[]; tools: { function: { name: string } }[] };
    if (draftDelegation) {
        if (body.stream === false) return Response.json({ choices: [{ message: { content: 'Research' }, finish_reason: 'stop' }] });
        const content = body.messages.find(message => message.role === 'user')?.content;
        const user = typeof content === 'string' ? content : content?.map(part => part.text ?? '').join('');
        if (user === 'durable-search') {
            const results = body.messages.filter(message => message.role === 'tool');
            delegationRequests.push(results.length === 0 ? 'parent-search' : results.length === 1 ? 'parent-delegate' : 'parent-resume');
            if (results.length === 1) {
                const value = results[0]!.content;
                const content = typeof value === 'string' ? value : value.map(part => part.text ?? '').join('');
                searchedModelIds = (JSON.parse(content) as { models: { id: string }[] }).models.map(model => model.id);
            }
            const data = results.length === 0 ? toolResponse([{ id: 'find-model', name: 'search_models', args: '{"query":"terra 6.1"}' }])
                : results.length === 1 ? toolResponse([{ id: 'durable-delegate', name: 'delegate_chat',
                    args: JSON.stringify({ task: 'durable-child-one', model: 'terra 6.1' }) }])
                    : sseFrame({ content: 'Research finished.' }, 'stop') + 'data: [DONE]\n\n';
            return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
        }
        if (user === 'durable-parent' || user === 'durable-single') {
            const toolResults = body.messages.filter(message => message.role === 'tool').length;
            delegationRequests.push(toolResults ? 'parent-resume' : 'parent-initial');
            if (toolResults) delegationParentToolResults = toolResults;
            if (!toolResults && holdParent) await childrenHeld;
            if (toolResults) {
                const tool = body.messages.find(message => message.role === 'tool')!;
                const content = typeof tool.content === 'string' ? tool.content : tool.content.map(part => part.text ?? '').join('');
                const result = JSON.parse(content) as { status?: string; results?: { status: string }[] };
                delegationModelOutcomes = result.results?.map(item => item.status) ?? (result.status ? [result.status] : []);
            }
            const unknown = delegationModelOutcomes.includes('unknown');
            const data = toolResults ? sseFrame({ content: unknown ? 'Some results are unknown.' : 'Both research tasks finished.' }, 'stop') + 'data: [DONE]\n\n'
                : toolResponse([{ id: 'durable-delegate', name: 'delegate_chat', args: JSON.stringify(user === 'durable-single'
                    ? { task: 'durable-child-one', model: 'fixture/model', variant: 'nitro' } : { tasks: [
                    { task: 'durable-child-one', model: 'fixture/model' }, { task: 'durable-child-two', model: 'fixture/model' },
                ] }) }]);
            return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
        }
        if (user === 'durable-child-one' || user === 'durable-child-two') {
            delegationRequests.push(user);
            childModel = body.model;
            await childrenHeld;
            return new Response(sseFrame({ content: `${user} result` }, 'stop') + 'data: [DONE]\n\n',
                { headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response('Unexpected draft fixture request', { status: 400 });
    }
    const [, mode, id] = (body.messages.find(message => message.role === 'user')!.content as string).split(':');
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
let server: ReturnType<typeof Bun.spawn> | undefined;
async function stopServer() {
    if (!server) return;
    const running = server;
    running.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const ended = await Promise.race([running.exited.then(() => true), new Promise<boolean>(resolve => {
            timer = setTimeout(() => resolve(false), 30_000);
        })]);
        if (!ended) { running.kill('SIGKILL'); await running.exited; }
    } finally { clearTimeout(timer); server = undefined; }
}
try {
    const environment = { ...process.env,
            SSR_AUTH_ENABLED: 'true', AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth',
            OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', OR3_GUEST_ACCESS_ENABLED: 'false',
            OR3_LOCAL_PROVIDERS: 'false', OR3_USE_LOCAL_PACKAGES: 'false',
            OR3_BASIC_AUTH_DB_PATH: join(directory, 'auth.sqlite'), OR3_BASIC_AUTH_JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_REFRESH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'chat-tools@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'DisposableToolSuite!123',
            OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite',
            OR3_SQLITE_DB_PATH: join(directory, 'sync.sqlite'), OR3_SQLITE_DRIVER: 'better-sqlite3',
            OR3_STORAGE_ENABLED: 'false', OR3_CLOUD_STORAGE_ENABLED: 'false',
            OR3_BACKGROUND_STREAMING_ENABLED: 'true', OR3_BACKGROUND_STREAMING_PROVIDER: jobProvider,
            OR3_CHAT_TOOLS_CLOUD_TEST_HARNESS: 'true',
            OR3_DELEGATION_FIXTURE_URL: draftDelegation || liveDurable ? `http://127.0.0.1:${provider.port}/control` : '',
            OR3_DELEGATION_FIXTURE_TOKEN: draftDelegation || liveDurable ? controlToken : '',
            OR3_BACKGROUND_ENCRYPTION_KEY: crypto.randomUUID() + crypto.randomUUID(),
            OR3_ADMIN_DATA_DIR: join(directory, 'admin'),
            // This harness uses only the server-managed fixture key.
            NUXT_SECRETS_PROVIDER: '',
            OPENROUTER_API_KEY: liveDurable ? proxyToken : 'disposable-fixture-key',
            OR3_OPENROUTER_API_KEY: liveDurable ? proxyToken : 'disposable-fixture-key',
            NUXT_OPENROUTER_API_KEY: liveDurable ? proxyToken : 'disposable-fixture-key',
            OR3_DELEGATION_LIVE_MODEL: liveModel,
            NUXT_OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.port}/api/v1`,
            OR3_OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.port}/api/v1`,
            PW_PORT: String(port), PW_SKIP_WEB_SERVER: managedServer ? 'true' : 'false',
            OR3_DELEGATION_PROCESS_FILE: join(directory, 'server.pid'),
            OR3_DELEGATION_COORDINATOR_GATE: safeGate ? gatePath : '',
            PLAYWRIGHT_JSON_OUTPUT_NAME: join(process.cwd(), `test-results/${liveDurable ? 'chat-delegation-durable-live' : 'chat-tools-cloud'}/results.json`),
    };
    const startServer = async () => {
        await rm(environment.OR3_DELEGATION_PROCESS_FILE, { force: true });
        server = Bun.spawn(['bun', 'run', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
            stdout: 'inherit', stderr: 'inherit', env: environment,
        });
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
            if (server.exitCode !== null) throw new Error(`Disposable server exited: ${server.exitCode}`);
            try {
                const ready = await fetch(`http://127.0.0.1:${port}/api/ready`);
                if (ready.ok && await readFile(environment.OR3_DELEGATION_PROCESS_FILE, 'utf8')) return;
            } catch { /* Startup is still in progress. */ }
            await Bun.sleep(250);
        }
        throw new Error('Disposable server did not become ready.');
    };
    if (managedServer) {
        if (safeGate && !settledRestart) await writeFile(gatePath, 'paused');
        await startServer();
        crashAndRestart = async () => {
            const pid = Number(await readFile(environment.OR3_DELEGATION_PROCESS_FILE, 'utf8'));
            if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
                throw new Error('Invalid disposable server PID.');
            const group = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
            if (group !== pid) throw new Error('Disposable server is not the leader of its private process group.');
            process.kill(-pid, 'SIGKILL');
            await stopServer();
            await startServer();
            restartCount++;
        };
    }
    const child = Bun.spawn(['bunx', 'playwright', 'test', liveDurable ? 'tests/e2e/chat-delegation-durable-live.spec.ts' : 'tests/e2e/chat-tools-cloud.spec.ts', '--workers=1', '--reporter=line,json',
        `--output=test-results/${liveDurable ? 'chat-delegation-durable-live' : 'chat-tools-cloud'}/browser`, ...process.argv.slice(2)], {
        stdout: 'inherit', stderr: 'inherit', env: environment,
    });
    exitCode = await child.exited;
    process.exitCode = exitCode;
    releaseChildren();
    liveProxy?.release();
    await stopServer();
} finally {
    releaseChildren();
    liveProxy?.release();
    await stopServer();
    await provider.stop(true);
    await rm(directory, { recursive: true, force: true });
    const outputDirectory = `test-results/${liveDurable ? 'chat-delegation-durable-live' : 'chat-tools-cloud'}`;
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(`${outputDirectory}/receipt.json`, JSON.stringify({
        commit: execFileSync('git', ['-C', process.env.OR3_E2E_SOURCE_ROOT ?? process.cwd(), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirty: !!execFileSync('git', ['-C', process.env.OR3_E2E_SOURCE_ROOT ?? process.cwd(), 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
        command: liveDurable ? 'OR3_DELEGATION_LIVE_PROFILE=durable bun run test:e2e:chat-delegation:live' : 'bun run test:e2e:chat-tools:cloud', timestamp: new Date().toISOString(),
        arguments: process.argv.slice(2),
        profile: `Basic Auth + ${draftDelegation ? 'unpublished test-modified draft' : 'installed'} SQLite ${sqlitePackage.version} + ${jobProvider} job provider + ${liveDurable && !liveSimulation ? 'guarded real model' : 'loopback scripted model'}`,
        ...(liveDurable ? { model: liveModel, guardedRequests: liveProxy?.snapshot() } : {}),
        ...(draftDelegation ? { testOnlyCapabilityOverride: true, installedOrReleasedQualification: false,
            delegationRequests, delegationModelOutcomes, delegationParentToolResults, restartCount,
            testOnlyCoordinatorGate: safeGate, testOnlyParentHold: holdParent } : {}),
        exitCode, temporaryDataRemoved: true, requests: captured,
    }, null, 2));
}
