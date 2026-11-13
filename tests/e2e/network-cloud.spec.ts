import { expect, test } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

// A disposable local Basic Auth + SQLite + filesystem server and fake model
// must be started explicitly; this harness must never target a real instance.
test('managed network optimizations preserve authenticated storage, sync and model input', async ({ request, browser }, info) => {
    test.setTimeout(120_000);
    expect(process.env.OR3_NETWORK_E2E).toBe('true');
    expect(info.project.use.baseURL).toBe('http://127.0.0.1:3187');
    const origin = 'http://127.0.0.1:3187';
    const intent = { origin, 'x-or3-cloud-intent': 'mutation' };
    const login = await request.post('/api/basic-auth/sign-in', { headers: intent,
        data: { email: 'network-test@example.test', password: 'DisposableNetworkTest!123' } });
    expect(login.ok(), await login.text()).toBe(true);
    // The production build sets Secure cookies; pass the disposable cookie
    // explicitly for this loopback HTTP-only test harness.
    const cookie = (await request.storageState()).cookies.filter(item => item.name === 'or3_access')
        .map(item => `${item.name}=${item.value}`).join('; ');
    expect(cookie).toBeTruthy();
    const headers = { ...intent, cookie };
    const created = await request.post('/api/workspaces', { headers, data: { name: `Network fixture ${randomUUID()}` } });
    expect(created.ok(), await created.text()).toBe(true);
    const workspaceId = (await created.json()).id as string;
    const active = await request.post('/api/workspaces/active', { headers, data: { id: workspaceId } });
    expect(active.ok(), await active.text()).toBe(true);
    const bytes = randomBytes(128 * 1024);
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const file = { hash, storageId: `${workspaceId}:${hash}`, mime: 'image/png', size: bytes.length };
    const preflight = () => request.post('/api/storage/chat-attachment-capability', { headers, data: { files: [file] } });
    expect((await (await preflight()).json()).eligible).toEqual([]);
    const grantResponse = await request.post('/api/storage/presign-upload', { headers, data: { workspace_id: workspaceId,
        hash, mime_type: 'image/png', size_bytes: bytes.length, file_kind_capability: 'v1' } });
    expect(grantResponse.ok(), await grantResponse.text()).toBe(true);
    const grant = await grantResponse.json();
    const upload = await request.put(grant.url, { headers: { ...headers, ...grant.headers, 'content-type': 'image/png' }, data: bytes });
    expect(upload.ok(), await upload.text()).toBe(true);
    const commit = await request.post('/api/storage/commit', { headers, data: { workspace_id: workspaceId, hash,
        storage_id: grant.storageId, intent_id: grant.intentId, storage_provider_id: 'fs', mime_type: 'image/png',
        size_bytes: bytes.length, name: 'fixture.png', kind: 'image', file_kind_capability: 'v1' } });
    expect(commit.ok(), await commit.text()).toBe(true);
    expect((await (await preflight()).json()).eligible).toEqual([]);
    const opId = randomUUID();
    const push = await request.post('/api/sync/push', { headers, data: { scope: { workspaceId }, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [{
        id: opId, tableName: 'file_meta', operation: 'put', pk: hash,
        payload: { hash, name: 'fixture.png', kind: 'image', mime_type: 'image/png', size_bytes: bytes.length,
            storage_id: grant.storageId, storage_provider_id: 'fs', ref_count: 0, clock: 1, created_at: 1, updated_at: 1, deleted: false },
        stamp: { deviceId: 'network-e2e', opId, clock: 1, hlc: `${String(Date.now()).padStart(15, '0')}:000000:network-e2e` },
        createdAt: Date.now(), attempts: 0, status: 'pending',
    }] } });
    expect(push.ok(), await push.text()).toBe(true);
    expect((await push.json()).results[0].success).toBe(true);
    expect((await (await preflight()).json()).eligible).toEqual([0]);

    const downloadGrant = await request.post('/api/storage/presign-download', { headers, data: { workspace_id: workspaceId, hash,
        storage_id: grant.storageId, mime_type: 'image/png', file_kind_capability: 'v1' } });
    expect(downloadGrant.ok(), await downloadGrant.text()).toBe(true);
    const downloadUrl = (await downloadGrant.json()).url as string;
    const unauthorized = await request.get(downloadUrl, { headers: { range: 'bytes=4096-' } });
    expect(unauthorized.status()).toBe(401);
    const full = await request.get(downloadUrl, { headers });
    expect(full.status()).toBe(200);
    expect(await full.body()).toEqual(bytes);
    const etag = full.headers().etag;
    expect(etag).toBeTruthy();
    const range = await request.get(downloadUrl, { headers: { ...headers, range: 'bytes=4096-', 'if-range': etag } });
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(bytes.subarray(4096));
    expect(range.headers()['content-range']).toBe(`bytes 4096-${bytes.length - 1}/${bytes.length}`);
    const invalid = await request.get(downloadUrl, { headers: { ...headers, range: `bytes=${bytes.length}-` } });
    expect(invalid.status()).toBe(416);

    const chatBody = { model: 'fixture/model', stream: true, messages: [{ role: 'user', content: [
        { type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: 'or3-cloud-attachment:0' } },
    ] }], _cloudAttachments: [{ messageIndex: 0, partIndex: 1, hash, storageId: grant.storageId, prefix: 'data:image/png;base64,' }] };
    const chat = await request.post('/api/openrouter/stream', { headers, data: chatBody });
    expect(chat.ok(), await chat.text()).toBe(true);
    const modelBody = JSON.parse(await readFile('/private/tmp/or3-network-model-request.json', 'utf8'));
    expect(modelBody.messages[0].content[1].image_url.url).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
    expect(modelBody).not.toHaveProperty('_cloudAttachments');
    const modelRequestBeforeFailure = await readFile('/private/tmp/or3-network-model-request.json', 'utf8');
    const badReference = { ...chatBody, _cloudAttachments: [{ ...chatBody._cloudAttachments[0], storageId: `${workspaceId}:wrong` }] };
    const rejected = await request.post('/api/openrouter/stream', { headers, data: badReference });
    expect(rejected.ok()).toBe(false);
    expect(await readFile('/private/tmp/or3-network-model-request.json', 'utf8')).toBe(modelRequestBeforeFailure);

    const ops = Array.from({ length: 7 }, (_, index) => {
        const id = randomUUID(), pk = `network-large-${index}`;
        return { id, tableName: 'threads', operation: 'put', pk, payload: { id: pk, title: String(index) + 'x'.repeat(200_000),
            status: 'ready', deleted: false, pinned: false, created_at: 1, updated_at: 1, clock: 1 },
            stamp: { deviceId: 'network-e2e', opId: id, clock: 1, hlc: `${String(Date.now()).padStart(15, '0')}:000000:network-e2e` },
            createdAt: Date.now(), attempts: 0, status: 'pending' };
    });
    const compressed = gzipSync(JSON.stringify({ scope: { workspaceId }, ops, fileKindCapability: 'v1', workspaceItemCapability: 'v1' }));
    const largePush = await request.post('/api/sync/push', { headers: { ...headers, 'content-type': 'application/json', 'content-encoding': 'gzip' }, data: compressed });
    expect(largePush.ok(), await largePush.text()).toBe(true);
    const pushResults = (await largePush.json()).results as Array<{ success: boolean; error?: string }>;
    expect(pushResults.every(item => item.success), JSON.stringify(pushResults)).toBe(true);
    let cursor = 0, pages = 0, found: string[] = [], more = true;
    while (more) {
        const response = await request.post('/api/sync/pull', { headers, data: { scope: { workspaceId }, cursor, limit: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
        expect(response.ok(), await response.text()).toBe(true);
        const raw = await response.body();
        expect(raw.length).toBeLessThanOrEqual(1024 * 1024);
        const page = JSON.parse(raw.toString());
        expect(page.nextCursor).toBeGreaterThan(cursor);
        found.push(...page.changes.filter((item: { tableName: string }) => item.tableName === 'threads').map((item: { pk: string }) => item.pk));
        cursor = page.nextCursor; more = page.hasMore;
        expect(++pages).toBeLessThan(10);
    }
    expect(found).toEqual(ops.map(op => op.pk));
    expect(pages).toBeGreaterThan(1);
    let pageToken: string | null = null, snapshotPages = 0;
    let snapshotId: string | undefined, highWatermark: number | undefined;
    const snapshotItems: string[] = [];
    do {
        const response = await request.post('/api/sync/snapshot', { headers, data: { scope: { workspaceId }, pageSize: 100,
            ...(pageToken ? { pageToken } : {}), tables: ['threads'], fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
        expect(response.ok(), await response.text()).toBe(true);
        const raw = await response.body();
        expect(raw.length).toBeLessThanOrEqual(1024 * 1024);
        const page = JSON.parse(raw.toString());
        snapshotId ??= page.snapshotId;
        highWatermark ??= page.highWatermark;
        expect(page.snapshotId).toBe(snapshotId);
        expect(page.highWatermark).toBe(highWatermark);
        snapshotItems.push(...page.items.map((item: { pk: string }) => item.pk));
        pageToken = page.nextPageToken;
        expect(++snapshotPages).toBeLessThan(10);
    } while (pageToken);
    expect(snapshotItems).toEqual(ops.map(op => op.pk));
    expect(snapshotPages).toBeGreaterThan(1);
    const inlineBody = { ...chatBody, _cloudAttachments: undefined, messages: [{ role: 'user', content: [
        { type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } },
    ] }] };
    // Browser timings use a fake local model and omit IndexedDB lookup.
    const encoded = bytes.toString('base64');
    // Capture only the synthetic chat/capability requests, and strip cookies
    // before retaining the HAR. Browser timings still use a fake local model.
    const rawHar = `/private/tmp/or3-network-${randomUUID()}.har`;
    const browserContext = await browser.newContext({ recordHar: { path: rawHar,
        urlFilter: /\/api\/(?:openrouter\/stream|storage\/chat-attachment-capability)(?:\?|$)/ } });
    let browserTiming: { loopback: { inlineMs: number[]; referenceMs: number[] };
        throttled: { inlineMs: number[]; referenceMs: number[] } };
    try {
        await browserContext.addCookies((await request.storageState()).cookies);
        const page = await browserContext.newPage();
        await page.goto(`${origin}/favicon.ico`);
        const samples = (gzipInline: boolean) => page.evaluate(async ({ inlineBody, chatBody, file, encoded, gzipInline }) => {
            async function sample(reference: boolean): Promise<number> {
                const started = performance.now();
                if (reference) {
                    const decoded = atob(encoded);
                    const input = new Uint8Array(decoded.length);
                    for (let index = 0; index < decoded.length; index++) input[index] = decoded.charCodeAt(index);
                    await crypto.subtle.digest('SHA-256', input);
                    const capability = await fetch('/api/storage/chat-attachment-capability', { method: 'POST',
                        headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
                        body: JSON.stringify({ files: [file] }) });
                    if (!capability.ok) throw new Error(`Capability failed: ${capability.status}`);
                }
                const headers: Record<string, string> = { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' };
                let body: string | Blob = JSON.stringify(reference ? chatBody : inlineBody);
                if (!reference && gzipInline) {
                    body = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
                    headers['content-encoding'] = 'gzip';
                }
                const response = await fetch('/api/openrouter/stream', { method: 'POST', headers, body });
                if (!response.ok || !response.body) throw new Error(`Chat failed: ${response.status}`);
                const reader = response.body.getReader();
                const first = await reader.read();
                if (first.done) throw new Error('Missing model event');
                const elapsed = performance.now() - started;
                await reader.cancel();
                return Math.round(elapsed * 100) / 100;
            }
            const inlineMs: number[] = [], referenceMs: number[] = [];
            for (let i = 0; i < 3; i++) { inlineMs.push(await sample(false)); referenceMs.push(await sample(true)); }
            return { inlineMs, referenceMs };
        }, { inlineBody, chatBody, file, encoded, gzipInline });
        const loopback = await samples(false);
        const cdp = await browserContext.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80,
            downloadThroughput: 5_000_000 / 8, uploadThroughput: 5_000_000 / 8 });
        const throttled = await samples(true);
        browserTiming = { loopback, throttled };
    } finally {
        await browserContext.close();
        try {
            const har = JSON.parse(await readFile(rawHar, 'utf8'));
            for (const entry of har.log.entries) {
                entry.request.cookies = [];
                entry.response.cookies = [];
                for (const part of [entry.request, entry.response]) {
                    part.headers = part.headers.filter((header: { name: string }) =>
                        !['cookie', 'set-cookie', 'authorization', 'proxy-authorization'].includes(header.name.toLowerCase()));
                }
            }
            expect(JSON.stringify(har)).not.toContain(cookie.slice('or3_access='.length));
            const path = info.outputPath('network-sanitized.har');
            await writeFile(path, JSON.stringify(har));
            await info.attach('network-sanitized.har', { path, contentType: 'application/json' });
        } finally { await unlink(rawHar).catch(() => {}); }
    }
    // Capture the actual theme in two viewport sizes, with the original
    // committed image bytes and with the optimized assets from the build.
    const originals = ['cyberpunk', 'cybersb2', 'lightmode-cyberpunk-bg'].map(name => ({ name,
        bytes: execFileSync('git', ['show', `HEAD:app/theme/cyberpunk/assets/${name}.webp`], { maxBuffer: 4 * 1024 * 1024 }) }));
    for (const [viewportName, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
        for (const mode of ['light', 'dark']) for (const variant of ['before', 'after']) {
            const visualContext = await browser.newContext({ viewport, serviceWorkers: 'block' });
            let originalImages = 0;
            try {
                await visualContext.addCookies((await request.storageState()).cookies);
                await visualContext.addInitScript(({ mode }) => {
                    localStorage.setItem('activeTheme', 'cyberpunk');
                    localStorage.setItem('theme', mode);
                }, { mode });
                if (variant === 'before') await visualContext.route('**/*.webp', async route => {
                    const path = new URL(route.request().url()).pathname;
                    const original = originals.find(item => path.includes(`/${item.name}.`));
                    if (original) { originalImages++; await route.fulfill({ contentType: 'image/webp', body: original.bytes }); }
                    else await route.continue();
                });
                const page = await visualContext.newPage();
                await page.goto(`${origin}/chat`, { waitUntil: 'domcontentloaded' });
                await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyberpunk', { timeout: 30_000 });
                const dismiss = page.getByRole('button', { name: 'Dismiss welcome', exact: true });
                if (await dismiss.isVisible()) await dismiss.click();
                await page.evaluate(() => document.fonts.ready);
                if (variant === 'before') expect(originalImages).toBeGreaterThan(0);
                const path = info.outputPath(`theme-${viewportName}-${mode}-${variant}.png`);
                await page.screenshot({ path, animations: 'disabled' });
                await info.attach(`theme-${viewportName}-${mode}-${variant}`, { path, contentType: 'image/png' });
            } finally { await visualContext.close(); }
        }
    }
    const resultsPath = info.outputPath('network-results.json');
    await writeFile(resultsPath, JSON.stringify({ imageBytes: bytes.length,
        referenceRequestBytes: Buffer.byteLength(JSON.stringify(chatBody)), inlineRequestBytes: Buffer.byteLength(JSON.stringify(inlineBody)),
        gzipReferenceBytes: gzipSync(JSON.stringify(chatBody)).length, gzipInlineBytes: gzipSync(JSON.stringify(inlineBody)).length,
        preflightBytes: Buffer.byteLength(JSON.stringify({ files: [file] })), gzipSyncPushBytes: compressed.length,
        pullPages: pages, snapshotPages, browserTiming,
        note: 'Browser timings include decode, hash and preflight for references; throttled inline requests use gzip with 80 ms latency and 5 Mbit/s throughput. Both exclude IndexedDB lookup and real network/model inference.' }, null, 2));
    await info.attach('network-results.json', { path: resultsPath, contentType: 'application/json' });
});
