import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium, expect}=await import(process.cwd()+'/node_modules/@playwright/test/index.mjs');
const browser=await chromium.launch();
const runs=[];
try {
for(const mode of ['immediate','frame']) {
 const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/or3-scroll.js*',async route=>{
  const response=await route.fetch(); let body=await response.text();
  const replace=(before,after)=>{assert.equal(body.split(before).length,2,before);body=body.replace(before,after)};
  if(mode==='immediate') {
   const pattern=/followFrame \|\| \(followFrame = ke\(\(\) => \{[\s\S]*?\}\)\);/g;
   assert.equal([...body.matchAll(pattern)].length,1);
   body=body.replace(pattern,'!k && w === "followingBottom" && lt();');
  }
  replace('}, Me = () => {','}, epochAudit = (stage, extra = {}) => { const rows = globalThis.__epochEvents; if(rows && rows.length < 1500) rows.push({now:performance.now(),stage, mode:w, gesture:D, source:T, target:E, cached:C, top:_.value?.scrollTop, track:S.value, model:F.getTotalHeight(), epoch:M, ...extra}); }, Me = () => {');
  for(const [name,signature,extra] of [['height','H = (e) => {','{next:e}'],['write','U = (e, t, n = !1) => {','{next:e,writeSource:t}'],['measure','et = () => {','{}'],['reset','ct = () => {','{}'],['scroll','He = () => {','{}'],['settle','ze = () => {','{}'],['layout','Ie = (e, t) => {','{follow:t}']]) replace(signature,signature+` epochAudit('${name}',${extra});`);
  await route.fulfill({response,body});
 });
 await page.addInitScript(()=>{window.__epochEvents=[];});
 await page.goto('http://127.0.0.1:3116/__or3-scroll-test');
 await expect(page.getByTestId('ready')).toHaveText('ready',{timeout:30000});
 await page.evaluate(()=>window.__or3ScrollCanary.scrollToIndex(28));
 await page.evaluate(()=>{const a=window.__or3ScrollCanary;a.switchThread();a.switchThread();a.switchThread();});
 await expect.poll(()=>page.evaluate(()=>window.__or3ScrollCanary.getSnapshot().bottomDistance)).toBeLessThanOrEqual(5);
 const after=await page.evaluate(()=>window.__or3ScrollCanary.getSnapshot());
 const samples=await page.evaluate(async()=>{const rows=[];for(let i=0;i<70;i++){await new Promise(requestAnimationFrame);rows.push({now:performance.now(),...window.__or3ScrollCanary.getSnapshot()});}return rows;});
 const events=await page.evaluate(()=>window.__epochEvents);
 runs.push({mode,after,samples,events});
 console.log(JSON.stringify({mode,after:after.bottomDistance,first:samples.slice(0,10).map(s=>s.bottomDistance),last:samples.at(-1).bottomDistance,finalEvent:events.at(-1)}));
 await page.close();
}
await writeFile('/tmp/or3-epoch-follow-control.json',JSON.stringify({browser:browser.version(),runs},null,2));
}finally{await browser.close();}
