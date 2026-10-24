// Disposable local journey fixture only. Run through browser_run_code_unsafe's
// filename argument; the browser profile must not contain user data.
async function sidebarScrollProbe(page) {
    await page.context().route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort('blockedbyclient'));
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto('http://127.0.0.1:3147/__or3-chat-journey-test?workspace=1');
    await page.locator('#nav-scroll-area').waitFor();
    await page.evaluate(async () => {
        const name = (await indexedDB.databases()).find(entry => entry.name?.startsWith('or3-db'))?.name;
        if (!name) throw new Error('Missing disposable fixture database');
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
            const transaction = db.transaction('threads', 'readwrite');
            for (let index = 0; index < 160; index++) transaction.objectStore('threads').put({
                id: `sidebar-perf-${index}`,
                title: `Performance audit conversation ${index} with a long title to exercise truncation`,
                status: 'ready', deleted: false, pinned: false, forked: false,
                created_at: Math.floor(Date.now() / 1000) - index,
                updated_at: Math.floor(Date.now() / 1000) - index, clock: 1,
            });
            transaction.oncomplete = resolve;
            transaction.onabort = () => reject(transaction.error);
        });
        db.close();
    });
    const cdp = await page.context().newCDPSession(page);
    const runs = [];
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
        for (let run = 0; run < 3; run++) {
            await page.reload();
            await page.getByRole('button', { name: 'Home', exact: true }).first().click();
            await page.getByRole('button', { name: 'Chats', exact: true }).click();
            const scroller = page.locator('.sidebar-scroll');
            await page.getByRole('button', { name: /Open Performance audit conversation/ }).first().waitFor();
            await page.waitForTimeout(700);
            const initial = await scroller.evaluate(el => ({
                trackHeight: el.scrollHeight, viewportHeight: el.clientHeight,
                mountedRows: el.querySelectorAll('.or3-scroll-item').length,
            }));
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.start');
            const sampling = scroller.evaluate(el => new Promise(resolve => {
                window.__sidebarAuditStop = false;
                const gaps = [];
                let previous, frames = 0, entranceAnimations = 0, dateFormats = 0;
                const onAnimation = event => { if (event.animationName === 'sidebar-item-enter') entranceAnimations++; };
                el.addEventListener('animationstart', onAnimation);
                const formatTime = Date.prototype.toLocaleTimeString;
                const formatDate = Date.prototype.toLocaleDateString;
                Date.prototype.toLocaleTimeString = function (...args) { dateFormats++; return formatTime.apply(this, args); };
                Date.prototype.toLocaleDateString = function (...args) { dateFormats++; return formatDate.apply(this, args); };
                const longTasks = [];
                const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
                observer.observe({ type: 'longtask' });
                const sample = timestamp => {
                    const gap = previous === undefined ? 0 : timestamp - previous;
                    previous = timestamp;
                    if (gap) gaps.push(gap);
                    frames++;
                    if (!window.__sidebarAuditStop) requestAnimationFrame(sample);
                    else {
                        Date.prototype.toLocaleTimeString = formatTime;
                        Date.prototype.toLocaleDateString = formatDate;
                        el.removeEventListener('animationstart', onAnimation);
                        observer.disconnect();
                        gaps.sort((a, b) => a - b);
                        resolve({ frames, entranceAnimations, dateFormats, longTasks,
                            frameP95Ms: gaps[Math.floor(gaps.length * 0.95)], maxFrameMs: gaps.at(-1),
                            trackHeight: el.scrollHeight, scrollTop: el.scrollTop });
                    }
                };
                requestAnimationFrame(sample);
            }));
            const box = await scroller.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            for (const direction of [1, -1]) {
                for (let wheel = 0; wheel < 10; wheel++) {
                    await page.mouse.wheel(0, direction * 600);
                    await page.waitForTimeout(80);
                }
            }
            await page.waitForTimeout(300);
            await page.evaluate(() => { window.__sidebarAuditStop = true; });
            const scroll = await sampling;
            const { profile } = await cdp.send('Profiler.stop');
            const selfTime = new Map();
            profile.samples.forEach((id, index) => selfTime.set(id, (selfTime.get(id) ?? 0) + profile.timeDeltas[index]));
            const topFrames = profile.nodes.map(node => ({ frame: node.callFrame, selfMs: (selfTime.get(node.id) ?? 0) / 1000 }))
                .sort((left, right) => right.selfMs - left.selfMs).slice(0, 20);
            runs.push({ initial, scroll, topFrames });
        }
        return { cpuThrottle: 4, seededThreads: 160, wheelEvents: 20, wheelDelta: 600, runs };
    } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.detach();
    }
}
