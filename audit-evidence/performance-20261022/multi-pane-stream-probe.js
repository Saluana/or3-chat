// Real workspace panes and controller; disposable synthetic history/transport.
async function multiPaneStreamProbe(page, options = {}) {
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
        const responseText=Array.from({length:50},(_,i)=>`Paragraph ${i}: **A stream in the neighboring pane** must not recreate this settled history. `+'More words keep the response growing. '.repeat(3)+'\n\n').join('')+'MULTI-PANE-END';
        await p.evaluate(({responseText,dbCounts})=>{
            const roots=[...document.querySelectorAll('.pane-container > [role="tabpanel"]')];
            const metrics={reads:{},mutations:0,mutationExamples:[],gaps:[],longTasks:[],produced:0};
            window.__multiMetrics=metrics;window.__multiExpected=responseText;window.__multiDone=false;
            const scroll=roots[0].querySelector('.chat-message-list');
            const rectangle=scroll.getBoundingClientRect();
            const anchor=[...scroll.querySelectorAll('[data-msg-id]')].find(el=>el.getBoundingClientRect().bottom>rectangle.top+20);
            const anchorState=()=>({scrollTop:scroll.scrollTop,id:anchor?.getAttribute('data-msg-id'),offset:anchor?.getBoundingClientRect().top-scroll.getBoundingClientRect().top});
            const originalFetch=window.fetch;
            window.fetch=async(input,init)=>{
                const url=input instanceof Request?input.url:String(input);
                if(!url.includes('/api/__or3-e2e/chat/completions'))return originalFetch(input,init);
                metrics.before=anchorState();metrics.start=performance.now();
                let frame,previous;
                const tick=t=>{if(previous!==undefined)metrics.gaps.push(t-previous);previous=t;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
                const tasks=new PerformanceObserver(list=>metrics.longTasks.push(...list.getEntries().map(e=>e.duration)));tasks.observe({type:'longtask'});
                const observer=new MutationObserver(records=>{metrics.mutations+=records.length;for(const record of records){if(metrics.mutationExamples.length<12)metrics.mutationExamples.push({type:record.type,target:record.target.nodeName,message:record.target.parentElement?.closest('[data-msg-id]')?.getAttribute('data-msg-id')});}});
                observer.observe(roots[0],{subtree:true,childList:true,characterData:true,attributes:true});
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
                window.__finishMulti=()=>{
                    cancelAnimationFrame(frame);tasks.disconnect();observer.disconnect();
                    for(const [method,original] of Object.entries(originals))IDBIndex.prototype[method]=original;
                    metrics.after=anchorState();metrics.elapsed=performance.now()-metrics.start;metrics.gaps.sort((a,b)=>a-b);
                    return {...metrics,p95:metrics.gaps[Math.floor(metrics.gaps.length*.95)],max:metrics.gaps.at(-1),frames:metrics.gaps.length,gaps:undefined};
                };
                const signal=init?.signal??(input instanceof Request?input.signal:null);const encoder=new TextEncoder();
                const stream=new ReadableStream({async start(controller){try{
                    for(let offset=0;offset<responseText.length;offset+=64){
                        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content:responseText.slice(offset,offset+64)},finish_reason:null}]})}\n\n`));
                        metrics.produced=Math.min(offset+64,responseText.length);await new Promise(resolve=>setTimeout(resolve,16));
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();window.__multiDone=true;
                }catch(error){controller.error(error);}}});
                return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
            };
        },{responseText,dbCounts:options.dbCounts??true});
        cdp=await context.newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:options.cpuRate??4});
        await panes.nth(1).getByRole('textbox',{name:'Message input'}).fill('Measure a neighboring stream.');
        await panes.nth(1).getByRole('button',{name:'Send message',exact:true}).click();
        await p.waitForFunction(()=>window.__multiDone===true,{},{timeout:60000});
        await panes.nth(1).getByRole('button',{name:'Send message',exact:true}).waitFor();await p.waitForTimeout(500);
        return await p.evaluate(async()=>{
            const metrics=window.__finishMulti();
            const name=(await indexedDB.databases()).find(d=>d.name?.startsWith('or3-db')).name;
            const db=await new Promise(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);});
            const rows=await new Promise(resolve=>{const r=db.transaction('messages').objectStore('messages').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
            const right=document.querySelectorAll('.pane-container > [role="tabpanel"]')[1];const scroll=right.querySelector('.chat-message-list');
            return {...metrics,savedExact:rows.some(row=>row.thread_id==='pane-audit-right'&&row.role==='assistant'&&row.data?.content===window.__multiExpected),
                complete:right.textContent.includes('MULTI-PANE-END'),rightBottom:scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop,
                theme:document.documentElement.dataset.theme,zoom:getComputedStyle(document.body).zoom};
        });
    } finally {
        if(cdp){await cdp.send('Emulation.setCPUThrottlingRate',{rate:1}).catch(()=>{});await cdp.detach();}
        await context.close();
    }
}
