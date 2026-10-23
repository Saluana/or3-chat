// Real workspace panes and controller; disposable synthetic history/transport.
async function concurrentPaneStreamProbe(page, options = {}) {
    const context=await page.context().browser().newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
    const p=await context.newPage();p.setDefaultTimeout(20000);
    let cdp;
    try {
        await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
        await context.addCookies([
            {name:'or3_active_theme',value:'blank',domain:'127.0.0.1',path:'/'},
            {name:'or3_workspace_profile_v1',value:encodeURIComponent(JSON.stringify({version:1,workspaceId:'local',profileId:'standard-or3'})),domain:'127.0.0.1',path:'/'},
        ]);
        await p.addInitScript(()=>{localStorage.setItem('activeTheme','blank');localStorage.setItem('theme','light');});
        await p.goto('http://127.0.0.1:3147/__or3-chat-journey-test?workspace=1');await p.bringToFront();
        await p.getByRole('button',{name:'New split',exact:true}).waitFor();
        await p.evaluate(async()=>{
            const name=(await indexedDB.databases()).find(d=>d.name?.startsWith('or3-db'))?.name;
            if(!name)throw new Error('Missing disposable DB');
            const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
            await new Promise((resolve,reject)=>{
                const tx=db.transaction(['threads','messages'],'readwrite');
                for(const side of ['left','right']){
                    const id=`pane-audit-${side}`;
                    tx.objectStore('threads').put({id,title:`Audit ${side} history`,status:'ready',deleted:false,pinned:false,forked:false,created_at:1000,updated_at:1000,clock:1});
                    for(let i=0;i<120;i++)tx.objectStore('messages').put({
                        id:`${id}-${i}`,thread_id:id,index:i,role:i%2?'assistant':'user',
                        created_at:1000+i,updated_at:1000+i,clock:1,pending:false,deleted:false,
                        data:{content:`History ${side} ${i}\n\n`+'A retained paragraph should stay still while the neighboring conversation streams. '.repeat(6)},
                    });
                }
                tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
            });db.close();
        });
        await p.reload();await p.getByRole('button',{name:'Chats',exact:true}).click();
        await p.getByRole('button',{name:'Open Audit left history',exact:true}).click();
        await p.getByRole('button',{name:'New split',exact:true}).click();
        await p.getByRole('button',{name:'Open Audit right history',exact:true}).click();
        const panes=p.locator('.pane-container > [role="tabpanel"]');
        await panes.nth(1).getByRole('textbox',{name:'Message input'}).waitFor();
        await p.waitForTimeout(500);
        await panes.first().locator('.chat-message-list').evaluate(el=>{el.scrollTop=el.scrollHeight*.45;});
        await p.waitForTimeout(300);

        const prose=Array.from({length:50},(_,i)=>`Paragraph ${i}: **Both conversations are streaming** while one reader stays in settled history. `+'More words keep the response growing. '.repeat(3)+'\n\n').join('');
        const rich=Array.from({length:12},(_,i)=>`### Example ${i}\n\nA TypeScript sample and inline math $x^2 + y^2$.\n\n\`\`\`ts\nexport function calculate${i}(values: number[]): number {\n  return values.map(value => value * 2).reduce((sum, value) => sum + value, 0);\n}\n\`\`\`\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n\n`).join('');
        const responses=Object.fromEntries(['left','right'].map(side=>[side,(options.rich?rich:prose)+`CONCURRENT-${side.toUpperCase()}-END`]));
        await p.evaluate(({responses,dbCounts,synchronized})=>{
            const roots=[...document.querySelectorAll('.pane-container > [role="tabpanel"]')];
            const scroll=roots[0].querySelector('.chat-message-list');
            const states={left:{produced:0},right:{produced:0}};
            // Rich cold rendering can outlast a short second-send interaction.
            // Optional gating starts both synthetic transports after admission.
            let releaseStreams;
            const startGate=synchronized?new Promise(resolve=>{releaseStreams=resolve;}):Promise.resolve();
            window.__concurrentStates=states;window.__concurrentExpected=responses;
            const originalFetch=window.fetch;
            window.fetch=async(input,init)=>{
                const url=input instanceof Request?input.url:String(input);
                if(!url.includes('/api/__or3-e2e/chat/completions'))return originalFetch(input,init);
                const body=JSON.parse(init?.body??await input.clone().text());
                const side=JSON.stringify(body.messages.at(-1)).includes('Measure concurrent left')?'left':'right';
                if(states[side].start!==undefined)throw new Error('Unexpected duplicate stream '+side);
                states[side].start=performance.now();
                const responseText=responses[side];
                const signal=init?.signal??(input instanceof Request?input.signal:null);const encoder=new TextEncoder();
                const stream=new ReadableStream({async start(controller){try{
                    await startGate;states[side].firstChunk=performance.now();
                    for(let offset=0;offset<responseText.length;offset+=64){
                        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content:responseText.slice(offset,offset+64)},finish_reason:null}]})}\n\n`));
                        states[side].produced=Math.min(offset+64,responseText.length);await new Promise(resolve=>setTimeout(resolve,16));
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();states[side].end=performance.now();states[side].done=true;
                }catch(error){states[side].error=String(error);controller.error(error);}}});
                return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
            };
            window.__beginConcurrent=()=>{
                if(Object.values(states).some(state=>state.start===undefined||state.done))throw new Error('Measurement must start during both streams');
                const rectangle=scroll.getBoundingClientRect();
                const visible=[...scroll.querySelectorAll('[data-msg-id]')].filter(el=>{const box=el.getBoundingClientRect();return box.bottom>rectangle.top+20&&box.top<rectangle.bottom;});
                const anchor=visible[0];if(!anchor)throw new Error('No settled anchor');
                const anchorState=()=>({scrollTop:scroll.scrollTop,id:anchor.getAttribute('data-msg-id'),connected:anchor.isConnected,offset:anchor.getBoundingClientRect().top-scroll.getBoundingClientRect().top});
                const metrics={reads:{},settledMutations:0,mutationExamples:[],visibleIds:visible.map(el=>el.getAttribute('data-msg-id')),gaps:[],longTasks:[],start:performance.now(),before:anchorState(),producedAtStart:structuredClone(states)};
                let frame,previous;
                const tick=t=>{if(previous!==undefined)metrics.gaps.push(t-previous);previous=t;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
                const tasks=new PerformanceObserver(list=>metrics.longTasks.push(...list.getEntries().map(e=>e.duration)));tasks.observe({type:'longtask'});
                const observer=new MutationObserver(records=>{metrics.settledMutations+=records.length;for(const record of records){if(metrics.mutationExamples.length<12)metrics.mutationExamples.push({type:record.type,attribute:record.attributeName,message:record.target.closest?.('[data-msg-id]')?.getAttribute('data-msg-id'),target:record.target.outerHTML?.slice(0,700),afterTransportDone:Boolean(states.left.done)});}});
                for(const el of visible)observer.observe(el,{subtree:true,childList:true,characterData:true,attributes:true});
                const originals={};
                if(dbCounts)for(const method of ['getAll','openCursor']){
                    originals[method]=IDBIndex.prototype[method];
                    IDBIndex.prototype[method]=function(...args){
                        if(this.objectStore.name==='messages'&&this.name==='[thread_id+index]'){
                            const id=args[0]?.lower?.[0];if(id?.startsWith('pane-audit-'))metrics.reads[id]=(metrics.reads[id]||0)+1;
                        }
                        return originals[method].apply(this,args);
                    };
                }
                window.__finishConcurrent=()=>{
                    cancelAnimationFrame(frame);tasks.disconnect();observer.disconnect();window.fetch=originalFetch;
                    for(const [method,original] of Object.entries(originals))IDBIndex.prototype[method]=original;
                    metrics.after=anchorState();metrics.elapsed=performance.now()-metrics.start;metrics.gaps.sort((a,b)=>a-b);
                    return {...metrics,p95:metrics.gaps[Math.floor(metrics.gaps.length*.95)],max:metrics.gaps.at(-1),frames:metrics.gaps.length,gaps:undefined,states,
                        overlapMs:Math.min(...Object.values(states).map(state=>state.end))-Math.max(...Object.values(states).map(state=>state.firstChunk))};
                };
                releaseStreams?.();
            };
        },{responses,dbCounts:options.dbCounts??true,synchronized:options.synchronized??false});
        cdp=await context.newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:options.cpuRate??4});
        await panes.nth(1).getByRole('textbox',{name:'Message input'}).fill('Measure concurrent right.');
        await panes.nth(1).getByRole('button',{name:'Send message',exact:true}).click();
        await p.waitForFunction(()=>window.__concurrentStates.right.start!==undefined);
        await panes.first().getByRole('textbox',{name:'Message input'}).fill('Measure concurrent left.');
        await panes.first().getByRole('button',{name:'Send message',exact:true}).click();
        await p.waitForFunction(()=>window.__concurrentStates.left.start!==undefined);
        // User browsing begins after both sends; follow-bottom on send is expected.
        await panes.first().locator('.chat-message-list').evaluate(el=>{el.scrollTop=el.scrollHeight*.45;});
        await p.waitForTimeout(150);
        await p.evaluate(()=>window.__beginConcurrent());
        await p.waitForFunction(()=>Object.values(window.__concurrentStates).every(state=>state.done),{},{timeout:60000});
        for(let i=0;i<2;i++)await panes.nth(i).getByRole('button',{name:'Send message',exact:true}).waitFor();
        await p.waitForTimeout(500);
        const result=await p.evaluate(async()=>{
            const metrics=window.__finishConcurrent();
            const name=(await indexedDB.databases()).find(d=>d.name?.startsWith('or3-db')).name;
            const db=await new Promise(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);});
            const rows=await new Promise(resolve=>{const r=db.transaction('messages').objectStore('messages').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
            const roots=[...document.querySelectorAll('.pane-container > [role="tabpanel"]')];
            return {...metrics,savedExact:Object.fromEntries(['left','right'].map(side=>[side,rows.some(row=>row.thread_id==='pane-audit-'+side&&row.role==='assistant'&&row.data?.content===window.__concurrentExpected[side])])),
                rightComplete:roots[1].textContent.includes('CONCURRENT-RIGHT-END'),leftEndInitiallyOffscreen:!roots[0].textContent.includes('CONCURRENT-LEFT-END'),
                bottoms:roots.map(root=>{const s=root.querySelector('.chat-message-list');return s.scrollHeight-s.clientHeight-s.scrollTop;}),
                theme:document.documentElement.dataset.theme,zoom:getComputedStyle(document.body).zoom};
        });
        await panes.first().locator('.chat-scroll-to-bottom').click();
        await panes.first().getByText('CONCURRENT-LEFT-END',{exact:false}).waitFor();
        result.leftRevealed=true;
        return result;
    } finally {
        if(cdp){await cdp.send('Emulation.setCPUThrottlingRate',{rate:1}).catch(()=>{});await cdp.detach();}
        await context.close();
    }
}

