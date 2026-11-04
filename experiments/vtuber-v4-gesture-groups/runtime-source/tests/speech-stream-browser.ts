import assert from 'node:assert/strict';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { jsonLines } from '../server/ndjson';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8765';
const out=join(root,'test-results/speech-v2');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
const report:any={ok:false,checked:[],base,cases:[]},errors:string[]=[];
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function request(path:string,body?:any,status=200){
  const response=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data:any=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
async function command(method:string,params:any={},status=200){return (await request('/api/command',{method,params},status)).result;}
function correlation(a:number[],b:number[]){const mean=(x:number[])=>x.reduce((s,v)=>s+v,0)/x.length,ma=mean(a),mb=mean(b);return a.reduce((s,v,i)=>s+(v-ma)*(b[i]-mb),0)/Math.sqrt(a.reduce((s,v)=>s+(v-ma)**2,0)*b.reduce((s,v)=>s+(v-mb)**2,0));}
async function idleWorker(){for(let i=0;i<50;i++){if(!(await request('/api/speech/status')).busy)return;await delay(100);}throw new Error('TTS did not release cancelled generation');}
try{
  const page=await browser.newPage({viewport:{width:1440,height:1150}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript('window.__name = target => target;');
  await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
  const status=await request('/api/speech/status');assert.equal(status.backend,'cuda_graph');assert.equal(status.streaming,true);report.status=status;
  await request('/api/speech/perform',{text:'你好。'},400);
  await page.locator('#speech-enable').click();
  await command('engine.reset',{preserve_background:true});
  const text='今天想和大家聊一聊开心的事情。先坐好，听我慢慢说。遇到困难也别着急，我们一起想办法，好不好？';
  await page.locator('#latent-text').fill(text);await page.locator('#latent-context').fill('直播闲聊，轻松地和观众说话，双手安静，不要害羞。');
  await page.locator('#speech-motion').check();
  await page.evaluate(()=>{
    const w=window as any,e=w.live2dDemo.engine;
    w.speechV2={start:0,first_audio_ms:null,worker_busy_at_start:null,trace:[],done:false};
    document.getElementById('speech-perform')!.addEventListener('click',()=>{w.speechV2.start=performance.now();},{once:true,capture:true});
    const tick=()=>{
      const result=w.speechV2;if(!result.start){requestAnimationFrame(tick);return;}
      const s=e.dispatch('state.get',{geometry:true}),p=s.speech;
      if(p.phase==='playing'&&result.first_audio_ms===null){result.first_audio_ms=performance.now()-result.start;fetch('/api/speech/status').then(r=>r.json()).then(r=>result.worker_busy_at_start=r.busy);}
      result.trace.push({wall_ms:performance.now()-result.start,phase:p.phase,complete:p.complete,audio_ms:p.audio_time_ms,motion_ms:p.motion_time_ms,control_ms:s.time_ms,
        actual:s.values.ParamMouthOpenY,expected:p.mouth_open,baseY:s.action_driver.AngleY,driverY:s.driver.AngleY,baseChest:s.action_driver.PositionY,driverChest:s.driver.PositionY,
        rhythm:p.rhythm,underruns:p.underruns,behavior:s.behavior,body:s.values.ParamBodyAngleY,geometry:s.geometry});
      if(result.first_audio_ms!==null&&!p.active){result.done=true;return;}requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  });
  await page.locator('#speech-perform').click();
  await page.waitForFunction(()=>(window as any).live2dDemo.engine.speechState().audio_time_ms>700,{timeout:60000});
  await command('engine.pause',{paused:true});const paused=await command('state.get');await delay(260);const still=await command('state.get');
  assert.equal(still.speech.audio_time_ms,paused.speech.audio_time_ms);assert.equal(still.time_ms,paused.time_ms);
  await command('engine.pause',{paused:false});
  // Block rendering while WebAudio keeps running: semantic phase must catch up.
  await page.evaluate(()=>{const end=performance.now()+650;while(performance.now()<end){};});await delay(100);
  const caught=await command('state.get');assert.ok(Math.abs(caught.time_ms-caught.speech.motion_time_ms)<80,'body clock drift after a render stall');
  await page.screenshot({path:join(out,'stream-desktop.png'),fullPage:true});
  await page.waitForFunction(()=>(window as any).speechV2.done,{timeout:60000});
  const captured=await page.evaluate(()=>(window as any).speechV2);
  captured.first_mouth_open_ms=captured.trace.find((t:any)=>t.phase==='playing'&&t.actual>.12)?.wall_ms??null;
  const final=JSON.parse(await page.locator('#latent-details').textContent()??'{}');
  assert.equal(final.type,'end');assert.ok(final.chunks>5);assert.equal(final.backend,'cuda_graph');
  assert.equal(captured.worker_busy_at_start,true,'speech must start before full synthesis finishes');
  assert.ok(captured.first_audio_ms<3500,'unexpected first-audio latency: '+captured.first_audio_ms);
  assert.ok(captured.trace.every((t:any)=>Object.values(t.behavior).every(v=>v===true)));
  const frames=captured.trace.filter((t:any)=>t.phase==='playing'),corr=correlation(frames.map((t:any)=>t.actual),frames.map((t:any)=>t.expected));
  assert.ok(corr>.9,'mouth correlation '+corr);assert.equal(Math.max(...frames.map((t:any)=>t.underruns)),0,'real TTS stream must not underrun');
  assert.ok(frames.some((t:any)=>t.audio_ms>7000&&t.motion_ms<6400),'long speech must stretch the body sequence past 6.4 s');
  assert.ok(frames.some((t:any)=>t.rhythm.beat>.4&&Math.abs((t.driverY-t.baseY)+2.4*t.rhythm.beat)<.3),'actual head driver must follow spoken emphasis');
  assert.ok(frames.some((t:any)=>t.rhythm.body_beat>.4&&Math.abs((t.driverChest-t.baseChest)+1.1*t.rhythm.body_beat)<.2),'chest must follow the delayed audio accent');
  assert.ok(Math.max(...frames.map((t:any)=>t.body))-Math.min(...frames.map((t:any)=>t.body))>.1,'actual Cubism body must move');
  assert.ok((await command('state.get')).values.ParamMouthOpenY<.04);
  report.cases.push({text,first_audio_ms:captured.first_audio_ms,first_mouth_open_ms:captured.first_mouth_open_ms,first_chunk_ms:final.first_chunk_ms,synthesis_ms:final.synthesis_ms,duration_ms:final.duration_ms,
    audio_url:final.audio_url,audio_sha256:final.audio_sha256,correlation:corr,worker_busy_at_start:captured.worker_busy_at_start,trace:captured.trace});
  report.checked.push('real streamed TTS starts before completion; zero underruns; audio-clock body retiming past 6.4 s; head/chest emphasis on actual Cubism drivers; resident behaviors; pause/resume and render-stall recovery');
  // Cancellation after the first chunk must stop decoding, audio, and body.
  const abort=new AbortController();
  const response=await fetch(base+'/api/speech/perform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.repeat(3),with_motion:true}),signal:abort.signal});
  assert.equal(response.status,200);let cancelledId:string|undefined;
  for await(const event of jsonLines(response.body!)){
    if(event.type==='start')cancelledId=event.speech_id;
    if(event.type==='error')throw new Error(event.error);
    if(event.type==='progress'){
      await request('/api/speech/perform',{text:'不要重入。'},429);abort.abort();break;
    }
  }
  await idleWorker();await delay(200);assert.equal((await command('speech.status')).active,false);
  await command('speech.stream.append',{speech_id:cancelledId,index:999},400);
  report.checked.push('concurrent generation rejected; disconnect cancels real decoder and active playback; late chunks rejected');
  // Deliberately underfill: media and body clocks must hold during buffering.
  const id='c'.repeat(32),sr=24000,n=sr/4;
  const cue={method:'test',hz:60,duration_ms:250,values:Array(16).fill(.2)};
  const chunk={speech_id:id,index:0,sample_rate:sr,offset_samples:0,samples:n,pcm16_base64:Buffer.alloc(n*2).toString('base64'),mouth:cue};
  await command('speech.stream.begin',{speech_id:id,estimated_duration_ms:1000});await command('speech.stream.append',chunk);
  await delay(550);const buffering=await command('speech.status');assert.equal(buffering.phase,'buffering');assert.equal(buffering.audio_time_ms,250);
  await delay(150);assert.equal((await command('speech.status')).audio_time_ms,250);
  await command('speech.stream.append',chunk,400);await command('speech.stream.finish',{speech_id:id,total_samples:n+1},400);
  assert.equal((await command('speech.stop',{speech_id:'d'.repeat(32)})).stopped,false);assert.equal((await command('speech.status')).active,true);
  await command('speech.stream.append',{...chunk,index:1,offset_samples:n});
  await command('speech.stream.finish',{speech_id:id,total_samples:n*2});await delay(150);
  const resumed=await command('speech.status');assert.equal(resumed.underruns,1);assert.ok(resumed.audio_time_ms>250&&resumed.audio_time_ms<500);
  await delay(300);assert.equal((await command('speech.status')).active,false);
  report.checked.push('buffer underrun holds media time; recovery retains samples; duplicate/missing/mismatched chunks rejected; old cancellation cannot stop a new session');
  // Voice-only streaming must preserve expressions, and UI stop must abort generation.
  await command('expressions.set',{name:'黑脸',enabled:true,strength:.85,fade_ms:0});
  await command('parameters.set',{values:{ParamMouthForm:-.3}});
  await page.locator('#latent-text').fill(text.repeat(2));await page.locator('#speech-motion').uncheck();
  await page.locator('#speech-perform').click();await page.waitForFunction(()=>(window as any).live2dDemo.engine.speechState().phase==='playing',{timeout:60000});
  const only=await command('state.get');assert.ok(Math.abs(only.values.key1-.85)<.01);assert.ok(Math.abs(only.values.ParamMouthForm+.3)<.01);assert.equal(only.speech.motion_timing,'none');
  await page.locator('#speech-stop').click();await idleWorker();await delay(200);assert.equal((await command('speech.status')).active,false);
  const cli=await promisify(execFile)('python',['examples/speak_demo.py','--voice-only','--text','我收到啦。'],{cwd:root,timeout:60000,windowsHide:true,encoding:'utf8'});
  const cliEvents=cli.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(cliEvents[0].type,'start');assert.equal(cliEvents.at(-1).type,'end');report.cli=cliEvents;
  await page.waitForFunction(()=>!(window as any).live2dDemo.engine.speechState().active,{timeout:30000});
  report.checked.push('external Python example streams to the enabled character page');
  // A short utterance must not compress the authored 13.8 s full-body motion.
  const nativeSample=JSON.parse(readFileSync(join(root,'experiments/vtuber-v3/predictions.json'),'utf8'))['regression-config_native'];
  const native=await request('/api/speech/prepare',{text:nativeSample.text,context:nativeSample.context,style:nativeSample.style,kind:'regression',with_motion:true});
  assert.equal(native.motion.execution_mode,'native_motion');assert.equal(native.motion.duration_ms,13800);assert.ok(native.duration_ms<10000);
  await request('/api/speech/execute',{speech_id:native.speech_id});await delay(700);
  const nativeStart=await command('state.get',{geometry:true});
  assert.equal(nativeStart.speech.motion_timing,'native_speed');assert.ok(Math.abs(nativeStart.time_ms-nativeStart.speech.audio_time_ms)<80);
  assert.ok(nativeStart.motions.some((m:any)=>m.name==='脱捕'));
  await page.waitForFunction(()=>!(window as any).live2dDemo.engine.speechState().active,{timeout:30000});
  const nativeTail=await command('state.get');assert.ok(nativeTail.motions.some((m:any)=>m.name==='脱捕'));
  await command('engine.pause',{paused:true});
  for(let frames=Math.ceil((14100-nativeTail.time_ms)/1000*60);frames>0;frames-=600)await command('engine.step',{frames:Math.min(600,frames)});
  assert.equal((await command('state.get')).motions.length,0);
  report.native={text:nativeSample.text,speech_duration_ms:native.duration_ms,motion_duration_ms:13800,early_state:nativeStart,tail_state:nativeTail};
  report.checked.push('real speech plus native full-body motion retains original speed and finishes after the short utterance');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(out,'stream-mobile.png'),fullPage:true});
  await command('engine.reset');assert.deepEqual(errors,[]);report.checked.push('voice-only stream preserves black-face and mouth form; visible stop cancels generation; mobile layout');report.ok=true;
}catch(error:any){report.error=error.stack;throw error;}
finally{
  report.browser_errors=errors;writeFileSync(join(out,'stream-verification.json'),JSON.stringify(report,null,2));await browser.close();
  console.log(JSON.stringify({ok:report.ok,error:report.error,checked:report.checked,cases:report.cases.map(({trace,...c}:any)=>c)},null,2));
}
