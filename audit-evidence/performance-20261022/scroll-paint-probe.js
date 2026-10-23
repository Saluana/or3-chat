// Diagnostic only: best-effort compositor captures, not a timing benchmark or
// proof about every display frame. All data and network responses are synthetic.
async function scrollPaintProbe(page, options = {}) {
    const surface = options.surface ?? 'projects';
    const cpuRate = options.cpuRate ?? 4;
    const context = await page.context().browser().newContext({
        viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, hasTouch: options.input === 'touch',
    });
    const p = await context.newPage();
    p.setDefaultTimeout(20_000);
    let cdp;
    const captures = [];
    let phase = 'settled', overflow = 0, wheelIssued = 0, controlApplied = 0;
    try {
        const models = Array.from({ length: 600 }, (_, i) => ({
            id: `openai/audit-${String(i).padStart(3, '0')}`, name: `Audit model ${String(i).padStart(3, '0')}`,
            context_length: 128000, supported_parameters: ['tools', 'temperature'],
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            pricing: { prompt: '0.000002', completion: '0.000006' },
        }));
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
            ? route.continue() : route.abort());
        if (options.bundleControl) await p.route(`**/_nuxt/${options.bundleControl.bundle}`, async route => {
            const response = await route.fetch(), body = await response.text();
            const { needle, replacement } = options.bundleControl;
            if (body.split(needle).length !== 2) throw new Error('Unmatched scroll control');
            controlApplied++;
            await route.fulfill({ response, body: body.replace(needle, replacement) });
        });
        await p.route(/\/api\/(?:__or3-e2e\/models|v1\/models)/, route => route.fulfill({
            json: { data: models, links: { next: null }, total_count: models.length },
        }));
        await p.addInitScript(models => {
            localStorage.setItem('openrouter_model_catalog_v1', JSON.stringify({ data: models, fetchedAt: Date.now() }));
            localStorage.setItem('activeTheme', 'blank'); localStorage.setItem('theme', 'light');
        }, models);
        await context.addCookies([{ name: 'or3_active_theme', value: 'blank', domain: '127.0.0.1', path: '/' }]);
        await p.goto('http://127.0.0.1:3147/__or3-chat-journey-test?workspace=1');
        await p.bringToFront();
        await p.locator('#nav-scroll-area').waitFor();
        await p.evaluate(async () => {
            const name = (await indexedDB.databases()).find(d => d.name?.startsWith('or3-db'))?.name;
            if (!name) throw new Error('Missing disposable database');
            const db = await new Promise((resolve, reject) => {
                const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
            });
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['projects', 'threads', 'messages'], 'readwrite');
                for (let i = 0; i < 600; i++) {
                    tx.objectStore('projects').put({ id: `paint-project-${i}`, name: `Paint project ${String(i).padStart(3, '0')}`,
                        description: i % 3 === 0 ? 'A project description to exercise truncation' : '',
                        data: [], clock: 1, deleted: false, created_at: 1000 + i, updated_at: 1000 + i });
                    tx.objectStore('threads').put({ id: `paint-thread-${i}`, title: `Paint conversation ${String(i).padStart(3, '0')}`,
                        status: 'ready', deleted: false, pinned: false, forked: false,
                        created_at: 10000 - i, updated_at: 10000 - i, clock: 1 });
                }
                for (let i = 0; i < 240; i++) tx.objectStore('messages').put({
                    id: `paint-message-${i}`, thread_id: 'paint-thread-0', index: i, role: i % 2 ? 'assistant' : 'user',
                    created_at: 1000 + i, updated_at: 1000 + i, clock: 1, pending: false, deleted: false,
                    data: { content: `Paint message ${i}\n\n` + 'Variable height history stays visible while scrolling. '.repeat(3 + i % 12) },
                });
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            }); db.close();
        });
        await p.goto('http://127.0.0.1:3147/chat');
        await p.locator('#nav-scroll-area').waitFor();
        if (surface === 'projects') await p.getByRole('button', { name: 'Projects', exact: true }).click();
        if (surface === 'models') {
            await p.getByRole('button', { name: 'Settings', exact: true }).click();
            await p.getByRole('button', { name: 'Model catalog Browse and compare available models.', exact: true }).click();
        }
        if (surface === 'chats' || surface === 'chat') {
            await p.getByRole('button', { name: 'Chats', exact: true }).click();
            if (surface === 'chat') {
                await p.getByRole('button', { name: 'Open Paint conversation 000', exact: true }).click();
                await p.locator('[data-msg-id="paint-message-239"]').waitFor();
                await p.getByRole('textbox', { name: 'Message input' }).waitFor();
            }
        }
        const selectors = { projects: '.sidebar-projects-page .or3-scroll', models: '.model-catalog-list__rows',
            chats: '.sidebar-scroll', home: '.sidebar-home-page .sidebar-scroll', chat: '.chat-message-list' };
        const scroller = p.locator(selectors[surface]);
        await scroller.waitFor();
        await scroller.evaluate(el => { el.scrollTop = 0; el.id = 'paint-audit-scroll'; });
        await p.addStyleTag({ content: `#paint-audit-scroll .or3-scroll-slice > .or3-scroll-item { position: relative; }
            #paint-audit-scroll .or3-scroll-slice > .or3-scroll-item::after {
                content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
                background: rgb(255, 0, 255); z-index: 9999; pointer-events: none;
            }` });
        if (options.styleControl) await p.addStyleTag({ content: options.styleControl });
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(800);
        if (options.staticRows) {
            await scroller.evaluate(el => {
                // Diagnostic control: detached Vue-owned root, cloned static
                // rows, no virtual range updates or framework scroll handlers.
                const clone = el.cloneNode(true), slice = clone.querySelector('.or3-scroll-slice');
                const seeds = [...slice.children]; slice.replaceChildren();
                for (let i = 0; i < 600; i++) slice.append(seeds[i % seeds.length].cloneNode(true));
                slice.style.cssText = 'position:relative;transform:none;will-change:auto';
                clone.querySelector('.or3-scroll-track').style.height = 'auto';
                clone.querySelector('.or3-scroll-hidden-pool')?.remove();
                el.replaceWith(clone);
            });
            await p.waitForTimeout(500);
        }
        const geometry = await scroller.evaluate(el => {
            const box = el.getBoundingClientRect(), row = el.querySelector('.or3-scroll-slice > .or3-scroll-item').getBoundingClientRect();
            const composer = document.querySelector('.chat-input-wrapper')?.getBoundingClientRect();
            const bottom = el.classList.contains('chat-message-list') && composer ? Math.min(box.bottom, composer.top - 4) : box.bottom;
            return { x: Math.round(row.left + 1.5), top: Math.ceil(box.top + 30), bottom: Math.floor(bottom - 30),
                box: { x: box.x, y: box.y, width: box.width, height: box.height },
                theme: document.documentElement.dataset.theme, zoom: getComputedStyle(document.body).zoom,
                scrollTop: el.scrollTop, track: el.scrollHeight, height: el.clientHeight,
                sliceHeight: el.querySelector('.or3-scroll-slice').getBoundingClientRect().height,
                mounted: el.querySelectorAll('.or3-scroll-slice > .or3-scroll-item').length };
        });
        const positive = await p.screenshot({ type: 'png', path: options.outputDir ? `${options.outputDir}/${surface}-positive.png` : undefined });
        const hidden = await p.addStyleTag({ content: '#paint-audit-scroll .or3-scroll-slice { visibility: hidden !important; }' });
        const negative = await p.screenshot({ type: 'png' });
        await hidden.evaluate(el => el.remove());
        await p.waitForTimeout(300);
        if (options.geometryTrace) await scroller.evaluate(el => {
            const frames = []; let raf;
            const tick = () => {
                const slice = el.querySelector('.or3-scroll-slice'), box = slice.getBoundingClientRect();
                frames.push({ timestamp: (performance.timeOrigin + performance.now()) / 1000,
                    scrollTop: el.scrollTop, sliceTop: box.top, sliceBottom: box.bottom,
                    first: slice.firstElementChild?.dataset.index, last: slice.lastElementChild?.dataset.index });
                raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            window.__finishPaintGeometry = () => { cancelAnimationFrame(raf); return frames; };
        });
        cdp = await context.newCDPSession(p);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        cdp.on('Page.screencastFrame', event => {
            cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
            if (captures.length < 500) captures.push({ data: event.data, metadata: event.metadata, phase, wheelIssued });
            else overflow++;
        });
        await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1200, maxHeight: 800, everyNthFrame: 1 });
        await p.mouse.move(geometry.box.x + geometry.box.width / 2, geometry.box.y + geometry.box.height / 2);
        await p.waitForTimeout(150);
        const endpoints = [];
        for (const direction of [1, -1]) {
            phase = direction === 1 ? 'down' : 'up';
            for (let i = 0; i < (options.steps ?? 18); i++) {
                wheelIssued++;
                if (options.input === 'touch') {
                    const x = geometry.box.x + geometry.box.width / 2;
                    const distance = Math.min(options.delta ?? 600, geometry.bottom - geometry.top - 20);
                    const startY = direction === 1 ? geometry.bottom - 10 : geometry.top + 10;
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }] });
                    for (let move = 1; move <= 16; move++) {
                        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - direction * distance * move / 16, id: 1 }] });
                        await p.waitForTimeout(16);
                    }
                    await p.waitForTimeout(100);
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                } else await p.mouse.wheel(0, direction * (options.delta ?? 600));
                await p.waitForTimeout(options.intervalMs ?? 16);
            }
            await p.waitForTimeout(250);
            endpoints.push(await scroller.evaluate(el => ({ scrollTop: el.scrollTop, track: el.scrollHeight, height: el.clientHeight,
                mounted: el.querySelectorAll('.or3-scroll-slice > .or3-scroll-item').length,
                indices: [...el.querySelectorAll('.or3-scroll-slice > .or3-scroll-item')].map(row => row.dataset.index) })));
        }
        phase = 'settled'; await p.waitForTimeout(200);
        await cdp.send('Page.stopScreencast');
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.detach(); cdp = undefined;
        const geometryTrace = options.geometryTrace ? await p.evaluate(() => window.__finishPaintGeometry()) : undefined;
        const samples = [{ data: positive.toString('base64'), phase: 'positive-control' },
            { data: negative.toString('base64'), phase: 'negative-control' }, ...captures];
        const analyzed = [];
        // Bound protocol serialization and PNG decoding as well as canvas size.
        // A single evaluate carrying hundreds of welcome-image PNGs can exhaust
        // the renderer before its analysis function even starts.
        for (let offset = 0; offset < samples.length; offset += 8) analyzed.push(...await p.evaluate(async ({ samples, geometry, offset }) => {
            const results = [];
            // Reuse a one-pixel canvas; allocating a full viewport canvas for
            // each captured frame can exhaust the diagnostic renderer's memory.
            const height = geometry.bottom - geometry.top;
            const canvas = new OffscreenCanvas(1, height), ctx = canvas.getContext('2d');
            for (let i = 0; i < samples.length; i++) {
                const { data, metadata, phase, wheelIssued } = samples[i];
                const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' });
                const bitmap = await createImageBitmap(blob);
                ctx.clearRect(0, 0, 1, height);
                ctx.drawImage(bitmap, geometry.x, geometry.top, 1, height, 0, 0, 1, height); bitmap.close();
                const pixels = ctx.getImageData(0, 0, 1, height).data;
                let covered = 0, missing = 0, largestMissing = 0, start = 0; const ranges = [];
                for (let y = 0; y < pixels.length / 4; y++) {
                    const on = pixels[y * 4] > 230 && pixels[y * 4 + 1] < 25 && pixels[y * 4 + 2] > 230;
                    if (on) { covered++; if (missing > 5) ranges.push([start + geometry.top, y + geometry.top]); missing = 0; }
                    else { if (!missing) start = y; missing++; largestMissing = Math.max(largestMissing, missing); }
                }
                if (missing > 5) ranges.push([start + geometry.top, geometry.bottom]);
                results.push({ index: offset + i, phase, wheelIssued, timestamp: metadata?.timestamp,
                    coverage: covered / (pixels.length / 4), largestMissing, ranges });
            }
            return results;
        }, { samples: samples.slice(offset, offset + 8), geometry, offset }));
        if (analyzed[0].coverage < .98 || analyzed[1].coverage > .02) throw new Error('Marker calibration failed: ' + JSON.stringify({ geometry, controls: analyzed.slice(0, 2) }));
        const worst = analyzed.slice(2).sort((a, b) => a.coverage - b.coverage || b.largestMissing - a.largestMissing).slice(0, 5);
        const outputDir = options.outputDir;
        const artifacts = [];
        if (outputDir) {
            for (const index of [...new Set([0, 1, ...worst.flatMap(sample => [sample.index - 1, sample.index, sample.index + 1])])]) {
                if (!samples[index]) continue;
                const path = `${outputDir}/${surface}-${cpuRate}x-${options.delta ?? 600}-${index}.png`;
                // The browser tool does not expose filesystem imports. Repaint
                // each captured PNG at its native size solely to save it.
                await p.setContent(`<style>body{margin:0}</style><img src="data:image/png;base64,${samples[index].data}">`);
                await p.locator('img').screenshot({ path }); artifacts.push({ index, path });
            }
        }
        return { surface, cpuRate, wheelDelta: options.delta ?? 600, intervalMs: options.intervalMs ?? 16,
            input: options.input ?? 'wheel', touchDistance: options.input === 'touch' ? Math.min(options.delta ?? 600, geometry.bottom - geometry.top - 20) : undefined,
            staticRows: options.staticRows ?? false, styleControl: options.styleControl, bundleControl: options.bundleControl,
            stepsPerDirection: options.steps ?? 18, geometry, endpoints, overflow, controlApplied, controls: analyzed.slice(0, 2),
            capturedFrames: captures.length, framesWithGapOver8px: analyzed.slice(2).filter(s => s.largestMissing > 8).length,
            worst, samples: analyzed.slice(2).sort((a, b) => a.index - b.index), geometryTrace, artifacts };
    } finally {
        if (cdp) { await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {}); await cdp.detach().catch(() => {}); }
        await context.close().catch(() => {});
    }
}
