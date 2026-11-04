#!/usr/bin/env bun
// Exercise real IndexedDB checkpoints across two independently installed checkouts.
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const candidate = process.cwd();
const base = process.env.OR3_AI_BASE_WORKTREE;
if (!base) throw new Error('Set OR3_AI_BASE_WORKTREE to an independently installed base checkout.');
const sha = (cwd: string) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const versions = { base: { cwd: resolve(base), sha: sha(base) }, candidate: { cwd: candidate, sha: sha(candidate) } };
// Playwright clears its default test-results directory when other suites run.
// Keep this cross-run receipt and its screenshots outside that directory.
const output = resolve('output/ai-router-qualification/cross-version-recovery');
await mkdir(output, { recursive: true });
const listener = createServer();
await new Promise<void>((accept, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', accept); });
const port = (listener.address() as { port: number }).port;
await new Promise<void>((accept, reject) => listener.close(error => error ? reject(error) : accept()));
const origin = `http://127.0.0.1:${port}`;
const env = {
    PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? '/tmp',
    OR3_PRODUCTION_JOURNEY_TEST_HARNESS: 'true', SSR_AUTH_ENABLED: 'false',
    OR3_SYNC_ENABLED: 'false', OR3_CLOUD_SYNC_ENABLED: 'false', OR3_STORAGE_ENABLED: 'false',
    OR3_CLOUD_STORAGE_ENABLED: 'false', OR3_BACKGROUND_STREAMING_ENABLED: 'false',
    OR3_LOCAL_PROVIDERS: 'false', OR3_USE_LOCAL_PACKAGES: 'false', NUXT_SECRETS_PROVIDER: '',
    OPENROUTER_API_KEY: '', OR3_OPENROUTER_API_KEY: '', NUXT_OPENROUTER_API_KEY: '',
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
async function startServer(name: keyof typeof versions) {
    log = openSync(resolve(output, `${name}-server.log`), 'a');
    server = Bun.spawn(['bun', 'run', 'dev', '--', '--or3-offline', '--host', '127.0.0.1', '--port', String(port)],
        { cwd: versions[name].cwd, env, stdout: log, stderr: log });
    await poll(async () => {
        if (server?.exitCode !== null) throw new Error(`${name} server exited; inspect its log.`);
        return fetch(origin).then(response => response.ok).catch(() => false);
    }, `${name} startup`, 120_000);
}
async function poll<T>(read: () => Promise<T>, label: string, timeout = 45_000): Promise<NonNullable<T>> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await read();
        if (value) return value as NonNullable<T>;
        await Bun.sleep(250);
    }
    throw new Error(`Timed out waiting for ${label}`);
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function newContext(options: Parameters<typeof browser.newContext>[0] = {}): Promise<BrowserContext> {
    const context = await browser.newContext(options);
    await context.route('**openrouter.ai/**', route => route.abort());
    await context.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    return context;
}
async function navigate(page: Page) {
    await page.goto(`${origin}/__or3-chat-journey-test?context=1`);
    await page.getByRole('textbox', { name: 'Message input' }).waitFor({ state: 'visible', timeout: 45_000 });
}
async function readAttempt(page: Page) {
    return page.evaluate(async () => {
        const remembered = localStorage.getItem('or3:e2e:production-chat-thread');
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise<IDBDatabase>((accept, reject) => { const req = indexedDB.open(name); req.onsuccess = () => accept(req.result); req.onerror = () => reject(req.error); });
            if (!db.objectStoreNames.contains('chat_request_recoveries')) { db.close(); continue; }
            const tx = db.transaction(['messages', 'chat_request_recoveries'], 'readonly');
            const all = <T>(store: string) => new Promise<T[]>((accept, reject) => { const req = tx.objectStore(store).getAll(); req.onsuccess = () => accept(req.result as T[]); req.onerror = () => reject(req.error); });
            const [messages, checkpoints] = await Promise.all([
                all<{ id: string; thread_id: string; role: string; pending: boolean; data: { content?: string; turn_id?: string } }>('messages'),
                all<{ thread_id: string; user_message_id: string; assistant_message_id: string }>('chat_request_recoveries'),
            ]); db.close();
            const rows = messages.filter(row => row.thread_id === remembered);
            if (rows.length) return { rows, checkpoints: checkpoints.filter(row => row.thread_id === remembered) };
        }
        return { rows: [], checkpoints: [] };
    });
}
async function writeCheckpoint(page: Page) {
    await navigate(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('region', { name: 'Context & compaction' }).getByRole('button', { name: /^Context & compaction/ }).click();
    await page.getByRole('region', { name: 'Context & compaction' }).getByRole('meter').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message input' }).fill('journey:context-reject');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const failed = await poll(async () => { const state = await readAttempt(page); return state.checkpoints.length === 1 && state.rows.find(row => row.role === 'assistant')?.pending === false && state; }, 'saved checkpoint');
    const users = failed.rows.filter(row => row.role === 'user');
    const assistants = failed.rows.filter(row => row.role === 'assistant');
    assert(users.length === 1 && assistants.length === 1, 'Expected one user and one assistant row.');
    const user = users[0]!, assistant = assistants[0]!;
    assert(assistant.data.turn_id === user.id && failed.checkpoints[0]!.user_message_id === user.id && failed.checkpoints[0]!.assistant_message_id === assistant.id, 'Checkpoint must identify both original rows.');
    return { user, assistant, checkpoint: failed.checkpoints[0] };
}
async function resume(page: Page, saved: Awaited<ReturnType<typeof writeCheckpoint>>) {
    await navigate(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('or3:model-selected', { detail: { modelId: 'context-fixture-large' } })));
    const retry = page.getByRole('button', { name: 'Retry message', exact: true }).last();
    await retry.waitFor({ state: 'visible' }); await retry.click();
    const recovered = await poll(async () => { const state = await readAttempt(page); return state.rows.find(row => row.id === saved.assistant.id)?.data.content === 'Hello from deterministic stream.' && state; }, 'recovered answer');
    assert(recovered.checkpoints.length === 0, 'Recovery checkpoint must be removed.');
    assert(JSON.stringify(recovered.rows.filter(row => row.role === 'user')) === JSON.stringify([saved.user]), 'User row changed or was duplicated.');
    assert(JSON.stringify(recovered.rows.filter(row => row.role === 'assistant').map(row => row.id)) === JSON.stringify([saved.assistant.id]), 'Assistant row changed or was duplicated.');
    const fixture = await page.evaluate(() => ({ filters: Number(localStorage.getItem('or3:e2e:context-filter-count')),
        requests: JSON.parse(localStorage.getItem('or3:e2e:context-requests') ?? '[]') as Array<{ model: string; messages_sha256: string }> }));
    assert(fixture.filters === 1 && fixture.requests.length === 2, 'Recovery repeated filters or provider requests.');
    assert(fixture.requests[0]!.model === 'context-fixture-small' && fixture.requests[1]!.model === 'context-fixture-large', 'Unexpected recovery models.');
    assert(fixture.requests[0]!.messages_sha256 === fixture.requests[1]!.messages_sha256, 'Recovered messages changed.');
    return { userId: saved.user.id, assistantId: saved.assistant.id, checkpoint: saved.checkpoint, ...fixture };
}

// Failure inventory: viewport/theme controls may drift, a turn may disappear or
// duplicate, the selected model/body may change, or a saved row may be missing.
// Each browser profile is fresh and uses the same deterministic upstream.
async function captureMatrix(version: keyof typeof versions) {
    const cases: Record<string, { requests: unknown; rows: unknown; chat: string; settings: string }> = {};
    for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
        for (const mode of ['light', 'dark'] as const) {
            const id = `${size}-${mode}`;
            const context = await newContext({ viewport, colorScheme: mode });
            try {
                await context.addCookies([{ name: 'or3_active_theme', value: 'blank', domain: '127.0.0.1', path: '/' }]);
                const page = await context.newPage();
                await page.addInitScript(value => { localStorage.setItem('activeTheme', 'blank'); localStorage.setItem('theme', value); }, mode);
                await navigate(page);
                await page.waitForFunction(value => document.documentElement.classList.contains('dark') === (value === 'dark'), mode);
                await page.getByRole('textbox', { name: 'Message input' }).fill('journey:compatibility');
                await page.getByRole('button', { name: 'Send message', exact: true }).click();
                await page.getByText('Hello from deterministic stream.', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 });
                const state = await poll(async () => { const attempt = await readAttempt(page);
                    return attempt.rows.find(row => row.role === 'assistant' && row.pending === false && row.data.content === 'Hello from deterministic stream.') && attempt;
                }, `${version} ${id} durable reply`);
                await page.evaluate(() => document.fonts.ready);
                const chat = resolve(output, `${version}-${id}-chat.png`);
                await page.screenshot({ path: chat, animations: 'disabled', caret: 'hide' });
                await page.getByRole('button', { name: 'Settings', exact: true }).click();
                await page.getByRole('button', { name: 'Close chat settings', exact: true }).waitFor({ state: 'visible' });
                const settings = resolve(output, `${version}-${id}-settings.png`);
                await page.screenshot({ path: settings, animations: 'disabled', caret: 'hide' });
                const requests = await page.evaluate(() => JSON.parse(localStorage.getItem('or3:e2e:context-requests') ?? '[]'));
                const user = state.rows.find(row => row.role === 'user');
                const rows = state.rows.map(row => ({ role: row.role, content: row.data.content ?? '', pending: row.pending,
                    belongsToUser: row.role === 'assistant' ? row.data.turn_id === user?.id : undefined }))
                    .sort((a, b) => a.role.localeCompare(b.role));
                cases[id] = { requests, rows, chat, settings };
            } finally { await context.close(); }
        }
    }
    return cases;
}

async function compareMatrix(baseCases: Awaited<ReturnType<typeof captureMatrix>>, candidateCases: Awaited<ReturnType<typeof captureMatrix>>) {
    const page = await browser.newPage();
    const comparisons: Record<string, unknown> = {};
    try {
        for (const id of Object.keys(baseCases)) {
            const before = baseCases[id]!, after = candidateCases[id]!;
            assert(JSON.stringify(before.requests) === JSON.stringify(after.requests), `${id} provider requests differ.`);
            assert(JSON.stringify(before.rows) === JSON.stringify(after.rows), `${id} durable rows differ.`);
            const images: Record<string, unknown> = {};
            for (const name of ['chat', 'settings'] as const) {
                const encoded = await Promise.all([before[name], after[name]].map(async path => (await readFile(path)).toString('base64')));
                images[name] = await page.evaluate(async ([first, second]) => {
                    const pixels = async (encoded: string) => {
                        const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
                        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
                        return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
                    };
                    const a = await pixels(first!); const b = await pixels(second!);
                    if (a.width !== b.width || a.height !== b.height) throw new Error('Screenshot dimensions differ');
                    let changed = 0;
                    for (let i = 0; i < a.data.length; i += 4)
                        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) changed++;
                    return { width: a.width, height: a.height, changedPixels: changed, changedPercent: changed * 100 / (a.width * a.height) };
                }, encoded);
            }
            comparisons[id] = { requests: before.requests, rows: before.rows, images };
        }
    } finally { await page.close(); }
    return comparisons;
}

const browser = await chromium.launch({ headless: true });
const receipts: Record<string, unknown> = {};
try {
    await startServer('base');
    const baseMatrix = await captureMatrix('base');
    const first = await newContext(); const firstPage = await first.newPage();
    const baseCheckpoint = await writeCheckpoint(firstPage);
    await firstPage.goto('about:blank'); await stopServer(); await startServer('candidate');
    const candidateMatrix = await captureMatrix('candidate');
    receipts.uiMatrix = await compareMatrix(baseMatrix, candidateMatrix);
    receipts.baseToCandidate = await resume(firstPage, baseCheckpoint); await first.close();
    const second = await newContext(); const secondPage = await second.newPage();
    const candidateCheckpoint = await writeCheckpoint(secondPage);
    await secondPage.goto('about:blank'); await stopServer(); await startServer('base');
    receipts.candidateToBase = await resume(secondPage, candidateCheckpoint); await second.close();
    await writeFile(resolve(output, 'receipt.json'), JSON.stringify({ versions, origin, receipts }, null, 2));
    console.log(`Cross-version checkpoint recovery passed in both directions: ${output}/receipt.json`);
} finally { await browser.close(); await stopServer(); }
