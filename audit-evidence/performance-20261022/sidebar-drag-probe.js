// Disposable local production UI. Measures native pointer tracking without CSS overrides.
async function sidebarDragProbe(page, options = {}) {
    const results = [];
    for (const scale of options.scales ?? [80, 90, 100, 120]) {
        const context = await page.context().browser().newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,reducedMotion:options.motion ?? 'no-preference'});
        const p=await context.newPage(); p.setDefaultTimeout(10000);
        try {
            await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
            await context.addCookies([{name:'or3_active_theme',value:'blank',domain:'127.0.0.1',path:'/'}]);
            await p.addInitScript(scale=>{
                localStorage.setItem('activeTheme','blank');localStorage.setItem('theme','light');
                localStorage.setItem('or3:user-theme-overrides:light',JSON.stringify({typography:{uiScale:scale}}));
            },scale);
            await p.goto('http://127.0.0.1:3147/chat?welcome=1');await p.bringToFront();
            await p.waitForFunction(()=>window.__OR3_APP_INIT_FIRED__===true);
            const dismiss=p.getByRole('button',{name:'Dismiss welcome',exact:true});await dismiss.waitFor();await dismiss.click();
            const handle=p.getByRole('separator',{name:'Resize sidebar',exact:true});
            await handle.waitFor();await p.waitForTimeout(300);
            const read=()=>p.locator('#sidebar').evaluate(el=>({width:el.getBoundingClientRect().width,cssWidth:parseFloat(getComputedStyle(el).width),transition:getComputedStyle(el).transitionProperty,duration:getComputedStyle(el).transitionDuration,zoom:getComputedStyle(document.body).zoom,stored:localStorage.getItem('sidebar:width')}));
            const before=await read();const box=await handle.boundingBox();const startX=box.x+box.width/2,y=box.y+box.height/2;
            await p.mouse.move(startX,y);await p.mouse.down();
            const samples=[];
            for(let step=1;step<=8;step++){
                await p.mouse.move(startX+step*12,y);
                await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                const state=await read();samples.push({pointerDelta:step*12,actualDelta:state.width-before.width,error:state.width-before.width-step*12,...state});
            }
            let releaseImmediateError;
            if (options.releaseBeforeFrame) {
                await p.evaluate(({x,y})=>{
                    window.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,buttons:1}));
                    window.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:y}));
                },{x:startX+108,y});
                await p.mouse.up();
                await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                releaseImmediateError=(await read()).width-before.width-108;
            } else await p.mouse.up();
            await p.waitForTimeout(300);
            const after=await read();
            results.push({scale,motion:options.motion??'no-preference',releaseBeforeFrame:options.releaseBeforeFrame??false,releaseImmediateError,before,samples,after,settledError:after.width-before.width-(options.releaseBeforeFrame?108:96)});
        } finally {await context.close();}
    }
    return {results};
}
