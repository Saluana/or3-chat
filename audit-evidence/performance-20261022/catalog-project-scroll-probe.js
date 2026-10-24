// Disposable synthetic browser context; no production account or external requests.
async function catalogProjectScrollProbe(page) {
    const context = await page.context().browser().newContext({
        viewport: { width: 1200, height: 689 }, deviceScaleFactor: 2,
    });
    const p = await context.newPage();
    p.setDefaultTimeout(10_000);
    const models = Array.from({ length: 600 }, (_, i) => ({
        id: `openai/audit-${String(i).padStart(3, '0')}`,
        name: `Audit model ${String(i).padStart(3, '0')}`,
        context_length: 128000, supported_parameters: ['tools', 'temperature'],
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        pricing: { prompt: '0.000002', completion: '0.000006' },
    }));
    let cdp;
    try {
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
            ? route.continue() : route.abort());
        await p.route(/\/api\/(?:__or3-e2e\/models|v1\/models)/, route => route.fulfill({ json: { data: models, links: { next: null }, total_count: models.length } }));
        await p.addInitScript(models => {
            localStorage.setItem('openrouter_model_catalog_v1', JSON.stringify({ data: models, fetchedAt: Date.now() }));
            localStorage.setItem('activeTheme', 'blank'); localStorage.setItem('theme', 'light');
        }, models);
        await context.addCookies([{ name: 'or3_active_theme', value: 'blank', domain: '127.0.0.1', path: '/' }]);
        await p.goto('http://127.0.0.1:3147/__or3-chat-journey-test?workspace=1');
        await p.locator('#nav-scroll-area').waitFor();
        await p.evaluate(async () => {
            const name = (await indexedDB.databases()).find(entry => entry.name?.startsWith('or3-db'))?.name;
            if (!name) throw new Error('Missing disposable fixture database');
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            await new Promise((resolve, reject) => {
                const tx = db.transaction('projects', 'readwrite');
                for (let i = 0; i < 600; i++) tx.objectStore('projects').put({
                    id: `audit-project-${i}`, name: `Audit project ${String(i).padStart(3, '0')}`,
                    description: i % 3 === 0 ? 'A project description with enough text to exercise truncation' : '',
                    data: [], clock: 1, deleted: false, created_at: 1000 + i, updated_at: 1000 + i,
                });
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            });
            db.close();
        });
        await p.goto('http://127.0.0.1:3147/chat');
        await p.bringToFront();
        await p.getByRole('button', { name: 'Projects', exact: true }).click();
        cdp = await context.newCDPSession(p);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const results = [];
        for (const surface of ['projects', 'models']) {
            if (surface === 'models') {
                await p.getByRole('button', { name: 'Settings', exact: true }).click();
                await p.getByRole('button', { name: 'Model catalog Browse and compare available models.', exact: true }).click();
            }
            const scroller = p.locator(surface === 'projects' ? '.sidebar-projects-page .or3-scroll' : '.model-catalog-list__rows');
            await scroller.waitFor();
            const box = await scroller.boundingBox();
            for (let run = 0; run < 3; run++) {
                await scroller.evaluate(el => { el.scrollTop = 0; });
                await p.waitForTimeout(500);
                const initial = await scroller.evaluate(el => ({
                    theme: document.documentElement.dataset.theme, dark: document.documentElement.classList.contains('dark'),
                    zoom: getComputedStyle(document.body).zoom, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
                    height: el.clientHeight, track: el.scrollHeight, mounted: el.querySelectorAll('.or3-scroll-item').length,
                }));
                const sampling = scroller.evaluate(el => new Promise(resolve => {
                    const gaps = [], longTasks = []; let previous, frame, timer, numberFormats = 0;
                    const original = Intl.NumberFormat;
                    Intl.NumberFormat = new Proxy(original, { construct(target, args) {
                        numberFormats++; return Reflect.construct(target, args);
                    } });
                    window.__listAuditStop = false;
                    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
                    observer.observe({ type: 'longtask' });
                    const finish = timedOut => {
                        clearTimeout(timer); cancelAnimationFrame(frame); observer.disconnect(); Intl.NumberFormat = original; gaps.sort((a,b) => a-b);
                        resolve({ timedOut, numberFormats, p95: gaps[Math.floor(gaps.length * .95)], max: gaps.at(-1), frames: gaps.length,
                            longTasks, scrollTop: el.scrollTop, track: el.scrollHeight,
                            mounted: el.querySelectorAll('.or3-scroll-item').length });
                    };
                    const tick = t => { if (previous !== undefined) gaps.push(t-previous); previous=t;
                        if (window.__listAuditStop) finish(false); else frame=requestAnimationFrame(tick); };
                    timer=setTimeout(()=>finish(true),20000); frame=requestAnimationFrame(tick);
                }));
                await p.mouse.move(box.x+box.width/2,box.y+box.height/2);
                for (const direction of [1,-1]) for (let wheel=0;wheel<10;wheel++) {
                    await p.mouse.wheel(0,direction*600);await p.waitForTimeout(80);
                }
                await p.waitForTimeout(300);await p.evaluate(()=>{window.__listAuditStop=true;});
                results.push({surface,run,initial,scroll:await sampling});
            }
        }
        return { seededProjects:600,seededModels:600,cpuThrottle:4,wheelEvents:20,wheelDelta:600,results };
    } finally {
        if (cdp) { await cdp.send('Emulation.setCPUThrottlingRate',{rate:1}).catch(()=>{});await cdp.detach(); }
        await context.close();
    }
}
