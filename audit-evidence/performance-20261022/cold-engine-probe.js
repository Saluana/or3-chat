// Build cold-engine-fixture.js + cold-engine-worker.js and run the local fixture
// server on 3148 first. This is an isolated diagnostic, not the application.
async function coldEngineProbe(page, options = {}) {
    const results = [];
    let reference;
    for (let repeat = 0; repeat < (options.repeats ?? 2); repeat++) {
        for (const mode of options.modes ?? ['js', 'wasm', 'worker']) {
            const context = await page.context().browser().newContext();
            let cdp;
            try {
                await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
                const p = await context.newPage();
                await p.goto('http://127.0.0.1:3148/'); await p.bringToFront();
                cdp = await context.newCDPSession(p);
                await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuRate ?? 4 });
                const data = await p.evaluate(async mode => {
                    const tasks = [], gaps = [];
                    let frame, previous, worker, timeout;
                    const tick = time => { if (previous !== undefined) gaps.push(time - previous); previous = time; frame = requestAnimationFrame(tick); };
                    frame = requestAnimationFrame(tick);
                    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
                    observer.observe({ type: 'longtask' });
                    try {
                        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                        const start = performance.now();
                        const result = mode === 'worker'
                            ? await new Promise((resolve, reject) => {
                                worker = new Worker('/cold-engine-worker.js', { type: 'module' });
                                timeout = setTimeout(() => reject(new Error('Worker fixture timed out')), 10_000);
                                worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
                                worker.onerror = reject; worker.postMessage({});
                            })
                            : await (await import('/cold-engine-fixture.js')).measureEngine(mode);
                        const elapsed = performance.now() - start;
                        await new Promise(resolve => setTimeout(resolve, 100));
                        gaps.sort((a, b) => a - b);
                        return { mode, elapsed, tasks, maxGap: gaps.at(-1), frames: gaps.length, result };
                    } finally {
                        clearTimeout(timeout); worker?.terminate();
                        cancelAnimationFrame(frame); observer.disconnect();
                    }
                }, mode);
                reference ??= data.result.html;
                results.push({ ...data, repeat, result: { ...data.result, html: undefined }, htmlMatchesFirst: data.result.html === reference });
            } finally {
                if (cdp) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach(); }
                await context.close();
            }
        }
    }
    return { mainThreadCpuRate: options.cpuRate ?? 4, workerCpuThrottled: false, results };
}
