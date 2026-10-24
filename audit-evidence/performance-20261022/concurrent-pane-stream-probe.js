// Real workspace panes and controller; disposable synthetic history/transport.
async function concurrentPaneStreamProbe(page, options = {}) {
    const context=await page.context().browser().newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
    const p=await context.newPage();p.setDefaultTimeout(20000);
    let cdp;
    let highlightControlApplied=0;
    const traceEvents=[];
    try {
        await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
        // Same-build control: bypass only the host's asynchronous adapter prop.
        // The library then uses its original main-thread highlighter and UI.
        if(options.mainThreadHighlightControl)await p.route(`**/_nuxt/${options.mainThreadHighlightControl.bundle}`,async route=>{
            const response=await route.fetch(),body=await response.text();
            const {needle,replacement}=options.mainThreadHighlightControl;
            if(body.split(needle).length!==2)throw new Error('Unmatched highlighting adapter control');
            highlightControlApplied++;
            await route.fulfill({response,body:body.replace(needle,replacement)});
        });
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
        if(options.restoreMoreSelector)await p.evaluate(()=>{
            let changed=0;
            const visit=rules=>{for(const rule of rules){
                if(rule.selectorText?.includes('body[data-or3-more-open]')){
                    changed+=rule.selectorText.split('body[data-or3-more-open]').length-1;
                    rule.selectorText=rule.selectorText.replaceAll('body[data-or3-more-open]','body:has(.more-sheet-root)');
                }
                if(rule.cssRules)visit(rule.cssRules);
            }};for(const sheet of document.styleSheets)visit(sheet.cssRules);
            if(changed!==2)throw new Error('Unmatched More selector control '+changed);
        });
        if(options.containment){
            await p.addStyleTag({content:(options.containment==='rows'?'.chat-message-list .or3-scroll-item':'.chat-message-list')+' { contain: layout style; }'});
            await p.waitForTimeout(100);
        }
        if(options.layoutSelectorControl)await p.evaluate(()=>{
            const before=getComputedStyle(document.body).zoom;let changed=0;
            document.documentElement.setAttribute('data-perf-layout-control','');
            const visit=rules=>{for(const rule of rules){if(rule.selectorText?.includes('html:has(#page-container)')){rule.selectorText=rule.selectorText.replaceAll('html:has(#page-container)','html[data-perf-layout-control]');changed++;}if(rule.cssRules)visit(rule.cssRules);}};
            for(const sheet of document.styleSheets)visit(sheet.cssRules);
            if(changed!==2||getComputedStyle(document.body).zoom!==before)throw new Error('Layout selector control did not preserve scale');
        });

        const prose=Array.from({length:50},(_,i)=>`Paragraph ${i}: **Both conversations are streaming** while one reader stays in settled history. `+'More words keep the response growing. '.repeat(3)+'\n\n').join('');
        const rich=Array.from({length:12},(_,i)=>`### Example ${i}\n\nA TypeScript sample and inline math $x^2 + y^2$.\n\n\`\`\`ts\nexport function calculate${i}(values: number[]): number {\n  return values.map(value => value * 2).reduce((sum, value) => sum + value, 0);\n}\n\`\`\`\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n\n`).join('');
        const responses=Object.fromEntries(['left','right'].map(side=>[side,(options.rich?rich:prose)+`CONCURRENT-${side.toUpperCase()}-END`]));
        await p.evaluate(({responses,dbCounts,synchronized,observeRich})=>{
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
                const richNodes=[];let richObserver;
                let frame,previous;
                const tick=t=>{if(previous!==undefined)metrics.gaps.push(t-previous);previous=t;
                    if(observeRich&&!richObserver&&states.right.produced>=512){
                        const rich=roots[1].querySelector('h3')?.closest('.streamdown-vue');
                        if(rich){richNodes.push(...['h3','pre','.katex'].map(selector=>rich.querySelector(selector)).filter(Boolean));metrics.richMutations={count:0,examples:[]};richObserver=new MutationObserver(records=>{metrics.richMutations.count+=records.length;for(const record of records){if(metrics.richMutations.examples.length<10)metrics.richMutations.examples.push({type:record.type,attribute:record.attributeName,target:record.target.nodeName,afterTransportDone:Boolean(states.right.done)});}});for(const el of richNodes)richObserver.observe(el,{subtree:true,attributes:true,childList:true,characterData:true});}
                    }
                    frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
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
                    richObserver?.disconnect();if(richObserver)metrics.richNodesRetained=richNodes.map(el=>({tag:el.tagName,connected:el.isConnected}));
                    for(const [method,original] of Object.entries(originals))IDBIndex.prototype[method]=original;
                    metrics.after=anchorState();metrics.elapsed=performance.now()-metrics.start;metrics.gaps.sort((a,b)=>a-b);
                    return {...metrics,p95:metrics.gaps[Math.floor(metrics.gaps.length*.95)],max:metrics.gaps.at(-1),frames:metrics.gaps.length,gaps:undefined,states,
                        overlapMs:Math.min(...Object.values(states).map(state=>state.end))-Math.max(...Object.values(states).map(state=>state.firstChunk))};
                };
                releaseStreams?.();
            };
        },{responses,dbCounts:options.dbCounts??true,synchronized:options.synchronized??false,observeRich:options.rich??false});
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
        if(options.profile){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
        if(options.trace){
            cdp.on('Tracing.dataCollected',event=>traceEvents.push(...event.value));
            await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking',transferMode:'ReportEvents'});
        }
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
                rightHighlightedBlocks:roots[1].querySelectorAll('pre.shiki').length,rightCodeBlocks:roots[1].querySelectorAll('[data-streamdown="code-block"]').length,
                rightComplete:roots[1].textContent.includes('CONCURRENT-RIGHT-END'),leftEndInitiallyOffscreen:!roots[0].textContent.includes('CONCURRENT-LEFT-END'),
                bottoms:roots.map(root=>{const s=root.querySelector('.chat-message-list');return s.scrollHeight-s.clientHeight-s.scrollTop;}),
                theme:document.documentElement.dataset.theme,zoom:getComputedStyle(document.body).zoom};
        });
        if(options.profile){
            const {profile}=await cdp.send('Profiler.stop');
            const byId=new Map(profile.nodes.map(node=>[node.id,node]));
            const parent=new Map(profile.nodes.flatMap(node=>(node.children??[]).map(id=>[id,node.id])));
            const selfTime=new Map();profile.samples.forEach((id,index)=>selfTime.set(id,(selfTime.get(id)??0)+profile.timeDeltas[index]));
            const frame=node=>({name:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber,column:node.callFrame.columnNumber});
            result.profile={durationMs:(profile.endTime-profile.startTime)/1000,topFrames:profile.nodes.map(node=>{
                const ancestors=[];let id=parent.get(node.id);while(id&&ancestors.length<10){const p=byId.get(id);ancestors.push(frame(p));id=parent.get(id);}
                return {...frame(node),selfMs:(selfTime.get(node.id)??0)/1000,ancestors};
            }).sort((a,b)=>b.selfMs-a.selfMs).slice(0,45)};
        }
        if(options.trace){
            const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
            await cdp.send('Tracing.end');await complete;
            const groups=new Map();
            for(const event of traceEvents){const value=groups.get(event.name)??{count:0,ms:0};value.count++;value.ms+=(event.dur??0)/1000;groups.set(event.name,value);}
            const invalidations=new Map();for(const event of traceEvents.filter(event=>event.name.includes('InvalidationTracking'))){const key=JSON.stringify({name:event.name,nodeName:event.args?.data?.nodeName,reason:event.args?.data?.reason,selector:event.args?.data?.selectorPart});invalidations.set(key,(invalidations.get(key)??0)+1);}
            result.trace={events:traceEvents.length,totals:[...groups].map(([name,value])=>({name,...value})).sort((a,b)=>b.ms-a.ms),
                largestLayout:traceEvents.filter(event=>['Layout','UpdateLayoutTree'].includes(event.name)).sort((a,b)=>(b.dur??0)-(a.dur??0)).slice(0,15),
                invalidations:[...invalidations].map(([key,count])=>({key:JSON.parse(key),count})).sort((a,b)=>b.count-a.count).slice(0,30),
                sampleInvalidations:traceEvents.filter(event=>event.name.includes('InvalidationTracking')).slice(0,20)};
        }
        await panes.first().locator('.chat-scroll-to-bottom').click();
        await panes.first().getByText('CONCURRENT-LEFT-END',{exact:false}).waitFor();
        result.leftRevealed=true;
        result.highlightControlApplied=highlightControlApplied;
        result.highlightingWorkers=p.workers().filter(worker=>worker.url().includes('markdown-highlight.worker')).length;
        if(options.screenshot)await p.screenshot({path:options.screenshot,animations:'disabled'});
        return result;
    } finally {
        if(cdp){await cdp.send('Emulation.setCPUThrottlingRate',{rate:1}).catch(()=>{});await cdp.detach();}
        await context.close();
    }
}

