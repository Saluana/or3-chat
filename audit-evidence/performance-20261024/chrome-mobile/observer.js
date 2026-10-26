// Exact instrumentation used for this manual Chrome audit.
// Node-count timing becomes unreliable when long-history virtualization removes rows.
(() => {
 const a=window.__or3ChromeAudit={paints:[],lcp:[],shifts:[],longTasks:[],events:[],readyMs:null,calls:[]};
 const observe=(type,key,project,options={})=>{try {new PerformanceObserver(list=>{for(const e of list.getEntries()) if(a[key].length<1500) {const v=project(e);if(v)a[key].push(v);}}).observe({type,buffered:true,...options});}catch{}};
 observe('paint','paints',e=>({name:e.name,startMs:e.startTime}));
 observe('largest-contentful-paint','lcp',e=>({startMs:e.startTime,size:e.size,tag:e.element?.tagName,path:e.url?new URL(e.url,location.href).pathname:null}));
 observe('layout-shift','shifts',e=>!e.hadRecentInput?{startMs:e.startTime,value:e.value}:null);
 observe('longtask','longTasks',e=>({startMs:e.startTime,durationMs:e.duration}));
 observe('event','events',e=>({name:e.name,startMs:e.startTime,durationMs:e.duration,processingStartMs:e.processingStart,processingEndMs:e.processingEnd,interactionId:e.interactionId}),{durationThreshold:16});
 const ready=()=>{if(window.__OR3_APP_INIT_FIRED__&&document.querySelector('[aria-label="Message input"][contenteditable="true"]'))a.readyMs=performance.now();else requestAnimationFrame(ready);}; requestAnimationFrame(ready);
 document.addEventListener('click',e=>{const b=e.target.closest?.('button');if(b?.getAttribute('aria-label')==='Send message'){const nodes=document.querySelectorAll('.cm-markdown-assistant');a.calls.push({sendMs:performance.now(),assistantCountBefore:nodes.length,firstTextMs:null,lastTextMs:null,textLength:0,updates:0,completeMs:null});}},true);
 let pending=false;const scan=()=>{pending=false;const c=a.calls.at(-1);if(!c||c.completeMs)return;const nodes=document.querySelectorAll('.cm-markdown-assistant');if(nodes.length>c.assistantCountBefore){const length=nodes[nodes.length-1].textContent.length;if(length&&length!==c.textLength){c.firstTextMs??=performance.now();c.lastTextMs=performance.now();c.textLength=length;c.updates++;}}if(c.firstTextMs&&!document.querySelector('[aria-label="Stop generation"]')&&document.querySelector('[aria-label="Send message"]'))c.completeMs=performance.now();};
 new MutationObserver(()=>{if(a.calls.length&&!pending){pending=true;requestAnimationFrame(scan);}}).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','disabled']});
})();
