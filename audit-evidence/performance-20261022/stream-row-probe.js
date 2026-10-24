// Run with the Playwright browser_run_code tool (filename argument) against the disposable journey
// server. This measures the real rendering path with synthetic UI projections;
// it does not measure provider transport or persistence. No app seam is added.
async function streamRowProbe(page) {
    await page.context().route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort('blockedbyclient'));
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto('http://127.0.0.1:3147/__or3-chat-journey-test');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const runs = [];
    try {
        for (let run = 0; run < 3; run++) {
            await page.reload();
            await page.getByRole('textbox', { name: 'Message input' }).waitFor();
            await page.locator('.chat-container-root').evaluate(async (root) => {
                const state = root.__vueParentComponent.setupState;
                const chat = state.chat;
                chat.messages.value = Array.from({ length: 160 }, (_, index) => ({
                    id: `perf-${index}`,
                    role: index % 2 ? 'assistant' : 'user',
                    text: index % 2
                        ? `### Saved answer ${index}\n\nA stable **Markdown** paragraph with a [link](https://example.com).\n\n${'This saved message should stay idle while the next answer streams. '.repeat(8)}`
                        : `Question ${index} about keeping streaming and scrolling smooth.`,
                }));
                chat.streamId.value = 'perf-stream';
                chat.tailAssistant.value = { id: 'perf-tail', role: 'assistant', text: '', pending: true, stream_id: 'perf-stream' };
                chat.loading.value = true;
                chat.streamState.text = 'Starting measured response.';
                await new Promise(resolve => setTimeout(resolve, 1500));
                state.scroller.scrollToBottom({ smooth: false });
            });
            await page.waitForTimeout(1500);
            runs.push(await page.locator('.chat-container-root').evaluate(async (root) => {
                const state = root.__vueParentComponent.setupState;
                const counts = { stableUpdates: 0, tailUpdates: 0, stableDomMutations: 0 };
                const observed = new Set();
                const cleanups = [];
                const observeRows = () => {
                    for (const element of root.querySelectorAll('.chat-message-container')) {
                        const vm = element.__vueParentComponent;
                        if (!vm || observed.has(vm)) continue;
                        observed.add(vm);
                        const tail = vm.props.message.id === 'perf-tail';
                        const update = () => { counts[tail ? 'tailUpdates' : 'stableUpdates']++; };
                        (vm.bu ??= []).push(update);
                        cleanups.push(() => vm.bu.splice(vm.bu.indexOf(update), 1));
                        if (!tail) {
                            const observer = new MutationObserver(records => { counts.stableDomMutations += records.length; });
                            observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
                            cleanups.push(() => observer.disconnect());
                        }
                    }
                };
                const longTasks = [];
                const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
                observer.observe({ type: 'longtask' });
                observeRows();
                const mountedAtStart = observed.size;
                const gaps = [];
                let previous;
                for (let frame = 0; frame < 120; frame++) {
                    const timestamp = await new Promise(resolve => requestAnimationFrame(resolve));
                    if (previous !== undefined) gaps.push(timestamp - previous);
                    previous = timestamp;
                    state.chat.streamState.text += ` smooth token ${frame}`;
                    observeRows();
                }
                await new Promise(resolve => requestAnimationFrame(resolve));
                const tailText = root.querySelector('[data-msg-id="perf-tail"]').textContent;
                const scroll = root.querySelector('.chat-message-list');
                const bottomDistance = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
                observer.disconnect();
                cleanups.forEach(cleanup => cleanup());
                gaps.sort((a, b) => a - b);
                return { ...counts, mountedAtStart, mountedTotal: observed.size,
                    frameP95Ms: gaps[Math.floor(gaps.length * 0.95)], maxFrameMs: gaps.at(-1),
                    longTasks, bottomDistance, complete: tailText.includes('smooth token 119') };
            }));
        }
        return { cpuThrottle: 4, historyRows: 160, tokenFrames: 120, runs };
    } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.detach();
    }
}
