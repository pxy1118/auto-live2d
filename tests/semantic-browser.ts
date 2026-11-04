import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8777';
const out=process.env.SEMANTIC_RESULT_DIR??join(root,'test-results/semantic-live2d-r1');mkdirSync(out,{recursive:true});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,executablePath,args:['--disable-background-timer-throttling']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript('window.__name = target => target;');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function command(method:string,params:any={}){
 const response=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});
 const result:any=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result.result;
}
const sourceFiles=['semantic/planner.py','semantic/grammar.py','semantic/serve.py','semantic/native.py','semantic/native-runtime.json','src/semantic-performance.ts','src/performance.ts','src/performance-profile.ts','src/speech.ts','src/engine.ts','server/performance-service.ts','server/semantic-audio.ts','src/performance-panel.ts','main.py','latent/pyproject.toml','latent/uv.lock'];
const report:any={ok:false,base,cases:[],errors,source_sha256:Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')])),scope:'real local semantic model, TTS and Cubism; development functional verification'};
async function perform(name:string,text:string,params:any={},pause=false){
 const started=Date.now(),start=await command('performance.start',{motion_style:'restrained',...params}),trace:any[]=[];
 await command('performance.finish',{session_id:start.session_id,seq:0,text});
 let didPause=false,peak=false;
 while(Date.now()-started<150000){
  const [p,s]=await Promise.all([command('performance.state'),command('state.get')]);
  if(p.queue.error)throw new Error(name+': '+p.queue.error);
  trace.push({at_ms:Date.now()-started,phase:p.queue.phase,media_ms:p.media_ms,actor_ms:p.actor_ms,semantic:p.semantic,
    motion:p.motion_actions,body:p.body_action,values:s.values,speech:s.speech});
  assert.ok(Object.values(s.values).every(Number.isFinite));assert.equal(s.values.key11,1);assert.equal(s.values.Clothes1,1);
  if(pause&&!didPause&&p.media_ms>300&&s.speech.active){await command('engine.pause',{paused:true});const a=await command('performance.state');await sleep(300);const b=await command('performance.state');assert.equal(a.media_ms,b.media_ms);assert.equal(a.actor_ms,b.actor_ms);await command('engine.pause',{paused:false});didPause=true;}
  if(!peak&&p.media_ms>700){await page.locator('#stage').screenshot({path:join(out,name+'.png')});peak=true;}
  if(p.queue.phase==='finished'){
   const item={name,text,elapsed_ms:Date.now()-started,semantic:p.semantic,metrics:p.queue.metrics,trace,pause_verified:didPause};
   report.cases.push(item);writeFileSync(join(out,'progress.json'),JSON.stringify(report,null,2));
   await command('performance.cancel',{session_id:start.session_id});return item;
  }
  await sleep(90);
 }
 throw new Error(name+': playback timed out');
}
try{
 for(let i=0;i<100;i++){const status=await command('performance.status').catch(()=>({ready:false}));const voice:any=await fetch('http://127.0.0.1:8769/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).catch(()=>({ready:false}));if(status.ready&&status.semantic_planner&&voice.ready&&!voice.busy)break;if(i===99)throw new Error('local semantic or speech service not ready');await sleep(1000);}
 await page.goto(base+'/?speech=1#performance-panel');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#performance-title')?.textContent==='本地语义表演',{timeout:30000});
 assert.equal(await page.locator('#latent-panel').isVisible(),false);assert.equal(await page.locator('#semantic-manual-tools').getAttribute('open'),null);
 const status=await command('performance.status');assert.equal(status.semantic_planner,true);report.status=status;
 await page.locator('#performance-enable-audio').click();assert.equal((await command('state.get')).speech.enabled,true);await command('appearance.update',{glasses:'black',skirt:'short'});
 const paragraph=await perform('paragraph','大家好呀。这件事就交给我吧。再陪我一会儿好不好？你突然这么夸我，我有点不好意思啦。');
 assert.equal(paragraph.metrics.filter((m:any)=>m.semantic_prefill_ms!==undefined).length,1,'one paragraph must use one semantic call');
 assert.equal(paragraph.metrics.filter((m:any)=>m.synthesis_ms!==undefined).length,1,'one paragraph must use one continuous TTS utterance');
 assert.equal(new Set(paragraph.trace.filter((t:any)=>t.speech.active).map((t:any)=>t.speech.speech_id)).size,1);
 assert.equal(Math.max(...paragraph.trace.map((t:any)=>t.speech.underruns)),0,'continuous paragraph must not underrun');
 assert.equal(paragraph.semantic.duration_final,true);assert.ok(paragraph.semantic.duration_ms>6000);
 assert.ok(paragraph.metrics.find((m:any)=>m.synthesis_ms!==undefined).synthesis_ms>paragraph.metrics.find((m:any)=>m.first_chunk_ms!==undefined).first_chunk_ms,'first PCM must play before full paragraph synthesis completes');
 assert.ok(paragraph.semantic.events.some((e:any)=>e.delivery==='shy'),'the final emotional transition must survive whole-paragraph planning');
 const wave=await perform('greeting','大家好，欢迎回来，我们今天一起慢慢聊。',{context:'角色面向观众，轻松欢迎大家。',director_instruction:'开头向大家轻轻挥手一次，然后自然收手。'},true);
 assert.ok(wave.pause_verified,'audio-clock pause/resume must work');
 assert.ok(wave.semantic.applied.some((a:any)=>a.intent==='wave'&&a.applied),'explicit wave must reach the actual motion layer');
 assert.ok(Math.max(...wave.trace.map((t:any)=>t.values.ParamMouthOpenY))>.12,'real TTS must open the mouth');
 assert.ok(Math.max(...wave.trace.map((t:any)=>t.values.Param42))-Math.min(...wave.trace.map((t:any)=>t.values.Param42))>.12,'wrist must move');
 const quiet=await perform('negation','我没有生气，只是想把事情说清楚。',{context:'角色在平静解释，没有反讽，也没有生气。',audience_message:'你是不是生气了？',director_instruction:'平静解释，不要挥手，也不需要明显手势。'});
 assert.notEqual(quiet.semantic.plan.delivery,'restrained_anger');
 assert.ok(!quiet.semantic.applied.some((a:any)=>a.intent==='wave'&&a.applied));
 assert.ok(Math.max(...quiet.trace.map((t:any)=>t.values.key1))<.1);
 const praise=await perform('praise','你可真行。',{audience_message:'那道大家都没做出来的题，我终于解出来了！'});
 const irony=await perform('irony','你可真行。',{audience_message:'你刚提醒我保存，我还是把没保存的文件关掉了。'});
 assert.equal(praise.semantic.plan.speech_act,'praise');assert.equal(irony.semantic.plan.speech_act,'tease');
 assert.notEqual(praise.semantic.plan.delivery,irony.semantic.plan.delivery);
 const cancelled=await command('performance.start',{context:'测试规划中停止'});await command('performance.finish',{session_id:cancelled.session_id,seq:0,text:'欢迎大家回来，今天我们一起看看接下来要做什么。'});
 await sleep(150);await command('performance.cancel',{session_id:cancelled.session_id});await sleep(2000);
 let state=await command('state.get');assert.equal(state.performance.active,false);assert.equal(state.speech.active,false);
 await assert.rejects(command('performance.append',{session_id:cancelled.session_id,seq:1,text:'迟到的台词。'}));
 report.cancellation={stops_audio:true,rejects_late_input:true};
 await page.locator('#performance-text').fill('你好，我们继续聊吧。');await page.locator('#performance-context').fill('刚刚停止播放，现在继续聊天。');await page.locator('#semantic-director').fill('平静说话，不需要明显动作。');
 await page.locator('#performance-play').click();await sleep(200);await page.locator('#performance-stop').click();await sleep(1500);
 state=await command('state.get');assert.equal(state.performance.active,false);assert.equal(state.speech.active,false);report.cancellation.visible_buttons=true;
 const recovery=await perform('recovery','已经停好了，我们继续吧。',{context:'停止后恢复普通说话。',director_instruction:'平静说明，不需要明显手势。'});
 assert.ok(recovery.semantic.plan.meaning);
 await page.screenshot({path:join(out,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:430,height:920});await page.screenshot({path:join(out,'mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile layout must not overflow');
 assert.deepEqual(errors,[]);report.ok=true;
}catch(error:any){report.failure=error.stack??String(error);throw error;}
finally{writeFileSync(join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,cases:report.cases.map((c:any)=>({name:c.name,meaning:c.semantic.plan.meaning,delivery:c.semantic.plan.delivery,first_audio_ms:c.trace.find((t:any)=>t.speech.phase==='playing')?.at_ms,elapsed_ms:c.elapsed_ms})),cancellation:report.cancellation},null,2));
