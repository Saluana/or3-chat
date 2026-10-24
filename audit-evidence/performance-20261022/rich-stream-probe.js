// Measures production controller, renderer and persistence with a synthetic local SSE transport.
async function richStreamProbe(page, options = {}) {
    const results = [];
    const block = i => `## Section ${i}\n\nA settled paragraph with **bold** and _italic_ text, [a link](https://example.com) and an inline \`identifier\`.\n\n- Preserve completed output.\n- Render the changing tail.\n\n\`\`\`typescript\n${Array.from({ length: 12 }, (_, j) => `const value${j} = ${i} + ${j}; // retained code line`).join('\n')}\n\`\`\`\n\n$$\n\\frac{${i + 1}}{2} + \\sum_{k=1}^{n} k^2\n$$\n\n| Item | Value |\n| --- | --- |\n| Section | ${i} |\n\n`;
    for (const cpu of options.cpuRates ?? [1, 4]) for (const kind of options.kinds ?? ['prose', 'rich']) {
        const context = await page.context().browser().newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
        const p = await context.newPage(); p.setDefaultTimeout(60_000);
        let cdp;
        try {
            await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
            await p.route('**/api/__or3-e2e/models*', route => route.fulfill({json:{data:[],links:{next:null},total_count:0}}));
            await p.goto('http://127.0.0.1:3147/__or3-chat-journey-test');
            await p.getByRole('textbox',{name:'Message input'}).waitFor(); await p.bringToFront();
            // Optional diagnostic control: restore only the two old selectors
            // in this disposable document, keeping all declarations unchanged.
            if (options.selector === 'original') await p.evaluate(() => {
                let changed = 0;
                const visit = rules => {
                    for (const rule of rules) {
                        if (rule.selectorText?.includes('group-has-focus-visible')) {
                            const boundary = rule.selectorText.indexOf(' .group-has-focus-visible');
                            if (boundary < 0) continue;
                            const ancestor = rule.selectorText.slice(0, boundary);
                            const target = rule.selectorText.slice(boundary + 1);
                            rule.selectorText = `${target}:is(${ancestor} *)`;
                            changed++;
                        }
                        if (rule.cssRules) visit(rule.cssRules);
                    }
                };
                for (const sheet of document.styleSheets) {
                    try { visit(sheet.cssRules); } catch { /* Cross-origin sheets are irrelevant. */ }
                }
                if (changed !== 2) throw new Error(`Expected two scoped focus rules, found ${changed}`);
            });
            const text = (kind === 'rich' ? Array.from({length:12},(_,i)=>block(i)).join('') : 'A plain streaming paragraph should remain responsive as more text arrives. '.repeat(130)) + '\n\nPERFORMANCE-END';
            await p.evaluate(text => {
                const originalFetch = window.fetch;
                const encoder = new TextEncoder();
                window.__richExpected = text;
                window.__richTransportDone = false;
                window.fetch = async (input, init) => {
                    const url = input instanceof Request ? input.url : String(input);
                    if (!url.includes('/api/__or3-e2e/chat/completions')) return originalFetch(input, init);
                    const root=document.querySelector('.chat-container-root');
                    const metrics={start:performance.now(),gaps:[],longTasks:[],mutations:0,stableMutations:0,stableObserved:false,produced:0};
                    window.__richMetrics=metrics;
                    let previous, frame, stable;
                    const tasks=new PerformanceObserver(list=>metrics.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));tasks.observe({type:'longtask'});
                    const mutation=new MutationObserver(records=>{metrics.mutations+=records.length;});mutation.observe(root,{childList:true,subtree:true,characterData:true});
                    const tick=t=>{
                        if(previous!==undefined)metrics.gaps.push(t-previous);previous=t;
                        if(!stable && metrics.produced>1500){const node=root.querySelector('.cm-markdown-assistant p');if(node){stable=new MutationObserver(r=>{metrics.stableMutations+=r.length;});stable.observe(node,{childList:true,subtree:true,characterData:true});metrics.stableObserved=true;}}
                        frame=requestAnimationFrame(tick);
                    };frame=requestAnimationFrame(tick);
                    window.__finishRichMetrics=()=>{cancelAnimationFrame(frame);tasks.disconnect();mutation.disconnect();stable?.disconnect();
                        metrics.elapsed=performance.now()-metrics.start;metrics.gaps.sort((a,b)=>a-b);
                        return {...metrics,p95:metrics.gaps[Math.floor(metrics.gaps.length*.95)],max:metrics.gaps.at(-1),gaps:undefined};};
                    const signal=init?.signal??(input instanceof Request?input.signal:null);
                    const stream=new ReadableStream({async start(controller){
                        try{
                            for(let offset=0;offset<text.length;offset+=64){
                                if(signal?.aborted)throw new DOMException('Aborted','AbortError');
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content:text.slice(offset,offset+64)},finish_reason:null}]})}\n\n`));
                                metrics.produced=Math.min(offset+64,text.length);await new Promise(r=>setTimeout(r,16));
                            }
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();window.__richTransportDone=true;
                        }catch(error){controller.error(error);}
                    }});
                    return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
                };
            }, text);
            cdp=await context.newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
            await p.getByRole('textbox',{name:'Message input'}).fill('Measure the local rich response.');
            await p.getByRole('button',{name:'Send message',exact:true}).click();
            await p.waitForFunction(()=>window.__richTransportDone===true,{},{timeout:60_000});
            await p.getByRole('button',{name:'Send message',exact:true}).waitFor();
            await p.waitForTimeout(400);
            const result=await p.evaluate(async()=>{
                const metrics=window.__finishRichMetrics();
                const scroller=document.querySelector('.chat-message-list');
                const name=(await indexedDB.databases()).find(x=>x.name?.startsWith('or3-db')).name;
                const db=await new Promise(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);});
                const rows=await new Promise(resolve=>{const r=db.transaction('messages').objectStore('messages').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
                return { ...metrics, savedExact:rows.some(row=>row.role==='assistant'&&row.data?.content===window.__richExpected),
                    complete:document.body.textContent.includes('PERFORMANCE-END'),math:document.querySelectorAll('.katex').length,
                    code:document.querySelectorAll('.cm-markdown-assistant pre').length,
                    nodes:document.querySelector('.chat-container-root').querySelectorAll('*').length,
                    bottomDistance:scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop,
                    theme:document.documentElement.dataset.theme,zoom:getComputedStyle(document.body).zoom };
            });
            results.push({cpu,kind,selector:options.selector??'production',bytes:text.length,chunkChars:64,delayMs:16,...result});
        } finally {
            if(cdp){await cdp.send('Emulation.setCPUThrottlingRate',{rate:1}).catch(()=>{});await cdp.detach();}await context.close();
        }
    }
    return {results};
}
