/** Production render + real worker smoke on an isolated actor, preserving the user's page. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createWriteStream,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';

const root=join(import.meta.dirname,'..'),out=join(root,process.env.LIVE2D_SMOKE_OUT??'test-results/emotion-action-v1/smoke');
const base='http://127.0.0.1:8775';mkdirSync(out,{recursive:true});
const sha=(name:string)=>createHash('sha256').update(readFileSync(join(root,name))).digest('hex');
const protectedPaths=['latent/stream-run.json','latent/default-run.json','.runtime/performance/ratings.json'];
const protectedBefore=Object.fromEntries(protectedPaths.map(p=>[p,sha(p)]));
try{await fetch(base+'/api/health');throw Error('8775 is occupied; no existing actor will be taken over');}
catch(e){if(!(e instanceof TypeError))throw e;}
const log=createWriteStream(join(out,'isolated-server.log'));
const child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775'},windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const errors:string[]=[],report:any={ok:false,base,checks:[],errors,trace:[],human_votes_created:0};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function command(method:string,params:any={},request_id=randomUUID()){
 const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id})});
 const d:any=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d.result;
}
try{
 let ready=false;
 for(let i=0;i<100;i++){try{const h:any=await (await fetch(base+'/api/health')).json();assert.equal(h.process_id,child.pid);ready=true;break;}catch{await sleep(100);}}
 assert.ok(ready,'isolated production server did not become ready');
 const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));
 assert.ok(executablePath,'Install system Chrome or set BROWSER_EXECUTABLE');
 browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
 report.browser=browser.version();
 const page=await browser.newPage({viewport:{width:1365,height:1050}});
 await page.addInitScript('window.__name=target=>target;');page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/');
 await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.waitForFunction(()=>!(document.getElementById('performance-play') as HTMLButtonElement)?.disabled,undefined,{timeout:20000});
 assert.equal(await page.locator('#latent-panel,#speech-panel,#command-editor,#performance-kind,#performance-backend').count(),0);
 assert.equal(await page.locator('#performance-motion-style').inputValue(),'lively');
 assert.equal(await page.locator('.performance-settings').evaluate((el:HTMLDetailsElement)=>el.open),false);
 assert.equal(await page.locator('#performance-panel a').count(),0);
 for(const endpoint of ['/api/latent/status','/api/latent/predict','/api/speech/status','/api/speech/perform','/api/speech/prepare','/api/speech/execute'])assert.equal((await fetch(base+endpoint,{method:endpoint.endsWith('/status')?'GET':'POST'})).status,404,endpoint);
 const retired=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'gesture.set',params:{side:'right',pose:'grass'}})});assert.equal(retired.status,404);
 const status=await command('performance.status'),cap=await command('capabilities.get');
 assert.equal(status.promoted,true);assert.equal(status.uses_4b,false);assert.equal(status.driver,'emotion_action');
 assert.equal(status.execution.motor_device,'cuda');assert.equal(status.execution.planner_device,'cuda');assert.equal(status.execution.emotion_device,'cuda');
 assert.equal(cap.runtime_version,PERFORMANCE_RUNTIME_VERSION);assert.equal(cap.active_performance.body_planner,null);assert.equal(cap.active_performance.uses_4b,false);
 assert.equal(cap.default_motion_style,'lively');assert.equal(cap.gesture_policy.minimum_gap_ms,4000);
 assert.equal(cap.automatic_plan.emotion_policy,'continuous_multi_label_curves');
 assert.ok(!cap.methods.includes('performance.configure'));
 report.execution=status.execution;report.runtime_version=cap.runtime_version;
 report.checks.push('Single-stage speaking UI; optional settings folded; legacy panels, HTTP endpoints and old public control methods removed; emotion classifier and 0.8B motion model; no 4B encoder');
 const worker:any=await (await fetch('http://127.0.0.1:8768/health')).json();
 assert.deepEqual(worker.models,['regression']);assert.equal(worker.uses_4b,false);assert.equal(worker.emotion_classifier.parameters,307551772);assert.equal(worker.emotion_classifier.device,'cuda');assert.equal(worker.sampling_hz,20);assert.ok(!('output_shape' in worker));
 assert.equal((await fetch('http://127.0.0.1:8768/predict',{method:'POST'})).status,404);
 report.checks.push('Current worker exposes only the streaming regression policy; v3 predict route and Flow runtime removed');
 const tts:any=await (await fetch('http://127.0.0.1:8769/health')).json();
 assert.equal(tts.ready,true);assert.equal(tts.busy,false);
 assert.equal(tts.environment.device,'cuda');
 assert.equal(tts.checkpoint_sha256,'b62a26f6c2ebd10582c088c318d1fe045f19861500caf7eae300b676d2f19a3d');
 report.tts={model:tts.model,speaker:tts.speaker,backend:tts.backend,checkpoint_sha256:tts.checkpoint_sha256};
 await command('speech.unlock');await command('appearance.update',{glasses:'black',skirt:'long',shoes:false});
 const restrained=await command('performance.start',{motion_style:'restrained'});
 assert.equal((await command('performance.state')).gesture_policy.style,'restrained');
 await command('performance.cancel',{session_id:restrained.session_id});
 const initial=await command('state.get');
 const start=await command('performance.start',{context:'向观众问候，然后平静说明今天整理资料的安排。'});
 const defaultState=await command('performance.state');assert.equal(defaultState.gesture_policy.style,'lively');assert.deepEqual(defaultState.planner_policy,{arm:4000,body:2600});
 report.checks.push('Lively default agrees across page, API and actor; explicit restrained option remains available');
 const sid=start.session_id,requestId=randomUUID(),append={session_id:sid,seq:0,text:'大家好呀。'};
 assert.deepEqual(await command('performance.append',append,requestId),await command('performance.append',append,requestId));
 await command('performance.direct',{session_id:sid,clause:0,gesture:'wave',gesture_hold_ms:1200});
 await command('performance.direct',{session_id:sid,emotion:'angry',intensity:.7,hold_ms:2000});
 await command('performance.direct',{session_id:sid,clause:1,expression:'＞＜',emotion:'shy',intensity:.5,hold_ms:2000,body_motion:'tilt',body_strength:.4,body_hold_ms:1200});
 await command('performance.finish',{session_id:sid,seq:1,text:'今天我们一起把资料整理好。'});
 let done:any,paused=false,black=false,eyes=false,wristMin=Infinity,wristMax=-Infinity,palmY=-Infinity;
 const begun=Date.now();
 while(Date.now()-begun<60000){
  const state=await command('state.get',{hand_landmarks:true}),p=await command('performance.state');
  assert.ok(Object.values(state.values).every(Number.isFinite));
  assert.equal(state.values.key11,1);assert.equal(state.values.Clothes4,1);assert.equal(state.values.Clothes1,0);
  assert.ok(state.background_time_ms>=initial.background_time_ms);
  if(p.queue.error)throw Error(p.queue.error);
  black||=state.values.key1>.5;eyes||=state.values.key5===1;
  wristMin=Math.min(wristMin,state.values.Param42);wristMax=Math.max(wristMax,state.values.Param42);
  if((state.hand_landmarks?.right?.y??-Infinity)>palmY){palmY=state.hand_landmarks.right.y;if(p.motion_actions?.active)await page.locator('#stage').screenshot({path:join(out,'render-wave.png')});}
  report.trace.push({wall_ms:Date.now()-begun,media_ms:p.media_ms,clause:p.clause,phase:p.queue.phase,black:state.values.key1,eye:state.values.key5,wrist:state.values.Param42,body:p.body_action,motion:p.motion_actions});
  if(!paused&&p.media_ms>600&&p.queue.phase!=='finished'){
   await command('engine.pause',{paused:true});const a=await command('performance.state');await sleep(250);const b=await command('performance.state');
   assert.equal(a.media_ms,b.media_ms);assert.equal(a.actor_ms,b.actor_ms);await command('engine.pause',{paused:false});paused=true;
  }
  if(p.queue.phase==='finished'){done=p;break;}await sleep(70);
 }
 assert.ok(done,'real speech did not complete');assert.ok(paused&&black&&eyes);
 assert.equal(done.plan_history.length,2);assert.equal(new Set(done.plan_history.map((p:any)=>p.clause)).size,2);
 assert.ok(palmY>.3&&palmY<.7,`face-side palm y=${palmY}`);assert.ok(wristMax-wristMin>.25);
 report.plan_history=done.plan_history;report.real_audio_ms=done.media_ms;
 report.wave={palm_y:palmY,wrist_range:wristMax-wristMin};
 report.checks.push('Real streamed TTS and two unique clause plans; bent-elbow palm wave, head/body cue, angry hold and bound shy ><; audio-clock pause/resume; idempotent append');
 await command('performance.cancel',{session_id:sid});
 await assert.rejects(command('performance.append',{session_id:sid,seq:2,text:'迟到的内容。'}));
 const cancelled=await command('state.get');assert.equal(cancelled.speech.active,false);assert.equal(cancelled.values.key11,1);assert.equal(cancelled.values.Clothes4,1);
 await page.locator('#portrait-view').click();assert.equal(await page.evaluate(()=>(window as any).live2dDemo.engine.framing),'portrait');await page.locator('#full-view').click();
 await page.locator('.performance-settings summary').click();await page.locator('#performance-context').fill('和观众打招呼，语气轻松亲切。');await page.locator('#performance-motion-style').selectOption('natural');await page.locator('.performance-settings summary').click();
 await page.locator('#performance-text').fill('大家好呀，今天也一起加油吧！');
 await page.waitForFunction(()=>!(document.getElementById('performance-play') as HTMLButtonElement).disabled);
 await page.locator('#performance-play').click();
 const uiStarted=Date.now();let uiSpoke=false;
 while(Date.now()-uiStarted<30000){const s=await command('state.get');if(s.speech.active&&s.speech.audio_time_ms>250){uiSpoke=true;break;}await sleep(80);}
 assert.ok(uiSpoke,'Start button must produce real Qwen speech');
 assert.equal((await command('performance.state')).gesture_policy.style,'natural');
 assert.ok(await page.locator('#performance-play').isDisabled());assert.ok(await page.locator('#performance-stop').isEnabled());
 await page.locator('#performance-stop').click();await sleep(200);assert.equal((await command('state.get')).speech.active,false);
 await page.waitForFunction(()=>!(document.getElementById('performance-play') as HTMLButtonElement).disabled);
 await page.locator('.performance-settings summary').click();await page.locator('#performance-motion-style').selectOption('lively');await page.locator('.performance-settings summary').click();
 report.checks.push('Simple page submits whole text directly; actual start/stop buttons produce and cancel real speech');
 report.automatic_emotions=[];
 for(const scene of [
  {name:'happy',text:'大家好呀，今天很高兴见到你。',emotion:'happy'},
  {name:'angry',text:'太过分了，我真的很生气！',emotion:'angry',channel:'key1',minimum:.45},
  {name:'shy',text:'你突然这样夸我，我有点不好意思啦。',emotion:'shy',channel:'key7',minimum:.55},
  {name:'quoted',text:'她说“我太生气了”，我只是在读这句留言。',emotion:'neutral'},
 ]){
  const started=await command('performance.start',{context:'和观众日常聊天'});await command('performance.finish',{session_id:started.session_id,seq:0,text:scene.text});
  const peaks:Record<string,number>={key1:0,key7:0,EyeSmile:0,ParamMouthForm:0};let final:any;
  const at=Date.now();while(Date.now()-at<35000){
   const state=await command('state.get'),p=await command('performance.state');if(p.queue.error)throw Error(p.queue.error);
   for(const key of Object.keys(peaks))peaks[key]=Math.max(peaks[key],state.values[key]??0);
   if(p.queue.phase==='finished'){final=p;break;}await sleep(60);
  }
  assert.ok(final,scene.name+' did not finish');assert.equal(final.plan_history[0].plan.emotion,scene.emotion);
  report.automatic_emotions.push({...scene,peaks,plan:final.plan_history[0].plan,affect:final.affect});
  if(scene.channel)assert.ok(peaks[scene.channel]>scene.minimum,scene.name+' classifier did not reach its facial channel: '+JSON.stringify(peaks));
  if(scene.name==='happy')assert.ok(peaks.EyeSmile>.1||peaks.ParamMouthForm>.1,'Happy affect must reach an ordinary smile channel');
  if(scene.name==='quoted')assert.ok(peaks.key1<.05,'Quoted anger must not turn the avatar black');
  await command('performance.cancel',{session_id:started.session_id});
 }
 report.checks.push('Actual automatic classifier drives smile, anger and blush; quoted anger stays neutral, without manual emotion cues');
 const curveText='今天见到你真的很开心。谢谢你一直陪着我。我们接着聊一会儿。可是这件事太过分了，我真的很生气！不过谢谢你安慰我，我现在好多了。';
 const curveSession=await command('performance.start',{context:'和观众聊天，情绪随当前说的话自然变化。'});
 await command('performance.finish',{session_id:curveSession.session_id,seq:0,text:curveText});
 const trace:any[]=[];let curveDone:any,curvePaused=false;const curveBegin=Date.now();
 while(Date.now()-curveBegin<60000){
  const p=await command('performance.state'),state=await command('state.get');if(p.queue.error)throw Error(p.queue.error);
  trace.push({wall_ms:Date.now()-curveBegin,media_ms:p.media_ms,clause:p.clause,affect:p.affect,expressions:p.expressions,values:{EyeSmile:state.values.EyeSmile,ParamMouthForm:state.values.ParamMouthForm,key1:state.values.key1,key7:state.values.key7}});
  if(!curvePaused&&p.affect?.clock_ms>2200&&p.queue.phase==='playing'){
   await command('engine.pause',{paused:true});const a=await command('performance.state');await sleep(250);const b=await command('performance.state');
   assert.deepEqual(b.affect,a.affect);assert.deepEqual(b.expressions,a.expressions);await command('engine.pause',{paused:false});curvePaused=true;
  }
  if(p.queue.phase==='finished'){curveDone=p;break;}await sleep(60);
 }
 assert.ok(curveDone&&curvePaused,'continuous emotion scene did not finish and pause');
 const speaking=trace.filter(row=>row.affect.enabled&&row.affect.point_index>=0),points=new Map<number,any>();
 for(const row of speaking)points.set(row.affect.point_index,row.affect.source);
 assert.ok(points.size>curveDone.plan_history.length,'phrase-level observations must vary within an action sentence');
 assert.ok(speaking.some(row=>row.affect.weights.happy>.35),'sustained happiness must remain visible');
 assert.ok(speaking.some(row=>row.affect.weights.angry>.35),'real reversal must reach anger during speech');
 assert.ok(speaking.some(row=>row.affect.mood.happy>.05&&row.affect.target.angry>.25),'mood must carry into a new target without resetting');
 const syntheses=curveDone.queue.metrics.filter((row:any)=>row.continuous_utterance);assert.equal(syntheses.length,1,'emotion observations must never split TTS');
 report.emotion_curve={text:curveText,trace,points:[...points.entries()],tts_streams:syntheses.length,plans:curveDone.plan_history.length,pause_frozen:true};
 await command('performance.cancel',{session_id:curveSession.session_id});assert.equal((await command('performance.state')).affect.strength,0);
 report.checks.push('One real TTS stream with phrase-level continuous emotion, fast reaction and slow mood; actual reversal, frozen pause, and cancellation clears future affect');
 await page.screenshot({path:join(out,'default-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'default-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.reload();await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 const fresh=await command('state.get');assert.equal(fresh.values.key11,0);
 assert.deepEqual(Object.fromEntries(protectedPaths.map(p=>[p,sha(p)])),protectedBefore);assert.deepEqual(errors,[]);
 report.checks.push('Cancellation rejects late input and retains wardrobe; fresh actor restores default appearance; desktop/mobile render; original votes and model pointers unchanged');
 report.ok=true;
}catch(error){report.error=String(error);throw error;}
finally{
 await browser?.close();child.kill();
 for(let i=0;i<50&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);
 report.isolated_server_stopped=child.exitCode!==null||child.signalCode!==null;
 log.end();writeFileSync(join(out,'browser-smoke.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({ok:report.ok,checks:report.checks,real_audio_ms:report.real_audio_ms,isolated_server_stopped:report.isolated_server_stopped},null,2));
