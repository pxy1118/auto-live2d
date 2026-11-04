import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8766';
const out=join(root,'test-results/speech');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
const report:any={ok:false,checked:[],base,cases:[]},errors:string[]=[];
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function request(path:string,body?:any,status=200){const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
async function command(method:string,params:any={},status=200){return (await request('/api/command',{method,params},status)).result;}
function correlation(a:number[],b:number[]){const mean=(x:number[])=>x.reduce((s,v)=>s+v,0)/x.length,ma=mean(a),mb=mean(b);return a.reduce((s,v,i)=>s+(v-ma)*(b[i]-mb),0)/Math.sqrt(a.reduce((s,v)=>s+(v-ma)**2,0)*b.reduce((s,v)=>s+(v-mb)**2,0));}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1150}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 const status=await request('/api/speech/status');assert.equal(status.ready,true);assert.equal(status.speaker,'da_fei_yu');report.status=status;
 await command('engine.reset',{paused:true});
 await command('parameters.set',{values:{ParamMouthOpenY:0}});const closed=await command('state.get',{geometry:true});
 await command('parameters.set',{values:{ParamMouthOpenY:.8}});const opened=await command('state.get',{geometry:true});
 assert.ok(Math.hypot(opened.geometry.weighted_x-closed.geometry.weighted_x,opened.geometry.weighted_y-closed.geometry.weighted_y)>1,'mouth parameter must alter actual Cubism geometry at the same frozen body pose');
 await command('engine.reset',{preserve_background:true});
 await request('/api/speech/prepare',{text:'x'.repeat(301),with_motion:false},400);
 const p=await request('/api/speech/prepare',{text:'大家晚上好，我是大肥鱼。很高兴又见到你。',context:'直播开始，普通问候观众。',style:'lively',with_motion:true});
 assert.equal(p.checkpoint_sha256,status.checkpoint_sha256);assert.ok(p.motion?.checkpoint_sha256);assert.ok(p.duration_ms>1000);
 const wav=await fetch(base+p.audio_url);assert.ok(wav.headers.get('content-type')?.includes('audio/wav'));
 assert.equal(createHash('sha256').update(Buffer.from(await wav.arrayBuffer())).digest('hex'),p.audio_sha256);
 await request('/api/speech/execute',{speech_id:p.speech_id},400);
 assert.equal((await command('speech.status')).active,false);
 await page.locator('#speech-enable').click();assert.equal((await command('speech.status')).enabled,true);
 const bg=(await command('state.get')).background_time_ms;
 await request('/api/speech/execute',{speech_id:p.speech_id});
 const capture=page.evaluate(async()=>{
  const e=(window as any).live2dDemo.engine,trace:any[]=[],pictures:any={};let seen=false;e.framing='portrait';
  for(let i=0;i<1400;i++){
   await new Promise<void>(r=>requestAnimationFrame(()=>r()));const s=e.dispatch('state.get',{geometry:true}),v=s.values;
   if(s.speech.active)seen=true;
   trace.push({phase:s.speech.phase,audio_time_ms:s.speech.audio_time_ms,expected:s.speech.mouth_open,actual:v.ParamMouthOpenY,semantic:s.action_driver.ParamMouthOpenY,
    behavior:s.behavior,background_time_ms:s.background_time_ms,body:[v.ParamBodyAngleX,v.ParamBodyAngleY,v.ParamBodyAngleZ],mouth_form:v.ParamMouthForm,geometry:s.geometry});
   if(s.speech.phase==='playing'){
    const key=v.ParamMouthOpenY>.5?'open':v.ParamMouthOpenY<.03&&s.speech.audio_time_ms>200?'closed':null;
    if(key&&!pictures[key]){e.draw();pictures[key]=e.canvas.toDataURL('image/png');}
   }
   if(seen&&!s.speech.active)break;
  }return {trace,pictures};
 });
 await delay(600);await command('engine.pause',{paused:true});const paused=await command('state.get');await delay(280);const still=await command('state.get');
 assert.equal(paused.speech.phase,'paused');assert.equal(still.speech.audio_time_ms,paused.speech.audio_time_ms);assert.equal(still.time_ms,paused.time_ms);
 await command('engine.pause',{paused:false});
 const captured=await capture;
 for(const [name,png] of Object.entries(captured.pictures))writeFileSync(join(out,'mouth-'+name+'.png'),Buffer.from((png as string).split(',')[1],'base64'));
 const frames=captured.trace.filter(t=>t.phase==='playing'),actual=frames.map(t=>t.actual),expected=frames.map(t=>t.expected);
 const corr=correlation(actual,expected),mae=actual.reduce((s,v,i)=>s+Math.abs(v-expected[i]),0)/actual.length;
 assert.ok(corr>.90,'audio-clock mouth correlation '+corr);assert.ok(mae<.08);assert.ok(Math.max(...actual)>.5);
 assert.ok(frames.some(t=>t.semantic<.04&&t.actual>.5),'audio must override the learned closed-mouth trajectory');
 assert.ok(captured.trace.every(t=>Object.values(t.behavior).every(v=>v===true)));
 assert.ok(captured.trace[0].background_time_ms>=bg);
 assert.ok((await command('state.get')).values.ParamMouthOpenY<.04);
 await request('/api/speech/execute',{speech_id:p.speech_id},400);
 report.cases.push({speech_id:p.speech_id,duration_ms:p.duration_ms,synthesis_ms:p.synthesis_ms,audio_sha256:p.audio_sha256,motion:p.motion,correlation:corr,mae,trace:captured.trace});
 report.checked.push('real fine-tuned TTS waveform and checksum; retriable audio unlock; synchronized neural action and speech; actual mouth mesh and readback; pause/resume and natural mouth closure; resident behaviors');
 // Voice-only playback preserves the user's current expression and mouth shape.
 const first=p;
 const params={speech_id:first.speech_id,audio_url:first.audio_url,mouth:first.mouth};
 await command('engine.reset',{preserve_background:true});await command('expressions.set',{name:'黑脸',enabled:true,strength:.85,fade_ms:0});
 await command('parameters.set',{values:{ParamMouthOpenY:0,ParamMouthForm:-.3}});
 await command('speech.play',params);await delay(700);const talking=await command('state.get');
 assert.ok(Math.abs(talking.values.key1-.85)<.01);assert.ok(Math.abs(talking.values.ParamMouthForm+.3)<.01);
 await command('speech.stop');const stopped=await command('state.get');assert.equal(stopped.speech.active,false);assert.equal(stopped.values.ParamMouthOpenY,0);assert.ok(Math.abs(stopped.values.key1-.85)<.01);
 // Stopping while WAV fetch/decode is pending must prevent late playback.
 await page.route('**/api/speech/audio/*.wav',async route=>{await delay(300);await route.continue();});
 const late=command('speech.play',params,400);await delay(70);await command('speech.stop');await late;await page.unroute('**/api/speech/audio/*.wav');
 assert.equal((await command('speech.status')).active,false);
 report.checked.push('voice-only preserves expression/mouth form; stop restores closed mouth; cancellation prevents delayed playback');
 // Cancel the visible generation flow; the current model call may finish, but cannot auto-play.
 await command('engine.reset',{preserve_background:true});
 await page.locator('#latent-text').fill('收到你的消息啦，谢谢你的提醒。');await page.locator('#speech-motion').uncheck();
 await page.locator('#speech-perform').click();await delay(400);assert.ok(await page.locator('#latent-predict').isDisabled());
 await page.locator('#speech-stop').click();
 for(let i=0;i<180;i++){await delay(200);if(!(await request('/api/speech/status')).busy)break;}
 await delay(300);assert.equal((await command('speech.status')).active,false);
 // The visible button must complete synthesis and actual audio playback.
 await page.locator('#speech-perform').click();await page.waitForFunction(()=>(window as any).live2dDemo.engine.speechState().phase==='playing',{timeout:180000});
 await page.screenshot({path:join(out,'speech-desktop.png'),fullPage:true});
 await page.locator('#speech-stop').click();assert.equal((await command('speech.status')).active,false);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,'speech-mobile.png'),fullPage:true});
 await command('engine.reset');assert.deepEqual(errors,[]);report.checked.push('visible speech button, cancel during generation, stop, and responsive layout');report.ok=true;
}catch(e:any){report.error=e.stack;throw e;}
finally{report.browser_errors=errors;writeFileSync(join(out,'verification.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({ok:report.ok,error:report.error,checked:report.checked,measurements:report.cases.map((c:any)=>({duration_ms:c.duration_ms,synthesis_ms:c.synthesis_ms,correlation:c.correlation,mae:c.mae}))},null,2));}
