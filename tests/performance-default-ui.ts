/** Run after the long-session test: default UI, real long context and appearance. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'..'),base='http://127.0.0.1:8765',out=join(root,'test-results/v4-default');mkdirSync(out,{recursive:true});
const ratings=join(root,'.runtime/performance/ratings.json'),digest=()=>createHash('sha256').update(readFileSync(ratings)).digest('hex');const before=digest();
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1280,height:1000}});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const report:any={ok:false,checks:[]};
async function cmd(method:string,params:any={}){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d.result;}
try{
 await page.goto(base+'/?speech=1#performance-panel');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.waitForFunction(()=>document.getElementById('performance-status')!.textContent!.includes('默认方案'));
 assert.match(await page.locator('#performance-message').innerText(),/已设为默认/);
 assert.equal(await page.locator('#performance-kind').inputValue(),'regression');assert.equal(await page.locator('#performance-backend').inputValue(),'groups');
 assert.equal(await page.locator('#performance-kind option[value="flow"]').evaluate(el=>(el as HTMLOptionElement).disabled),true);
 const status=await cmd('performance.status');assert.equal(status.promoted,true);assert.equal(status.experimental,false);assert.equal(status.execution.body_encoder_shared,true);
 const cap=await cmd('capabilities.get');assert.equal(cap.promoted,true);assert.equal(cap.experimental,false);assert.equal(cap.active_performance.body_planner,'task_context_first');
 report.checks.push('ordinary startup selects promoted 4B/native-groups/context-body profile; default UI and capabilities agree');
 await cmd('speech.unlock');await cmd('appearance.update',{glasses:'black',shoes:false,skirt:'long'});
 const context='事实：角色正在平静校对一份文字稿，按原文朗读，不扮演其中人物。\n'+'此前讨论过资料的整理方法和旧文件的存放位置。'.repeat(26)+'\n观众：现在读出下一行文字。';assert.ok(context.length<=800);
 const start=await cmd('performance.start',{context});assert.equal(start.promoted,true);
 await cmd('performance.finish',{session_id:start.session_id,seq:0,text:'这一行还没有填写日期。'});
 let final:any;const begun=Date.now();
 while(Date.now()-begun<45000){const s=await cmd('state.get'),p=await cmd('performance.state');assert.ok(Object.values(s.values).every(Number.isFinite));assert.equal(s.values.key11,1);assert.equal(s.values.Clothes4,1);assert.equal(s.values.Clothes1,0);if(p.queue.error)throw Error(p.queue.error);if(p.queue.phase==='finished'){final=p;break;}await new Promise(r=>setTimeout(r,70));}
 assert.ok(final,'real long-context clause did not complete');const prefill=final.queue.metrics.find((m:any)=>m.planner_timing);
 assert.equal(prefill.context_truncated,true);assert.ok(prefill.planner_timing.body.tokens<=512);assert.equal(final.plan_history.length,1);
 await cmd('performance.cancel',{session_id:start.session_id});assert.equal((await cmd('state.get')).values.key11,1);
 report.checks.push('long context keeps complete spoken clause and reports body token compression; real TTS succeeds; explicit wardrobe survives speech and cancellation');
 report.prefill=prefill;report.plan=final.plan_history[0];report.execution=status.execution;
 await page.screenshot({path:join(out,'default-ui-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'default-ui-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.equal(digest(),before);
 report.checks.push('desktop/mobile UI; original human ratings unchanged');report.ok=true;
}finally{writeFileSync(join(out,'default-ui.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
