// Disposable production journey; no production measurement seams or network traffic.
// bunx tsx audit-evidence/performance-20261022/stream-media-probe.mjs '{"mode":"image","cpuRate":4}' /tmp/media.json
import { chromium, webkit } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const options = JSON.parse(process.argv[2] ?? '{}');
const output = process.argv[3];
assert(output, 'Supply an output JSON path');
const mode = options.mode ?? 'image';
const engine = options.browser === 'webkit' ? webkit : chromium;
// WebKit private contexts cannot write IndexedDB Blobs in this environment.
// An explicit, disposable disk profile qualifies the normal storage path.
const profile = options.persistent ? await mkdtemp(join(tmpdir(), 'or3-media-')) : null;
const browser = profile ? null : await engine.launch();
const contextOptions = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const context = profile ? await engine.launchPersistentContext(profile, contextOptions) : await browser.newContext(contextOptions);
const browserVersion = context.browser().version();
const close = () => browser ? browser.close() : context.close();
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const timer = setTimeout(() => close().catch(() => {}), 90_000);
try {
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        // WebKit routes Blob requests too; their hostname is empty. Permit
        // only Blob URLs created by this local origin, keeping egress blocked.
        return url.hostname === '127.0.0.1' || (url.protocol === 'blob:' && url.origin === 'http://127.0.0.1:3147')
            ? route.continue() : route.abort();
    });
    // Count actual watcher entries in the served production module. The body
    // and reactive dependencies are unchanged; fail closed if the match drifts.
    let instrumentationApplied = 0;
    for (const file of await readdir('.output/public/_nuxt')) {
        if (!file.endsWith('.js')) continue;
        const source = await readFile(`.output/public/_nuxt/${file}`, 'utf8');
        if (!source.includes('maxDisplayedThumbs:4')) continue;
        const pattern = /async function (\w+)\((\w+)\)\{let \w+=\w+\(\),\w+=new Set\(\2\),\w+=\[\];/g;
        const matches = [...source.matchAll(pattern)];
        assert.equal(matches.length, 1, 'Exactly one thumbnail watcher');
        const needle = matches[0][0];
        const insertion = needle.indexOf('{') + 1;
        await page.route(`**/_nuxt/${file}`, async route => {
            const response = await route.fetch();
            let body = await response.text();
            assert.equal(body.split(needle).length, 2);
            if (options.hashControl) {
                assert.equal(body.split(options.hashControl.needle).length, 2, 'Exactly one original hash-list control');
                body = body.replace(options.hashControl.needle, options.hashControl.replacement);
            }
            instrumentationApplied++;
            await route.fulfill({ response, body: body.replace(needle, needle.slice(0, insertion) + 'if(window.__mediaAudit?.active)window.__mediaAudit.syncs++;' + needle.slice(insertion)) });
        });
    }
    await context.addCookies([{ name: 'or3_active_theme', value: 'blank', domain: '127.0.0.1', path: '/' }]);
    await page.addInitScript(() => { localStorage.setItem('activeTheme', 'blank'); localStorage.setItem('theme', 'light'); });
    await page.goto('http://127.0.0.1:3147/__or3-chat-journey-test?workspace=1');
    await page.getByRole('textbox', { name: 'Message input' }).waitFor();
    await page.evaluate(({ mode, decodeDelay, secondImage, verifyLiveImages }) => {
        const audit = window.__mediaAudit = { active: false, syncs: 0, gets: {}, decodeStarted: 0, decoded: 0, decodeErrors: [], instances: {}, updates: {}, imageMutations: 0, toolMutations: 0, chunks: 0, gaps: [], longTasks: [], liveImageCounts: [] };
        const originalFetch = window.fetch;
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args) {
            if (audit.active && this.name.startsWith('file_')) audit.gets[this.name] = (audit.gets[this.name] ?? 0) + 1;
            return get.apply(this, args);
        };
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = async function (...args) {
            audit.decodeStarted++;
            try { await decode.apply(this, args); } catch (error) { audit.decodeErrors.push(String(error)); throw error; }
            if (this.src.startsWith('blob:')) {
                audit.decoded++;
                if (decodeDelay) await new Promise(resolve => setTimeout(resolve, decodeDelay));
            }
        };
        const encoder = new TextEncoder();
        const frame = delta => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`);
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
        const graphics = canvas.getContext('2d'); graphics.fillStyle = '#4387a8'; graphics.fillRect(0, 0, 64, 48);
        const png = canvas.toDataURL('image/png');
        graphics.fillStyle = '#b87332'; graphics.fillRect(0, 0, 64, 48);
        const laterPng = canvas.toDataURL('image/png');
        let controller;
        window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (!url.includes('/api/__or3-e2e/chat/completions')) return originalFetch(input, init);
            const body = JSON.parse(init.body);
            if (mode === 'tool' && !body.messages.some(message => message.role === 'tool' && message.name === 'workspace_read')) return originalFetch(input, init);
            return new Response(new ReadableStream({ start(value) {
                controller = value;
                if (mode === 'image') value.enqueue(frame({ images: [{ image_url: { url: png } }] }));
                value.enqueue(frame({ content: '\n\nStreaming media audit.\n\n' }));
                audit.transportReady = true;
            } }), { headers: { 'Content-Type': 'text/event-stream' } });
        };
        const cleanups = [];
        window.__beginMediaAudit = () => {
            const seen = new Set();
            const seenComponents = new Set();
            const visit = vnode => {
                if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return;
                seen.add(vnode);
                const vm = vnode.component;
                if (vm && !seenComponents.has(vm)) {
                    seenComponents.add(vm);
                    const name = vm.type.name || vm.type.__name;
                    if (['ChatMessage', 'ChatToolBlock', 'ToolCallIndicator', 'ToolCardSlot', 'ChatToolCardsEnd'].includes(name)) {
                        audit.instances[name] = (audit.instances[name] ?? 0) + 1;
                        const update = () => { if (audit.active) audit.updates[name] = (audit.updates[name] ?? 0) + 1; };
                        (vm.bu ??= []).push(update);
                        cleanups.push(() => { const index = vm.bu.indexOf(update); if (index >= 0) vm.bu.splice(index, 1); });
                    }
                    visit(vm.subTree);
                }
                if (Array.isArray(vnode.children)) vnode.children.forEach(visit);
                visit(vnode.suspense?.activeBranch);
            };
            visit(document.querySelector('#__nuxt')._vnode);
            // Slotted/teleported tool content can be outside the root traversal.
            for (const el of document.querySelectorAll('.tool-call-indicator')) {
                let vm = el.__vueParentComponent;
                while (vm) { visit({ component: vm }); vm = vm.parent; }
            }
            const image = document.querySelector('img[data-hydrated]');
            audit.initialImage = image ? { src: image.src, width: image.naturalWidth } : null;
            const images = [...document.querySelectorAll('img[alt^="file-hash:"]')];
            const toolRoots = [...document.querySelectorAll('.tool-call-indicator')];
            audit.toolRoots = toolRoots.length;
            cleanups.push(() => { audit.toolRootsConnected = toolRoots.every(el => el.isConnected); });
            const observer = new MutationObserver(records => {
                for (const record of records) {
                    if (images.some(el => el === record.target || el.contains(record.target))) audit.imageMutations++;
                    if (toolRoots.some(el => el === record.target || el.contains(record.target))) audit.toolMutations++;
                }
            });
            observer.observe(document.querySelector('.chat-message-list'), { subtree: true, attributes: true, childList: true, characterData: true });
            cleanups.push(() => observer.disconnect());
            let last = performance.now(), raf;
            const tick = now => {
                if (!audit.active) return;
                audit.gaps.push(now - last); last = now;
                if (verifyLiveImages && mode === 'image') audit.liveImageCounts.push(document.querySelectorAll('img[data-hydrated="true"]').length);
                raf = requestAnimationFrame(tick);
            };
            cleanups.push(() => cancelAnimationFrame(raf));
            const longTasks = PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver(list => audit.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))) : null;
            longTasks?.observe({ type: 'longtask' }); cleanups.push(() => longTasks?.disconnect());
            audit.active = true; raf = requestAnimationFrame(tick);
            const chunk = 'Steady trailing text keeps the response moving. ';
            window.__mediaExpectedTail = chunk.repeat(160) + 'MEDIA-AUDIT-END';
            let count = 0;
            const interval = setInterval(() => {
                controller.enqueue(frame({ content: chunk })); audit.chunks++;
                if (secondImage && count === 79) controller.enqueue(frame({ images: [{ image_url: { url: laterPng } }] }));
                if (++count === 160) {
                    clearInterval(interval);
                    controller.enqueue(frame({ content: 'MEDIA-AUDIT-END' }));
                    audit.transportDone = true;
                }
            }, 25);
            cleanups.push(() => clearInterval(interval));
        };
        window.__endMediaAudit = () => {
            audit.active = false; cleanups.forEach(fn => fn());
            const images = [...document.querySelectorAll('img[alt^="file-hash:"]')].map(el => ({ src: el.src, hydrated: el.dataset.hydrated, width: el.naturalWidth }));
            const gaps = audit.gaps.slice(1).sort((a, b) => a - b);
            controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
            window.fetch = originalFetch; IDBObjectStore.prototype.get = get; HTMLImageElement.prototype.decode = decode;
            return { ...audit, gaps: undefined, frames: gaps.length, p95: gaps[Math.floor(gaps.length * .95)], max: gaps.at(-1), images };
        };
    }, { mode, decodeDelay: options.decodeDelay ?? 0, secondImage: options.secondImage ?? false, verifyLiveImages: options.verifyLiveImages ?? false });
    await page.getByRole('textbox', { name: 'Message input' }).fill(mode === 'tool' ? 'journey:workspace-find' : 'media-performance-audit');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.waitForFunction(() => window.__mediaAudit.transportReady);
    await page.getByText('Streaming media audit.', { exact: false }).waitFor();
    if (mode === 'image') await page.waitForFunction(() => window.__mediaAudit.decoded > 0);
    if (mode === 'image' && options.verifyLiveImages) await page.waitForFunction(() => document.querySelector('img[data-hydrated="true"]')?.naturalWidth > 0);
    if (mode === 'image' && !options.decodeDelay) await page.waitForTimeout(150);
    if (mode === 'tool') await page.getByRole('button', { name: 'Open source: Workspace evidence', exact: true }).first().waitFor();
    let cdp;
    if (options.cpuRate && options.browser !== 'webkit') { cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuRate }); }
    await page.evaluate(() => window.__beginMediaAudit());
    await page.waitForFunction(() => window.__mediaAudit.transportDone);
    await page.getByText(/MEDIA-AUDIT-END/).waitFor();
    await page.waitForTimeout(150);
    const result = await page.evaluate(() => window.__endMediaAudit());
    await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
    await page.waitForTimeout(300);
    if (mode === 'image') {
        await page.waitForFunction(count => document.querySelectorAll('img[data-hydrated="true"]').length === count, options.secondImage ? 2 : 1);
        result.finalImages = await page.locator('img[data-hydrated="true"]').evaluateAll(images => images.map(el => ({ src: el.src, hydrated: el.dataset.hydrated, width: el.naturalWidth })));
    }
    result.persisted = await page.evaluate(async () => {
        const name = (await indexedDB.databases()).find(db => db.name?.startsWith('or3-db'))?.name;
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const rows = await new Promise((resolve, reject) => { const request = db.transaction('messages').objectStore('messages').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        db.close();
        const row = rows.find(row => row.role === 'assistant' && String(row.data?.content).includes('MEDIA-AUDIT-END'));
        const hashes = typeof row?.file_hashes === 'string' ? JSON.parse(row.file_hashes) : row?.file_hashes;
        const content = row?.data?.content ?? '';
        const images = [...content.matchAll(/!\[file-hash:([^\]]+)\]\([^)]*\)/g)];
        const chunk = 'Steady trailing text keeps the response moving. ';
        return { exactTail: row?.data?.content?.endsWith(window.__mediaExpectedTail) === true,
            textChunks: row?.data?.content?.split('Steady trailing text keeps the response moving. ').length - 1,
            endsWithMarker: row?.data?.content?.endsWith('MEDIA-AUDIT-END') === true,
            imageOrderMatchesHashes: images.every((image, index) => image[1] === hashes?.[index]),
            textChunksBetweenImages: images.length === 2 ? content.slice(images[0].index + images[0][0].length, images[1].index).split(chunk).length - 1 : null,
            textChunksAfterLastImage: images.length ? content.slice(images.at(-1).index + images.at(-1)[0].length).split(chunk).length - 1 : null,
            fileHashes: hashes?.length ?? 0, toolNames: row?.data?.tool_calls?.map(call => call.name) ?? [] };
    });
    assert.equal(instrumentationApplied, 1);
    if (!options.secondImage) assert.equal(result.persisted.exactTail, true);
    assert.equal(result.persisted.textChunks, 160); assert.equal(result.persisted.endsWithMarker, true);
    if (mode === 'image') {
        assert.equal(result.persisted.fileHashes, options.secondImage ? 2 : 1); assert.equal(result.finalImages.length, options.secondImage ? 2 : 1);
        for (const image of result.finalImages) { assert.equal(image.hydrated, 'true'); assert(image.width > 0); }
        assert.equal(new Set(result.finalImages.map(image => image.src)).size, result.finalImages.length);
        assert.equal(result.persisted.imageOrderMatchesHashes, true);
        if (options.secondImage) assert.equal(result.persisted.textChunksBetweenImages, 80);
        assert.equal(result.persisted.textChunksAfterLastImage, options.secondImage ? 80 : 160);
        if (options.verifyReload) {
            await page.reload();
            await page.waitForFunction(count => document.querySelectorAll('img[data-hydrated="true"]').length === count, options.secondImage ? 2 : 1);
            await page.getByText(/MEDIA-AUDIT-END/).waitFor();
            result.reloadedImages = await page.locator('img[data-hydrated="true"]').evaluateAll(images => images.map(image => ({ width: image.naturalWidth, height: image.naturalHeight })));
            for (const image of result.reloadedImages) assert(image.width > 0);
        }
    }
    if (mode === 'tool') { assert.equal(result.toolRoots, 1); assert.equal(result.toolRootsConnected, true); assert(result.persisted.toolNames.includes('workspace_read')); }
    await writeFile(output, JSON.stringify({ options, browser: browserVersion, instrumentationApplied, errors, ...result }, null, 2) + '\n');
    if (mode === 'image' && options.verifyLiveImages) {
        assert(result.initialImage?.width > 0, 'First image must be visible before trailing text');
        assert(result.liveImageCounts.length > 0, 'Capture live image visibility samples');
        assert(result.liveImageCounts.every(count => count >= 1), 'First image must remain visible throughout trailing text');
        assert.equal(result.images.length, options.secondImage ? 2 : 1, 'All images must be visible before stream completion');
        for (const image of result.images) { assert.equal(image.hydrated, 'true'); assert(image.width > 0); }
    }
    console.log(JSON.stringify({ output, syncs: result.syncs, gets: result.gets, updates: result.updates, imageMutations: result.imageMutations, toolMutations: result.toolMutations, p95: result.p95, max: result.max, persisted: result.persisted, errors }));
} catch (error) {
    console.error(await page.locator('body').innerText().catch(() => 'Page closed'));
    const diagnostic = await page.evaluate(async () => {
        const name = (await indexedDB.databases()).find(db => db.name?.startsWith('or3-db'))?.name;
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const metadata = await new Promise((resolve, reject) => { const request = db.transaction('file_meta').objectStore('file_meta').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        db.close();
        return { audit: window.__mediaAudit, metadata, cache: [...(window.__or3ThumbUrlCache?.cache?.entries() ?? [])], images: [...document.querySelectorAll('img')].map(el => el.outerHTML) };
    }).catch(() => null);
    console.error(diagnostic);
    console.error(errors);
    await writeFile(output, JSON.stringify({ options, browser: browserVersion, failure: String(error), errors, diagnostic }, null, 2) + '\n');
    throw error;
} finally {
    clearTimeout(timer);
    await close();
    if (profile) await rm(profile, { recursive: true, force: true });
}
