// Real workspace panes and controller; disposable synthetic history/transport.
async function concurrentPaneStreamProbe(page, options = {}) {
    const context=await page.context().browser().newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
    const p=await context.newPage();p.setDefaultTimeout(20000);
    let cdp;
    let highlightControlApplied=0;
    let projectionControlApplied=0;
    let bundleControlApplied=0;
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
        if(options.uncachedProjectionControl)await p.route(`**/_nuxt/${options.uncachedProjectionControl.bundle}`,async route=>{
            const response=await route.fetch(),body=await response.text();
            const {needle,replacement}=options.uncachedProjectionControl;
            if(body.split(needle).length!==2)throw new Error('Unmatched projection control');
            projectionControlApplied++;
            await route.fulfill({response,body:body.replace(needle,replacement)});
        });
        const bundleControl=options.bundleControl??options.measurementFollowControl;
        if(bundleControl)await p.route(`**/_nuxt/${bundleControl.bundle}`,async route=>{
            const response=await route.fetch(),body=await response.text();
            const {needle,replacement}=bundleControl;
            if(body.split(needle).length!==2)throw new Error('Unmatched bundle control');
            bundleControlApplied++;
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
        if(options.cssControl){
            await p.addStyleTag({content:options.cssControl});
            await p.waitForTimeout(100);
        }
        if(options.mathStyleControl){
            await p.addStyleTag({url:'http://127.0.0.1:3147/_nuxt/'+options.mathStyleControl});
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
        const responses=Object.fromEntries(['left','right'].map(side=>[side,(options.mathFirst?'$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n\n':'')+(options.rich?rich:prose)+`CONCURRENT-${side.toUpperCase()}-END`]));
        await p.evaluate(({responses,dbCounts,synchronized,observeRich,shellAudit,tailAudit,scrollControlAudit,domWorkAudit,geometryAudit,mathPaintAudit,phaseAudit})=>{
            const roots=[...document.querySelectorAll('.pane-container > [role="tabpanel"]')];
            const scroll=roots[0].querySelector('.chat-message-list');
            const states={left:{produced:0},right:{produced:0}};
            // Rich cold rendering can outlast a short second-send interaction.
            // Optional gating starts both synthetic transports after admission.
            let releaseStreams;
            const startGate=synchronized?new Promise(resolve=>{releaseStreams=resolve;}):Promise.resolve();
            window.__concurrentStates=states;window.__concurrentExpected=responses;
            const observeShell=()=>{
                const initial=new Set(),instances=[],cleanups=[],dom={},editors=[];
                const phase=()=>Object.values(states).every(s=>s.done)?'afterTransport':'streaming';
                const paneFor=el=>{const root=el?.nodeType===1?el.closest('.pane-container > [role="tabpanel"]'):el?.parentElement?.closest('.pane-container > [role="tabpanel"]');return roots.indexOf(root);};
                const visit=vnode=>{
                    if(!vnode||typeof vnode!=='object'||initial.has(vnode))return;
                    initial.add(vnode);
                    if(vnode.component){
                        const vm=vnode.component,name=vm.type.name||vm.type.__name||'(anonymous)';
                        // Raw shallow prop reads avoid subscribing the component
                        // render effect to diagnostic-only accesses in this hook.
                        const raw=vm.props?.__v_raw??vm.props??{};
                        let previous={...raw},previousVNode={...vm.vnode.props};
                        const messageSnapshot=()=>({...((raw.message?.__v_raw??raw.message)??{})});
                        let previousMessage=tailAudit&&name==='ChatMessage'?messageSnapshot():undefined;
                        const row={uid:vm.uid,name,pane:paneFor(vm.vnode.el),inner:name==='AsyncComponentWrapper'?vm.subTree?.type?.name||vm.subTree?.type?.__name:undefined,
                            messageId:vm.vnode.props?.message?.id,streaming:0,afterTransport:0,noChangedProps:0,props:{},vnodeProps:{}};
                        if(previousMessage)row.messageAudit={sameFields:{streaming:0,afterTransport:0},fields:{},samples:[]};
                        instances.push(row);
                        const update=()=>{
                            row[phase()]++;
                            if(row.messageAudit){
                                const next=messageSnapshot();
                                const keys=[...new Set([...Object.keys(previousMessage),...Object.keys(next)])]
                                    .filter(key=>!Object.is(previousMessage[key],next[key])||Object.hasOwn(previousMessage,key)!==Object.hasOwn(next,key));
                                if(!keys.length)row.messageAudit.sameFields[phase()]++;
                                for(const key of keys)row.messageAudit.fields[key]=(row.messageAudit.fields[key]??0)+1;
                                if(row.messageAudit.samples.length<12)row.messageAudit.samples.push({phase:phase(),keys,
                                    beforeTextLength:previousMessage.text?.length,afterTextLength:next.text?.length,
                                    beforeReasoningLength:previousMessage.reasoning_text?.length??0,afterReasoningLength:next.reasoning_text?.length??0});
                                previousMessage=next;
                            }
                            let changed=false;
                            for(const key of new Set([...Object.keys(previous),...Object.keys(raw)]))if(!Object.is(previous[key],raw[key])){row.props[key]=(row.props[key]??0)+1;changed=true;}
                            if(!changed)row.noChangedProps++;
                            previous={...raw};
                            if(name==='AsyncComponentWrapper'){
                                const next=vm.vnode.props??{};
                                for(const key of new Set([...Object.keys(previousVNode),...Object.keys(next)]))if(!Object.is(previousVNode[key],next[key]))row.vnodeProps[key]=(row.vnodeProps[key]??0)+1;
                                previousVNode={...next};
                            }
                        };
                        (vm.bu??=[]).push(update);
                        cleanups.push(()=>{const i=vm.bu?.indexOf(update);if(i>=0)vm.bu.splice(i,1);});
                        if(name==='EditorContent'&&raw.editor?.on){
                            const editor=raw.editor,entry={pane:row.pane,transactions:0,docChanges:0,selectionChanges:0};editors.push(entry);
                            const onTransaction=({transaction})=>{entry.transactions++;if(transaction.docChanged)entry.docChanges++;if(transaction.selectionSet)entry.selectionChanges++;};
                            editor.on('transaction',onTransaction);cleanups.push(()=>editor.off('transaction',onTransaction));
                        }
                        visit(vm.subTree);
                    }
                    if(vnode.suspense)visit(vnode.suspense.activeBranch);
                    if(Array.isArray(vnode.children))vnode.children.forEach(visit);
                };
                visit(document.querySelector('#__nuxt')?._vnode);
                if(!instances.some(row=>row.name==='ChatInputDropper'))throw new Error('Missing production composer instances');
                const regions={sidebar:document.querySelector('#nav-scroll-area'),tabs:document.querySelector('.workspace-tab-bar-shell'),
                    leftComposer:roots[0].querySelector('.chat-input-wrapper'),rightComposer:roots[1].querySelector('.chat-input-wrapper')};
                for(const [name,element]of Object.entries(regions)){
                    if(!element)throw new Error('Missing shell region '+name);
                    const entry=dom[name]={streaming:0,afterTransport:0,examples:[]};
                    const observer=new MutationObserver(records=>{entry[phase()]+=records.length;for(const record of records)if(entry.examples.length<8)entry.examples.push({phase:phase(),type:record.type,attribute:record.attributeName,target:record.target.nodeName,id:record.target.id,class:typeof record.target.className==='string'?record.target.className.slice(0,160):undefined});});
                    observer.observe(element,{subtree:true,childList:true,characterData:true,attributes:true});cleanups.push(()=>observer.disconnect());
                }
                return ()=>{
                    cleanups.forEach(fn=>fn());
                    const grouped={};for(const row of instances){const group=grouped[row.name]??={instances:0,streaming:0,afterTransport:0,noChangedProps:0,props:{},vnodeProps:{}};group.instances++;group.streaming+=row.streaming;group.afterTransport+=row.afterTransport;group.noChangedProps+=row.noChangedProps;for(const field of ['props','vnodeProps'])for(const [key,n]of Object.entries(row[field]))group[field][key]=(group[field][key]??0)+n;}
                    return {initialInstances:instances.length,grouped,instances:instances.filter(row=>row.streaming||row.afterTransport).sort((a,b)=>b.streaming-a.streaming).slice(0,60),dom,editors,
                        ...(tailAudit?{messageAudit:instances.filter(row=>row.messageAudit).map(row=>({id:row.messageId,pane:row.pane,streaming:row.streaming,afterTransport:row.afterTransport,...row.messageAudit}))}:{} )};
                };
            };
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
                    if(phaseAudit)performance.mark(`or3-audit-${side}-first`);
                    for(let offset=0;offset<responseText.length;offset+=64){
                        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content:responseText.slice(offset,offset+64)},finish_reason:null}]})}\n\n`));
                        states[side].produced=Math.min(offset+64,responseText.length);await new Promise(resolve=>setTimeout(resolve,16));
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();states[side].end=performance.now();states[side].done=true;
                    if(phaseAudit)performance.mark(`or3-audit-${side}-done`);
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
                const frameSamples=[],taskSamples=[];
                const restoreGeometry=[];
                if(geometryAudit){
                    const groups=new Map();
                    metrics.geometry={groups:[],slow:[]};
                    const record=(element,name,start)=>{
                        const duration=performance.now()-start;
                        const phase=Object.values(states).every(state=>state.done)?'afterTransport':'streaming';
                        const identity={phase,name,tag:element.tagName,class:element.getAttribute('class')};
                        const key=JSON.stringify(identity);
                        let group=groups.get(key);
                        if(!group){group={...identity,count:0,ms:0,maxMs:0};groups.set(key,group);metrics.geometry.groups.push(group);}
                        group.count++;group.ms+=duration;group.maxMs=Math.max(group.maxMs,duration);
                        if(duration>=1&&metrics.geometry.slow.length<100)metrics.geometry.slow.push({...identity,duration,stack:new Error().stack});
                    };
                    for(const [prototype,names]of [
                        [Element.prototype,['clientHeight','clientWidth','scrollHeight','scrollWidth','scrollTop','scrollLeft','getBoundingClientRect','getClientRects']],
                        [HTMLElement.prototype,['offsetHeight','offsetWidth','offsetTop','offsetLeft']],
                    ])for(const name of names){
                        const descriptor=Object.getOwnPropertyDescriptor(prototype,name);
                        if(!descriptor?.configurable)throw new Error('Missing native geometry descriptor '+name);
                        if(descriptor.get){
                            Object.defineProperty(prototype,name,{...descriptor,
                                get(){const start=performance.now();const value=descriptor.get.call(this);record(this,name,start);return value;},
                                ...(descriptor.set?{set(value){const start=performance.now();descriptor.set.call(this,value);record(this,name+':set',start);}}:{}),
                            });
                        }else if(typeof descriptor.value==='function'){
                            Object.defineProperty(prototype,name,{...descriptor,value(...args){const start=performance.now();const value=descriptor.value.apply(this,args);record(this,name,start);return value;}});
                        }else throw new Error('Unsupported geometry descriptor '+name);
                        restoreGeometry.push(()=>Object.defineProperty(prototype,name,descriptor));
                    }
                }
                let restoreHtml;
                if(domWorkAudit){
                    const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
                    if(!descriptor?.set||!descriptor.get)throw new Error('Missing native innerHTML accessor');
                    const previousHtml=new WeakMap(),groups=new Map();
                    metrics.htmlWrites=[];
                    Object.defineProperty(Element.prototype,'innerHTML',{...descriptor,set(value){
                        const phase=Object.values(states).every(state=>state.done)?'afterTransport':'streaming';
                        const key=JSON.stringify({phase,tag:this.tagName,class:this.getAttribute('class'),streamdown:this.getAttribute('data-streamdown'),connected:this.isConnected});
                        let group=groups.get(key);
                        if(!group){group={...JSON.parse(key),count:0,sameInput:0,maxLength:0};groups.set(key,group);metrics.htmlWrites.push(group);}
                        const source=String(value);group.count++;group.maxLength=Math.max(group.maxLength,source.length);
                        if(previousHtml.get(this)===source)group.sameInput++;
                        previousHtml.set(this,source);
                        return descriptor.set.call(this,value);
                    }});
                    restoreHtml=()=>Object.defineProperty(Element.prototype,'innerHTML',descriptor);
                }
                const finishShell=shellAudit?observeShell():undefined;
                const scrollControls=scrollControlAudit?roots.map(root=>root.querySelector('.chat-scroll-to-bottom')?.parentElement):[];
                if(scrollControls.some(el=>!el))throw new Error('Missing scroll control');
                const scrollApis=[];
                if(scrollControlAudit){
                    const targets=roots.map(root=>root.querySelector('.chat-message-list')),seen=new Set();
                    const visit=vnode=>{if(!vnode||typeof vnode!=='object'||seen.has(vnode))return;seen.add(vnode);
                        if(vnode.component){const vm=vnode.component,index=targets.indexOf(vm.vnode.el);if(index>=0&&vm.exposed?.isAtBottom)scrollApis[index]=vm.exposed.isAtBottom;visit(vm.subTree);}
                        if(vnode.suspense)visit(vnode.suspense.activeBranch);if(Array.isArray(vnode.children))vnode.children.forEach(visit);};
                    visit(document.querySelector('#__nuxt')?._vnode);
                    if(targets.some((_,index)=>!scrollApis[index]))throw new Error('Missing scroll API');
                }
                const scrollObservers=scrollControls.map((element)=>{
                    const record={frames:0,visibleFrames:0,maxOpacity:0,styles:[],visibleSamples:[]};
                    (metrics.scrollControls??=[]).push(record);
                    const observer=new MutationObserver(records=>{for(const mutation of records)if(record.styles.length<100)record.styles.push({time:performance.now(),before:mutation.oldValue,after:element.getAttribute('style')});});
                    observer.observe(element,{attributes:true,attributeFilter:['style'],attributeOldValue:true});
                    return observer;
                });
                const richNodes=[];let richObserver;
                if(mathPaintAudit)metrics.mathPaints=[];
                let frame,previous;
                const tick=t=>{if(previous!==undefined){metrics.gaps.push(t-previous);if(phaseAudit)frameSamples.push({start:previous,end:t,duration:t-previous});}previous=t;
                    if(mathPaintAudit&&metrics.mathPaints.length<20){
                        const math=roots[1].querySelector('.katex'),semantic=math?.querySelector('.katex-mathml');
                        if(semantic){const style=getComputedStyle(semantic);metrics.mathPaints.push({time:t,styled:style.position==='absolute',position:style.position,height:math.getBoundingClientRect().height});}
                    }
                    scrollControls.forEach((element,index)=>{
                        const style=getComputedStyle(element),record=metrics.scrollControls[index];
                        const opacity=style.display==='none'?0:Number(style.opacity);
                        record.frames++;record.maxOpacity=Math.max(record.maxOpacity,opacity);
                        if(opacity>0.001){record.visibleFrames++;if(record.visibleSamples.length<12)record.visibleSamples.push({time:t,opacity,inline:element.getAttribute('style'),atBottom:scrollApis[index].value});}
                    });
                    if(observeRich&&!richObserver&&states.right.produced>=512){
                        const rich=roots[1].querySelector('h3')?.closest('.streamdown-vue');
                        if(rich){richNodes.push(...['h3','pre','.katex'].map(selector=>rich.querySelector(selector)).filter(Boolean));metrics.richMutations={count:0,examples:[]};richObserver=new MutationObserver(records=>{metrics.richMutations.count+=records.length;for(const record of records){if(metrics.richMutations.examples.length<10)metrics.richMutations.examples.push({type:record.type,attribute:record.attributeName,target:record.target.nodeName,afterTransportDone:Boolean(states.right.done)});}});for(const el of richNodes)richObserver.observe(el,{subtree:true,attributes:true,childList:true,characterData:true});}
                    }
                    frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
                const tasks=new PerformanceObserver(list=>{const entries=list.getEntries();metrics.longTasks.push(...entries.map(e=>e.duration));if(phaseAudit)taskSamples.push(...entries.map(e=>({start:e.startTime,end:e.startTime+e.duration,duration:e.duration})));});tasks.observe({type:'longtask'});
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
                    restoreHtml?.();
                    restoreGeometry.forEach(restore=>restore());
                    scrollObservers.forEach(observer=>observer.disconnect());
                    richObserver?.disconnect();if(richObserver)metrics.richNodesRetained=richNodes.map(el=>({tag:el.tagName,connected:el.isConnected}));
                    if(finishShell)metrics.shell=finishShell();
                    for(const [method,original] of Object.entries(originals))IDBIndex.prototype[method]=original;
                    metrics.after=anchorState();metrics.elapsed=performance.now()-metrics.start;metrics.gaps.sort((a,b)=>a-b);
                    if(phaseAudit){
                        const end=Math.max(...Object.values(states).map(state=>state.end));
                        const phase=sample=>sample.end<=end?'streaming':sample.start>=end?'afterTransport':'boundary';
                        metrics.phases=Object.fromEntries(['streaming','boundary','afterTransport'].map(name=>{
                            const frames=frameSamples.filter(sample=>phase(sample)===name).map(sample=>sample.duration).sort((a,b)=>a-b);
                            return [name,{frames:frames.length,p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1),longTasks:taskSamples.filter(sample=>phase(sample)===name)}];
                        }));
                    }
                    return {...metrics,p95:metrics.gaps[Math.floor(metrics.gaps.length*.95)],max:metrics.gaps.at(-1),frames:metrics.gaps.length,gaps:undefined,states,
                        overlapMs:Math.min(...Object.values(states).map(state=>state.end))-Math.max(...Object.values(states).map(state=>state.firstChunk))};
                };
                releaseStreams?.();
            };
        },{responses,dbCounts:options.dbCounts??true,synchronized:options.synchronized??false,observeRich:options.rich??false,shellAudit:options.shellAudit||options.tailAudit||false,tailAudit:options.tailAudit??false,scrollControlAudit:options.scrollControlAudit??false,domWorkAudit:options.domWorkAudit??false,geometryAudit:options.geometryAudit??false,mathPaintAudit:options.mathPaintAudit??false,phaseAudit:options.phaseAudit??false});
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
            let categories='devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.invalidationTracking';
            if(options.traceStacks){
                const available=await cdp.send('Tracing.getCategories');
                if(!available.categories.includes('disabled-by-default-devtools.timeline.stack'))throw new Error('Missing trace stack category');
                categories+=',disabled-by-default-devtools.timeline.stack';
            }
            await cdp.send('Tracing.start',{categories,transferMode:'ReportEvents'});
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
            if(options.layoutAudit){
                result.trace.layoutContexts=traceEvents.filter(event=>event.name==='Layout').sort((a,b)=>(b.dur??0)-(a.dur??0)).slice(0,20).map(event=>({
                    ...event,ancestors:traceEvents.filter(parent=>parent!==event&&parent.pid===event.pid&&parent.tid===event.tid&&parent.dur&&parent.ts<=event.ts&&parent.ts+parent.dur>=event.ts+event.dur)
                        .sort((a,b)=>a.dur-b.dur).slice(0,5).map(({name,dur,args})=>({name,dur,args})),
                }));
                const fonts=new Map();
                for(const event of traceEvents.filter(event=>event.name==='LayoutInvalidationTracking'&&event.args?.data?.reason==='Fonts changed')){
                    const data=event.args.data,key=data.nodeId;
                    let value=fonts.get(key);
                    if(!value){value={nodeId:key,nodeName:data.nodeName,count:0,first:event.ts,last:event.ts};fonts.set(key,value);}
                    value.count++;value.last=event.ts;
                }
                result.trace.fontInvalidations=[...fonts.values()].sort((a,b)=>b.count-a.count).slice(0,20);
                result.trace.requests=traceEvents.filter(event=>event.name==='ResourceSendRequest').map(event=>({ts:event.ts,...event.args?.data}));
            }
            if(options.phaseAudit){
                const marks=traceEvents.filter(event=>event.name.startsWith('or3-audit-'));
                const first=marks.filter(event=>event.name.endsWith('-first')),done=marks.filter(event=>event.name.endsWith('-done'));
                if(first.length!==2||done.length!==2)throw new Error('Missing trace phase marks');
                const start=Math.min(...first.map(event=>event.ts)),end=Math.max(...done.map(event=>event.ts));
                const phase=event=>event.ts+event.dur<=end?'streaming':event.ts>=end?'afterTransport':'boundary';
                result.trace.phases=Object.fromEntries(['streaming','boundary','afterTransport'].map(name=>{
                    const groups=new Map();
                    for(const event of traceEvents){
                        if(event.ts<start||!event.dur||phase(event)!==name)continue;
                        const group=groups.get(event.name)??{count:0,ms:0,maxMs:0};
                        group.count++;group.ms+=event.dur/1000;group.maxMs=Math.max(group.maxMs,event.dur/1000);groups.set(event.name,group);
                    }
                    return [name,[...groups].map(([name,value])=>({name,...value})).sort((a,b)=>b.ms-a.ms)];
                }));
            }
        }
        await panes.first().locator('.chat-scroll-to-bottom').click();
        await panes.first().getByText('CONCURRENT-LEFT-END',{exact:false}).waitFor();
        result.leftRevealed=true;
        result.highlightControlApplied=highlightControlApplied;
        result.projectionControlApplied=projectionControlApplied;
        result.bundleControlApplied=bundleControlApplied;
        result.highlightingWorkers=p.workers().filter(worker=>worker.url().includes('markdown-highlight.worker')).length;
        if(options.screenshot)await p.screenshot({path:options.screenshot,animations:'disabled'});
        return result;
    } finally {
        if(cdp){await cdp.send('Emulation.setCPUThrottlingRate',{rate:1}).catch(()=>{});await cdp.detach();}
        await context.close();
    }
}

