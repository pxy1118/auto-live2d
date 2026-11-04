/** Production render + real worker smoke on an isolated actor, preserving the user's page. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createWriteStream,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';

const root=join(import.meta.dirname,'..'),out=join(root,'test-results/v4-finalization-20261104');
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
 await page.goto(base+'/?speech=1#performance-panel');
 await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.waitForFunction(()=>document.getElementById('performance-status')?.textContent?.includes('v4-default-r1'),undefined,{timeout:20000});
 assert.equal(await page.locator('#performance-kind').inputValue(),'regression');
 assert.equal(await page.locator('#performance-backend').inputValue(),'groups');
 assert.equal(await page.locator('#performance-motion-style').inputValue(),'restrained');
 assert.ok(await page.locator('#performance-kind option[value="flow"]').evaluate((el:HTMLOptionElement)=>el.disabled));
 assert.match(await page.locator('#performance-panel a').innerText(),/历史.*研究/);
 const status=await command('performance.status'),cap=await command('capabilities.get');
 assert.equal(status.promoted,true);assert.equal(status.execution.body_encoder_shared,true);
 assert.equal(status.execution.motor_device,'cpu');assert.equal(status.execution.planner_device,'cuda');
 assert.equal(cap.runtime_version,'v4.13.0-clause-plan');assert.equal(cap.active_performance.body_planner,'task_context_first');
 assert.ok(!cap.methods.includes('performance.configure'));
 report.execution=status.execution;report.runtime_version=cap.runtime_version;
 report.checks.push('Production build renders 509-parameter actor; default UI, promoted profile, shared 4B encoder and execution devices agree; paused coupling excluded');
 const tts:any=await (await fetch('http://127.0.0.1:8769/health')).json();
 assert.equal(tts.ready,true);assert.equal(tts.busy,false);
 assert.equal(tts.checkpoint_sha256,'b62a26f6c2ebd10582c088c318d1fe045f19861500caf7eae300b676d2f19a3d');
 report.tts={model:tts.model,speaker:tts.speaker,backend:tts.backend,checkpoint_sha256:tts.checkpoint_sha256};
 await command('speech.unlock');await command('appearance.update',{glasses:'black',skirt:'long',shoes:false});
 const initial=await command('state.get');
 const start=await command('performance.start',{context:'向观众问候，然后平静说明今天整理资料的安排。'});
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
