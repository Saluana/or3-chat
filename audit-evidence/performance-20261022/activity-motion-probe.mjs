// Disposable local production workspace; no provider traffic or user profile.
// bunx tsx audit-evidence/performance-20261022/activity-motion-probe.mjs '{}' /tmp/activity.json
import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const options=JSON.parse(process.argv[2]??'{}'),output=process.argv[3];
if(!output)throw new Error('Supply an output path');
const browserName=options.browser??'chromium';
if(!['chromium','webkit'].includes(browserName))throw new Error('Unsupported browser');
if(browserName==='webkit'&&options.cpuRate&&options.cpuRate!==1)throw new Error('CPU throttling is unavailable in this WebKit probe');
const browser=await (browserName==='webkit'?webkit:chromium).launch({headless:true});
const watchdog=setTimeout(()=>browser.close().catch(()=>{}),90_000);
try{
    const context=await browser.newContext({viewport:options.viewport??{width:1440,height:900},deviceScaleFactor:1,reducedMotion:options.reducedMotion?'reduce':'no-preference'});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const theme=options.theme??'blank';
    await context.addCookies([{name:'or3_active_theme',value:theme,domain:'127.0.0.1',path:'/'}]);
    await context.addInitScript(({theme,mode})=>{localStorage.setItem('activeTheme',theme);localStorage.setItem('theme',mode);},{theme,mode:options.mode??'light'});
    const page=await context.newPage();page.setDefaultTimeout(20_000);
    await page.goto('http://127.0.0.1:3147/__or3-chat-journey-test?workspace=1');
    await page.getByRole('textbox',{name:'Message input'}).waitFor();
    if(options.cssControl)await page.addStyleTag({content:options.cssControl});
    await page.evaluate(()=>{
        const original=window.fetch,encoder=new TextEncoder();let streamController;
        window.fetch=async(input,init)=>{
            const url=input instanceof Request?input.url:String(input);
            if(!url.includes('/api/__or3-e2e/chat/completions'))return original(input,init);
            if(streamController)throw new Error('Unexpected duplicate activity request');
            return new Response(new ReadableStream({start(controller){streamController=controller;}}),{headers:{'Content-Type':'text/event-stream'}});
        };
        window.__activityPush=()=>streamController.enqueue(encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content:'Measured partial reply.'},finish_reason:null}]})}\n\n`));
        window.__activityFinish=()=>{streamController.enqueue(encoder.encode('data: [DONE]\n\n'));streamController.close();window.fetch=original;};
    });
    await page.getByRole('textbox',{name:'Message input'}).fill('Measure waiting animations.');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.locator('.cm-assistant .loading-generating').waitFor();
    await page.getByRole('button',{name:'Stop generation',exact:true}).waitFor();
    const visual=[];
    if(options.compareScan){
        const root=page.locator('.cm-assistant .loading-generating');
        for(const progress of [0,.25,.5,.75,.999]){
            const images=[];
            for(const variant of ['baseline','transform']){
                const style=variant==='transform'?await page.addStyleTag({content:'.rl-scan { inset: -8px 0 0 !important; animation-name: activity-scan-control !important; } @keyframes activity-scan-control { from { transform: translateY(0); } to { transform: translateY(8px); } }'}):undefined;
                await page.evaluate(progress=>{for(const animation of document.getAnimations()){animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)*progress;}},progress);
                await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                const png=await root.screenshot({path:`${options.compareScan}-${progress}-${variant}.png`});images.push(png.toString('base64'));
                await style?.evaluate(element=>element.remove());
            }
            const difference=await page.evaluate(async images=>{
                const bitmaps=await Promise.all(images.map(async data=>createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}))));
                const [first,second]=bitmaps;
                if(first.width!==second.width||first.height!==second.height)throw new Error('Scan control changed loader dimensions');
                const canvas=new OffscreenCanvas(first.width,first.height),ctx=canvas.getContext('2d');
                const pixels=bitmaps.map(bitmap=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data;});
                let changed=0,maxDelta=0,totalDelta=0;
                for(let i=0;i<pixels[0].length;i+=4){let delta=0;for(let c=0;c<3;c++){const d=Math.abs(pixels[0][i+c]-pixels[1][i+c]);delta=Math.max(delta,d);totalDelta+=d;}if(delta>2)changed++;maxDelta=Math.max(maxDelta,delta);}
                return {width:canvas.width,height:canvas.height,changedFraction:changed/(canvas.width*canvas.height),maxDelta,meanChannelDelta:totalDelta/(canvas.width*canvas.height*3)};
            },images);
            visual.push({progress,...difference});
        }
        await page.evaluate(()=>{for(const animation of document.getAnimations()){animation.currentTime=0;animation.play();}});
    }
    const scanCoverage=await page.evaluate(()=>{
        const scan=document.querySelector('.cm-assistant .rl-scan'),root=scan.closest('.loading-generating');
        if(getComputedStyle(scan).display==='none')return {visible:false,samples:[]};
        const animation=scan.getAnimations()[0],originalTime=animation?.currentTime,samples=[];
        animation?.pause();
        for(const progress of animation?[0,.25,.5,.75,.999]:[0]){
            if(animation)animation.currentTime=Number(animation.effect.getTiming().duration)*progress;
            const parent=root.getBoundingClientRect(),child=scan.getBoundingClientRect();
            const uncovered=Math.max(child.top-parent.top,parent.bottom-child.bottom,child.left-parent.left,parent.right-child.right,0);
            samples.push({progress,uncovered,loaderHeight:parent.height,scanHeight:child.height});
            if(uncovered>1)throw new Error('Scan movement exposed an uncovered loader edge');
        }
        if(animation){animation.currentTime=originalTime;animation.play();}
        return {visible:true,samples};
    });
    const cdp=browserName==='chromium'?await context.newCDPSession(page):undefined;let layers=[];
    cdp?.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers??[];});
    await cdp?.send('LayerTree.enable');
    await cdp?.send('Emulation.setCPUThrottlingRate',{rate:options.cpuRate??4});
    const phases=[];
    for(const name of ['waiting','partial']){
        if(name==='partial'){
            await page.evaluate(()=>window.__activityPush());
            await page.getByText('Measured partial reply.',{exact:true}).waitFor();
            await page.locator('.cm-assistant .loading-generating').waitFor({state:'detached'});
        }
        await page.waitForTimeout(300);
        const animations=await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target instanceof Element).map(a=>({
            name:a.animationName??a.transitionProperty,target:a.effect.target.getAttribute('class'),
            duration:a.effect.getComputedTiming().duration,state:a.playState,frames:a.effect.getKeyframes(),
        })));
        const compositing=[];
        for(const layer of layers){
            if(!layer.backendNodeId||!layer.drawsContent)continue;
            const {node}=await cdp.send('DOM.describeNode',{backendNodeId:layer.backendNodeId});
            const attrs=Object.fromEntries(Array.from({length:(node.attributes?.length??0)/2},(_,i)=>node.attributes.slice(i*2,i*2+2)));
            const reasons=await cdp.send('LayerTree.compositingReasons',{layerId:layer.layerId});
            compositing.push({tag:node.nodeName,class:attrs.class,id:attrs.id,width:layer.width,height:layer.height,...reasons});
        }
        const events=[],onTrace=event=>events.push(...event.value);
        cdp?.on('Tracing.dataCollected',onTrace);
        await cdp?.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking',transferMode:'ReportEvents'});
        await page.evaluate(()=>{
            const state={gaps:[],tasks:PerformanceObserver.supportedEntryTypes.includes('longtask')?[]:null,mutations:0,frame:0};let previous;
            const tick=t=>{if(previous!==undefined)state.gaps.push(t-previous);previous=t;state.frame=requestAnimationFrame(tick);};
            state.frame=requestAnimationFrame(tick);
            const tasks=state.tasks?new PerformanceObserver(list=>state.tasks.push(...list.getEntries().map(e=>e.duration))):undefined;tasks?.observe({type:'longtask'});
            const dom=new MutationObserver(records=>{state.mutations+=records.length;});dom.observe(document.querySelector('.pane-container'),{subtree:true,attributes:true,childList:true,characterData:true});
            window.__finishActivity=()=>{cancelAnimationFrame(state.frame);tasks?.disconnect();dom.disconnect();state.gaps.sort((a,b)=>a-b);return {frames:state.gaps.length,p95:state.gaps[Math.floor(state.gaps.length*.95)],max:state.gaps.at(-1),tasks:state.tasks,mutations:state.mutations};};
        });
        await page.waitForTimeout(options.durationMs??2000);
        const timing=await page.evaluate(()=>window.__finishActivity());
        if(cdp){
            const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
            await cdp.send('Tracing.end');await complete;cdp.off('Tracing.dataCollected',onTrace);
        }
        const totals=new Map(),invalidations=new Map();
        for(const event of events){
            if(event.dur&&['UpdateLayoutTree','Layout','Paint','PrePaint','Layerize','FireAnimationFrame','FunctionCall'].includes(event.name)){
                const group=totals.get(event.name)??{count:0,ms:0};group.count++;group.ms+=event.dur/1000;totals.set(event.name,group);
            }
            if(event.name==='StyleRecalcInvalidationTracking'&&event.args?.data?.reason==='Animation'){
                const node=event.args.data.nodeName;invalidations.set(node,(invalidations.get(node)??0)+1);
            }
        }
        if(options.screenshots)await page.screenshot({path:`${options.screenshots}-${name}.png`});
        phases.push({name,...timing,animations,compositing,totals:[...totals].map(([name,value])=>({name,...value})),animationInvalidations:[...invalidations].map(([node,count])=>({node,count}))});
    }
    await cdp?.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp?.detach();
    await page.evaluate(()=>window.__activityFinish());
    await page.getByRole('button',{name:'Send message',exact:true}).waitFor();
    const appearance=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,mode:document.documentElement.classList.contains('dark')?'dark':'light',motion:document.documentElement.dataset.motionResolved,zoom:getComputedStyle(document.body).zoom}));
    const result={browser:browser.version(),browserName,cpuRateApplied:cdp?options.cpuRate??4:1,traceAvailable:Boolean(cdp),fontWaitBypassed:process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY==='1',options,...appearance,scanCoverage,visual,phases,finalText:await page.getByText('Measured partial reply.',{exact:true}).textContent()};
    await writeFile(output,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({output,phases:phases.map(({name,p95,max,mutations,totals})=>({name,p95,max,mutations,totals}))}));
}finally{clearTimeout(watchdog);await browser.close();}
