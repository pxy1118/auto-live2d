import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8765',out=join(root,'test-results/v4');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1100,height:900}});await page.addInitScript('window.__name = target => target;');
const kind=process.env.KIND??'regression',results:any[]=[],suffix=process.env.REPORT_SUFFIX?'-'+process.env.REPORT_SUFFIX:'';
try{
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.evaluate(()=> (window as any).live2dDemo.engine.command({method:'speech.unlock'}));
 for(let pair=0;pair<4;pair++)for(const mode of ['v3','v4']){
  const result=await page.evaluate(async ({mode,kind,pair,novel})=>{
   const engine=(window as any).live2dDemo.engine;
   const cmd=async(method:string,params:any={})=>{const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});const d=await r.json();if(!r.ok)throw new Error(JSON.stringify(d));return d.result;};
   const texts=[['今天想和大家聊一聊开心的事情。','忙完今天的事情终于可以坐下来和大家聊天了。','刚才翻到几张旧照片想讲讲那时候的小故事。','晚上好呀你们今天有没有碰到什么有趣的事情？'],['今天想和大家聊一聊开心的事情。','我刚泡好一杯热茶想听听大家今天过得怎么样。','今天读到一个很有意思的故事待会儿慢慢讲给你听。','窗外开始下小雨了这时候安静聊天也挺舒服的。'],['今天想和大家聊一聊开心的事情。','傍晚散步的时候看到几只小鸟想和你们讲讲。','今天的小任务都做完了现在可以慢慢聊一会儿。','刚收拾好桌面坐下来发现外面的天已经黑了。']];
   const text=novel?texts[novel-1][pair]:'今天想和大家聊一聊开心的事情。',context='日常直播聊天，情绪自然，有节制地配合身体动作。';
   await cmd('engine.reset');let session:any;
   const setup=performance.now();if(mode==='v4')session=await cmd('performance.start',{context,kind});
   const begin=performance.now();let firstAudio:number|null=null,finished=false;
   const observer=new Promise<void>(resolve=>{const tick=()=>{if(engine.speechState().phase==='playing'&&firstAudio===null)firstAudio=performance.now()-begin;if(finished){resolve();return;}requestAnimationFrame(tick);};tick();});
   let metrics:any[]=[];
   if(mode==='v3'){
    const response=await fetch('/api/speech/perform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,context,with_motion:true,kind:'regression',style:'natural'})});
    if(!response.ok)throw new Error(await response.text());const lines=await response.text();if(lines.includes('"type":"error"'))throw new Error(lines);
    while(engine.speechState().active)await new Promise(r=>setTimeout(r,30));
   }else{
    await cmd('performance.append',{session_id:session.session_id,seq:0,text});await cmd('performance.finish',{session_id:session.session_id,seq:1});
    for(let i=0;i<2000;i++){const s=await cmd('performance.state');if(s.queue.error)throw new Error(s.queue.error);if(s.queue.phase==='finished'){metrics=s.queue.metrics;break;}await new Promise(r=>setTimeout(r,30));}
    await cmd('performance.cancel',{session_id:session.session_id});
   }
   finished=true;await observer;return {mode,first_audio_ms:firstAudio,setup_ms:begin-setup,total_ms:performance.now()-begin,metrics};
  },{mode,kind,pair,novel:process.env.LATENCY_TEXT_MODE==='novel3'?3:process.env.LATENCY_TEXT_MODE==='novel2'?2:process.env.LATENCY_TEXT_MODE==='novel'?1:0});results.push({pair,warmup:pair===0,...result});console.log(JSON.stringify({pair,mode,first_audio_ms:result.first_audio_ms}));
 }
 const measured=results.filter(x=>!x.warmup);const median=(a:number[])=>{a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
 const baseline=median(measured.filter(x=>x.mode==='v3').map(x=>x.first_audio_ms)),v4=median(measured.filter(x=>x.mode==='v4').map(x=>x.first_audio_ms));
 const baselineSession=median(measured.filter(x=>x.mode==='v3').map(x=>x.setup_ms+x.first_audio_ms)),v4Session=median(measured.filter(x=>x.mode==='v4').map(x=>x.setup_ms+x.first_audio_ms));
 const compute=measured.filter(x=>x.mode==='v4').flatMap(x=>x.metrics.filter(m=>m.compute_ms!==undefined).map(m=>m.compute_ms)).sort((a,b)=>a-b);
 const p95=compute[Math.ceil(compute.length*.95)-1],summary={baseline_median_first_audio_ms:baseline,v4_median_first_audio_ms:v4,increase_ms:v4-baseline,baseline_including_setup_ms:baselineSession,v4_including_setup_ms:v4Session,increase_including_setup_ms:v4Session-baselineSession,action_update_p95_ms:p95,action_update_samples:compute.length};
 const capabilities=await(await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'capabilities.get'})})).json();
 writeFileSync(join(out,`latency${suffix}.json`),JSON.stringify({ok:v4-baseline<=200&&v4Session-baselineSession<=200&&p95<200,kind,runtime_version:capabilities.result.runtime_version,text_mode:process.env.LATENCY_TEXT_MODE??'repeated',setup_reported_separately:true,warmup_pairs:1,measured_pairs:3,summary,results},null,2));
 assert.ok(measured.every(r=>r.first_audio_ms!==null));assert.ok(v4-baseline<=200,'first audio increase >200ms');assert.ok(v4Session-baselineSession<=200,'first audio including session setup increase >200ms');assert.ok(p95<200,'action update P95 >=200ms');console.log(JSON.stringify(summary));
}finally{await browser.close();}
