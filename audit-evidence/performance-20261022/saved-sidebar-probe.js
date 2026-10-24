async function savedSidebarProbe(page) {
  const results=[];
  for (const theme of ['blank','retro']) for (const prefs of [{name:'default'}, {name:'wide',width:'480'}, {name:'collapsed',width:'400',collapsed:'true'}]) {
    const context=await page.context().browser().newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
    const p=await context.newPage();p.setDefaultTimeout(10000);
    let resume;const ready=new Promise(r=>{resume=r;});
    try {
      await context.route('**/*',async r=>{
        const url=new URL(r.request().url());
        if(url.hostname!=='127.0.0.1') return r.abort();
        if(/\/_nuxt\/.*\.js$/.test(url.pathname)) await ready;
        return r.continue();
      });
      await context.addCookies([{name:'or3_active_theme',value:theme,domain:'127.0.0.1',path:'/'}]);
      await p.addInitScript(({theme,prefs})=>{
        localStorage.setItem('activeTheme',theme);localStorage.setItem('theme','light');
        if(prefs.width) localStorage.setItem('sidebar:width',prefs.width);
        if(prefs.collapsed) localStorage.setItem('sidebar:width:collapsed',prefs.collapsed);
        window.__savedSidebarFrames=[];window.__savedSidebarShifts=[];
        new PerformanceObserver(list=>{for(const e of list.getEntries()) if(!e.hadRecentInput) window.__savedSidebarShifts.push(e.toJSON());}).observe({type:'layout-shift',buffered:true});
        const sample=()=>{
          const el=document.querySelector('#sidebar');
          if(el){const width=el.getBoundingClientRect().width;const a=window.__savedSidebarFrames;if(!a.length || a[a.length-1].width!==width) a.push({time:performance.now(),width,ready:!!window.__OR3_APP_INIT_FIRED__});}
          if(!window.__savedSidebarStop) requestAnimationFrame(sample);
        };requestAnimationFrame(sample);
      },{theme,prefs});
      await p.goto('http://127.0.0.1:3147/chat',{waitUntil:'commit'});await p.bringToFront();
      await p.locator('.chat-input-main').first().waitFor();await p.waitForTimeout(150);
      const geometry=()=>p.evaluate(()=>({sidebar:document.querySelector('#sidebar').getBoundingClientRect().toJSON(),main:document.querySelector('#main-content').getBoundingClientRect().toJSON(),zoom:getComputedStyle(document.body).zoom}));
      const initial=await geometry();resume();
      await p.waitForFunction(()=>window.__OR3_APP_INIT_FIRED__===true);await p.waitForTimeout(300);
      const after=await geometry();
      const diagnostics=await p.evaluate(()=>{window.__savedSidebarStop=true;return{frames:window.__savedSidebarFrames,shifts:window.__savedSidebarShifts};});
      results.push({theme,prefs,initial,after,...diagnostics});
    }finally{resume();await context.close();}
  }
  return {results};
}
