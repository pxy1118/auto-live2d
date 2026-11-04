import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8767',out=join(root,'test-results/v4');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript('window.__name = target => target;');const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const kind=process.env.KIND??'regression';
const report:any={ok:false,base,kind,checked:[],trace:[],errors},suffix=process.env.REPORT_SUFFIX?'-'+process.env.REPORT_SUFFIX:'';
async function command(method:string,params:any={},id?:string){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,...(id?{request_id:id}:{})})});const d:any=await r.json();if(!r.ok)throw new Error(JSON.stringify(d));return d.result;}
const finite=(s:any)=>Object.values(s.values).every(Number.isFinite);
try{
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await command('speech.unlock');assert.equal((await command('performance.status')).ready,true);report.runtime_version=(await command('capabilities.get')).runtime_version;
 await command('appearance.update',{glasses:'black',skirt:'short'});const before=await command('state.get');
 const start=await command('performance.start',{kind,context:'角色和观众交谈，情绪明显但有节制。'});const sid=start.session_id;
 const first={session_id:sid,seq:0,text:'别再这样捉弄我了，我真的有点生气。'};
 const duplicateId=crypto.randomUUID();assert.deepEqual(await command('performance.append',first,duplicateId),await command('performance.append',first,duplicateId));
 await command('performance.direct',{session_id:sid,emotion:'angry',intensity:.85,hold_ms:4000});
 await command('performance.direct',{session_id:sid,clause:1,expression:'><',emotion:'shy',intensity:.7,hold_ms:3000});
 await command('performance.finish',{session_id:sid,seq:1,text:'但是你突然这样夸我，我又有点不好意思了。'});
 let paused=false,eye=false,black=false;const begun=Date.now();
 while(Date.now()-begun<90000){
  const s=await command('state.get'),p=await command('performance.state');assert.ok(finite(s));assert.equal(s.values.key11,1);assert.equal(s.values.Clothes1,1);
  report.trace.push({wall_ms:Date.now()-begun,media_ms:p.media_ms,clause:p.clause,queue:p.queue,black:s.values.key1,shy:s.values.key7,eye:s.values.key5,arm:s.values.Param36,background:s.background_time_ms});
  black||=s.values.key1>.7;eye||=s.values.key5>.5;
  if(!paused&&p.media_ms>500){await command('engine.pause',{paused:true});const a=await command('performance.state');await sleep(350);const b=await command('performance.state');assert.equal(a.media_ms,b.media_ms);assert.equal(a.actor_ms,b.actor_ms);await command('engine.pause',{paused:false});paused=true;}
  if(p.queue.error)throw new Error(p.queue.error);if(p.queue.phase==='finished')break;await sleep(120);
 }
 let state=await command('performance.state');assert.equal(state.queue.phase,'finished');assert.ok(black&&eye);assert.ok(state.media_ms>5000);assert.ok((await command('state.get')).background_time_ms>before.background_time_ms);
 assert.ok(state.gesture_policy.count<=2,'emotion must not cause continuous hand gestures');
 report.checked.push('real two-clause TTS and v4 inference; director anger and future-clause ><; pause/resume; appearance held; no background reset; sparse gestures; duplicate append');
 await command('performance.cancel',{session_id:sid});await assert.rejects(command('performance.append',{session_id:sid,seq:2,text:'迟到。'}));
 const cancelled=await command('state.get');assert.equal(cancelled.speech.active,false);assert.equal(cancelled.values.key11,1);
 report.checked.push('cancel stops audio and rejects late input, retains appearance');
 await command('engine.reset');await command('appearance.update',{glasses:'black',skirt:'short'});
 const wave=await command('performance.start',{kind,context:'直播开始，配合一次自然挥手问候。'});
 await command('performance.direct',{session_id:wave.session_id,gesture_hint:'向观众挥一次手，然后放下',intensity:1,hold_ms:4000});
 await command('performance.finish',{session_id:wave.session_id,seq:0,text:'大家好呀。我们接着聊。'});
 let waveMax=0,handY=-1,wristMin=1,wristMax=-1,tail=false,waveDone:any;const waveStart=Date.now();
 while(Date.now()-waveStart<30000){const s=await command('state.get',{hand_landmarks:true}),p=await command('performance.state');waveMax=Math.max(waveMax,s.values.Param36);wristMin=Math.min(wristMin,s.values.Param42);wristMax=Math.max(wristMax,s.values.Param42);if((s.hand_landmarks?.right?.y??-1)>handY){handY=s.hand_landmarks.right.y;await page.locator('#stage').screenshot({path:join(out,'native-live-wave-peak.png')});}tail||=p.motion_ms>p.media_ms+100;if(p.queue.error)throw new Error(p.queue.error);if(p.queue.phase==='finished'){waveDone=p;break;}await sleep(40);}
 report.explicit_gesture={maximum_upper_arm:waveMax,visible_hand_y:handY,wrist_range:wristMax-wristMin,tail_clock_used:tail,count:waveDone?.gesture_policy.count};
 assert.ok(handY>.35&&handY<.65,`greeting palm must stay beside the face, below an overhead reach: ${handY}`);assert.ok(waveMax<.4,'greeting must use a bent elbow instead of a high straight arm');assert.ok(wristMax-wristMin>.25,`wave requires wrist movement: ${wristMax-wristMin}`);assert.ok(tail,'short speech must allow a gesture tail');assert.equal(waveDone.gesture_policy.count,1);await sleep(800);assert.ok(Math.abs((await command('state.get')).values.Param36)<.04,'arm must return after a complete gesture');
 await command('performance.cancel',{session_id:wave.session_id});
 report.checked.push('learned semantic intent selects one bent-elbow face-side wave, with wrist movement and return to rest');
 const duration=Number(process.env.STRESS_SECONDS??600)*1000;
 const stress=await command('performance.start',{kind,context:'日常直播聊天，自然地说明、回应和表达情绪。'});let seq=0;const stressStart=Date.now();let added=-1;
 const lines=['大家先坐好，我们慢慢聊。','你说的这件事，我还想再解释一下。','谢谢你这样夸我，我有点不好意思。','等等，这件事真的让我生气了。','我没有生气，只是在复述他说的话。','太好了，我们终于一起做到了！','你刚刚说的是什么意思，让我想一想。'];
 while(Date.now()-stressStart<duration){
  const p=await command('performance.state');if(p.queue.error)throw new Error(p.queue.error);
  const turn=Math.floor((Date.now()-stressStart)/18000);
  if(turn!==added){await command('performance.append',{session_id:stress.session_id,seq:seq++,text:lines[turn%lines.length]});added=turn;if(turn%4===1)await command('performance.direct',{emotion:'shy',intensity:.3+(turn%3)*.25,hold_ms:2000});}
  const s=await command('state.get');assert.ok(finite(s));assert.equal(s.values.key11,1);
  if(report.trace.length%20===0)writeFileSync(join(out,'continuity-progress.json'),JSON.stringify({elapsed_ms:Date.now()-stressStart,media_ms:p.media_ms,phase:p.queue.phase,metrics:p.queue.metrics}));
  report.trace.push({stress_wall_ms:Date.now()-stressStart,media_ms:p.media_ms,actor_ms:p.actor_ms,clause:p.clause,face:p.expressions,arm:s.values.Param36});await sleep(500);
 }
 await command('performance.finish',{session_id:stress.session_id,seq:seq++});
 const finish=(await command('performance.state'));report.stress={wall_ms:Date.now()-stressStart,clauses:finish.clause+1,gesture_policy:finish.gesture_policy,metrics:finish.queue.metrics};
 await command('performance.cancel',{session_id:stress.session_id});
 report.checked.push(`${Math.round(duration/1000)} second continuous session with speech, long pauses and emotion changes`);
 await page.screenshot({path:join(out,'performance-desktop.png'),fullPage:true});assert.deepEqual(errors,[]);report.ok=true;
}finally{writeFileSync(join(out,`browser-verification${suffix}.json`),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,checked:report.checked,stress:report.stress?{wall_ms:report.stress.wall_ms,clauses:report.stress.clauses,gesture_policy:report.stress.gesture_policy}:undefined},null,2));
