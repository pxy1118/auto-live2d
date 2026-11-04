/** Cross-restart comparison: genuine old GPU chain versus the new default. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=join(import.meta.dirname,'..'),out=join(root,'test-results/v4-default'),phase=process.env.DEFAULT_PHASE??'default';mkdirSync(out,{recursive:true});
assert.ok(['legacy','default'].includes(phase));
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1200,height:1000}});await page.addInitScript('window.__name=target=>target;');
const texts=['这里已经准备好了，我们先听一小段说明。','窗边那盆小花今天终于开了，颜色比昨天深了一点。','我把讨论的内容写到纸上，等会儿再一起看最后一项。','今天这段路走得很慢，不过沿途有不少新的发现。'];
const rows:any[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 const health:any=await(await fetch('http://127.0.0.1:8768/health')).json();assert.equal(health.streaming.promoted,phase==='default');
 for(let i=0;i<texts.length;i++){
  const result=await page.evaluate(async ({phase,text})=>{
   const e=(window as any).live2dDemo.engine;const cmd=async(method:string,params:any={})=>{const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d.result;};
   await cmd('speech.unlock');await cmd('engine.reset');const setup=performance.now();
   const context='日常直播交谈，自然配合身体动作。';let session:any;
   if(phase==='default')session=await cmd('performance.start',{context,motion_style:'restrained'});
   const begin=performance.now();let first:number|null=null,finished=false;let metrics:any[]=[];
   const observer=new Promise<void>(resolve=>{const tick=()=>{if(first===null&&e.speechState().phase==='playing')first=performance.now()-begin;if(finished)resolve();else requestAnimationFrame(tick);};tick();});
   if(phase==='legacy'){
    const response=await fetch('/api/speech/perform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,context,with_motion:true,kind:'regression',style:'natural'})});
    const body=await response.text();if(!response.ok||body.includes('"type":"error"'))throw Error(body);
    while(e.speechState().active)await new Promise(r=>setTimeout(r,25));
   }else{
    await cmd('performance.finish',{session_id:session.session_id,seq:0,text});
    let done=false;for(let n=0;n<2400;n++){const s=await cmd('performance.state');if(s.queue.error)throw Error(s.queue.error);if(s.queue.phase==='finished'){metrics=s.queue.metrics;done=true;break;}await new Promise(r=>setTimeout(r,25));}
    if(!done)throw Error('Session timeout');await cmd('performance.cancel',{session_id:session.session_id});
   }
   finished=true;await observer;return {first_audio_ms:first,setup_ms:begin-setup,metrics};
  },{phase,text:texts[i]});
  assert.notEqual(result.first_audio_ms,null);rows.push({index:i,warmup:i===0,text:texts[i],...result});console.log(JSON.stringify({phase,index:i,first_audio_ms:result.first_audio_ms}));
 }
 assert.deepEqual(errors,[]);writeFileSync(join(out,`latency-${phase}.json`),JSON.stringify({ok:true,phase,worker:health.streaming.execution??null,texts,rows,errors},null,2));
 if(phase==='default'){
  const previous=JSON.parse(readFileSync(join(out,'latency-legacy.json'),'utf8'));assert.deepEqual(previous.texts,texts);
  const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)];const measured=rows.slice(1),legacy=previous.rows.slice(1);
  const old=median(legacy.map((r:any)=>r.first_audio_ms)),current=median(measured.map(r=>r.first_audio_ms));
  const oldSetup=median(legacy.map((r:any)=>r.first_audio_ms+r.setup_ms)),currentSetup=median(measured.map(r=>r.first_audio_ms+r.setup_ms));
  const computes=measured.flatMap(r=>r.metrics.filter((m:any)=>m.compute_ms!==undefined).map((m:any)=>m.compute_ms)).sort((a,b)=>a-b);
  const p95=computes[Math.ceil(computes.length*.95)-1];const summary={baseline_first_audio_ms:old,default_first_audio_ms:current,increase_ms:current-old,
      baseline_including_setup_ms:oldSetup,default_including_setup_ms:currentSetup,increase_including_setup_ms:currentSetup-oldSetup,action_update_p95_ms:p95,action_updates:computes.length};
  const ok=summary.increase_ms<=200&&summary.increase_including_setup_ms<=200&&p95<200;
  writeFileSync(join(out,'latency-summary.json'),JSON.stringify({ok,summary,warmup_excluded:true,measured_pairs:3,baseline:'Separate --legacy launch, original 0.8B CUDA and same TTS weights',scope:'actual PCM playback with concurrent TTS'},null,2));
  console.log(JSON.stringify({ok,summary}));assert.ok(ok,'Latency targets failed; inspect measurements');
 }
}finally{await browser.close();}
