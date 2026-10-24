// Local production Theme studio: real keyboard changes, disposable preferences.
// bunx tsx audit-evidence/performance-20261022/theme-motion-probe.mjs '{}' /tmp/theme-motion.json
import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const options=JSON.parse(process.argv[2]??'{}'), output=process.argv[3];
if(!output)throw new Error('Supply an output path');
const browserName=options.browser??'chromium', theme=options.theme??'retro';
const preference=options.preference??'system';
if(!['chromium','webkit'].includes(browserName))throw new Error('Unsupported browser');
const browser=await (browserName==='webkit'?webkit:chromium).launch();
const timer=setTimeout(()=>browser.close().catch(()=>{}),90_000);
try {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:preference==='system'?'reduce':'no-preference'});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await context.addCookies([{name:'or3_active_theme',value:theme,domain:'127.0.0.1',path:'/'}]);
    await context.addInitScript(({theme,preference})=>{
        localStorage.setItem('activeTheme',theme);localStorage.setItem('theme','light');
        if(preference==='explicit')localStorage.setItem('or3:user-theme-accessibility',JSON.stringify({version:1,motion:'reduced',focusRingWidthPx:2}));
    },{theme,preference});
    const page=await context.newPage();page.setDefaultTimeout(20_000);
    await page.goto('http://127.0.0.1:3147/chat');
    await page.getByRole('textbox',{name:'Message input'}).waitFor();
    const dismiss=page.getByRole('button',{name:'Dismiss welcome'});if(await dismiss.isVisible())await dismiss.click();
    await page.getByRole('button',{name:'Dashboard',exact:true}).click();
    await page.getByRole('dialog',{name:'Dashboard',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:/Theme Settings/i}).click();
    await page.getByRole('tab',{name:'Typography',exact:true}).click();
    if(options.cssControl)await page.addStyleTag({content:options.cssControl});
    await page.waitForTimeout(1200);
    const cdp=browserName==='chromium'?await context.newCDPSession(page):undefined;
    await cdp?.send('Emulation.setCPUThrottlingRate',{rate:options.cpuRate??4});
    const phases=[];
    for(const [key,target] of [['End',24],['Home',14]]) {
        const events=[],onTrace=event=>events.push(...event.value);
        if(options.trace&&cdp){cdp.on('Tracing.dataCollected',onTrace);await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});}
        await page.evaluate(({frameAudit,target})=>{
            const start=performance.now(), transitions=[],samples=[],gaps=[],tasks=[];let previous,frame;
            const onTransition=event=>transitions.push({at:performance.now()-start,type:event.type,property:event.propertyName,target:event.target.className,tag:event.target.tagName});
            for(const name of ['transitionrun','transitionend','transitioncancel'])document.addEventListener(name,onTransition,true);
            const observer=PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration))):undefined;
            observer?.observe({type:'longtask'});
            const heading=document.querySelector('#theme-section-typography');
            const tick=t=>{
                if(previous!==undefined)gaps.push(t-previous);previous=t;
                if(frameAudit){
                    const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body),rect=heading.getBoundingClientRect();
                    samples.push({at:performance.now()-start,root:root.fontSize,token:root.getPropertyValue('--app-font-size-root').trim(),body:body.fontSize,headingWidth:rect.width,headingHeight:rect.height});
                }
                frame=requestAnimationFrame(tick);
            };
            frame=requestAnimationFrame(tick);
            window.__finishThemeMotion=()=>{
                cancelAnimationFrame(frame);observer?.disconnect();for(const name of ['transitionrun','transitionend','transitioncancel'])document.removeEventListener(name,onTransition,true);
                gaps.sort((a,b)=>a-b);
                return {target,elapsed:performance.now()-start,frames:gaps.length,p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1),tasks:observer?tasks:null,transitions,samples,
                    final:{root:getComputedStyle(document.documentElement).fontSize,body:getComputedStyle(document.body).fontSize,token:getComputedStyle(document.documentElement).getPropertyValue('--app-font-size-root').trim()}};
            };
        },{frameAudit:!!options.frameAudit,target});
        await page.getByRole('slider',{name:/Base font size/}).press(key);
        await page.waitForTimeout(1800);
        const result=await page.evaluate(()=>window.__finishThemeMotion());
        if(result.final.root!==`${target}px`||result.final.token!==`${target}px`)throw new Error('Typography control did not reach its target');
        if(options.trace&&cdp){const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await complete;cdp.off('Tracing.dataCollected',onTrace);}
        const totals=new Map();
        for(const event of events)if(event.dur&&['Layout','UpdateLayoutTree','Paint','PrePaint','FunctionCall','FireAnimationFrame'].includes(event.name)){
            const value=totals.get(event.name)??{count:0,ms:0};value.count++;value.ms+=event.dur/1000;totals.set(event.name,value);
        }
        phases.push({...result,totals:[...totals].map(([name,value])=>({name,...value}))});
    }
    await cdp?.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp?.detach();
    const appearance=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.motionResolved,mode:document.documentElement.classList.contains('dark')?'dark':'light'}));
    if(options.screenshot)await page.screenshot({path:options.screenshot});
    await page.getByRole('dialog',{name:'Theme Settings',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('textbox',{name:'Message input'}).waitFor();
    await writeFile(output,JSON.stringify({browser:browser.version(),browserName,options,cpuRateApplied:cdp?options.cpuRate??4:1,traceAvailable:!!(cdp&&options.trace),...appearance,phases},null,2)+'\n');
    console.log(JSON.stringify({output,...appearance,phases:phases.map(p=>({target:p.target,p95:p.p95,max:p.max,transitionRuns:p.transitions.filter(t=>t.type==='transitionrun').length,totals:p.totals}))}));
}finally{clearTimeout(timer);await browser.close();}
