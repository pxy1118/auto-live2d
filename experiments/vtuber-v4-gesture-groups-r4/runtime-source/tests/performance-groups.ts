import assert from 'node:assert/strict';import {chromium} from 'playwright';import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8777',out=join(root,'test-results/v4-groups-r4');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1440,height:1050}});await page.addInitScript('window.__name = target => target;');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms)),checked:string[]=[],trace:any[]=[];
async function cmd(method:string,params:any={},status=200){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});const d:any=await r.json();assert.equal(r.status,status,JSON.stringify(d));const s=d.result;if(method==='state.get'&&s?.performance?.motion_actions?.active){const v=s.values,right=Math.max(...['Param36','Param39','Param41','Movement1','Movement3'].map(k=>Math.abs(v[k]))),left=Math.max(...['Param62','Param59','Param60','Movement2'].map(k=>Math.abs(v[k])));assert.ok(!(right>.05&&left>.05),'two raised arms during live entry, hold, exit or handoff');}return s;}
async function waitFor(check:(s:any)=>boolean,ms=10000){const at=Date.now();while(Date.now()-at<ms){const s=await cmd('state.get');trace.push({media:s.performance.media_ms,audio:s.speech.audio_time_ms,phase:s.speech.phase,action:s.performance.motion_actions,m1:s.values.Movement1,m2:s.values.Movement2,m3:s.values.Movement3});if(check(s))return s;await sleep(40);}throw new Error('Action condition timed out');}
try{
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});await cmd('speech.unlock');await cmd('appearance.update',{glasses:'black'});
 const capabilities=await cmd('capabilities.get');assert.equal(capabilities.action_groups.length,7);assert.ok(capabilities.action_groups.every((g:any)=>g.available&&g.arm_policy==='single_primary'));assert.ok(!capabilities.action_groups.some((g:any)=>g.name==='cheer'));await cmd('performance.direct',{gesture:'cheer'},400);
 const start=await cmd('performance.start',{motion_backend:'groups'}),sid=start.session_id,voice='e'.repeat(32);
 const clip=JSON.parse(readFileSync(join(root,'datasets/vtuber-v4-native/clips/body-chest-05-v3.json'),'utf8')),audio=JSON.parse(readFileSync(join(root,'datasets/vtuber-v4-native',clip.audio.replace('.wav','.json')),'utf8'));
 const wav=readFileSync(join(root,'datasets/vtuber-v4-native',clip.audio));let offset=12,pcm:Buffer|undefined,sr=24000;
 while(offset+8<=wav.length){const key=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4);if(key==='fmt ')sr=wav.readUInt32LE(offset+12);if(key==='data')pcm=wav.subarray(offset+8,offset+8+size);offset+=8+size+(size%2);}
 assert.ok(pcm);const samples=pcm!.length/2;await cmd('speech.stream.begin',{performance_session_id:sid,speech_id:voice,estimated_duration_ms:audio.duration_ms*16});await cmd('performance.segment',{session_id:sid,clause:0,text:'模拟上层工具调用期间持续播放真实音频',speech_id:voice});
 let chunkIndex=0,streamSamples=0;
 for(let i=0;i<16;i++)for(let from=0;from<samples;from+=sr){
  const count=Math.min(sr,samples-from),duration_ms=count/sr*1000,frames=Math.ceil(duration_ms/1000*60)+1;
  const mouth:any={hz:60,duration_ms};
  for(const key of ['values','energy','beats'])if(audio.features[key])mouth[key]=Array.from({length:frames},(_,j)=>audio.features[key][Math.min(audio.features[key].length-1,Math.round(from/sr*60)+j)]);
  await cmd('speech.stream.append',{speech_id:voice,index:chunkIndex++,sample_rate:sr,offset_samples:streamSamples,samples:count,pcm16_base64:pcm!.subarray(from*2,(from+count)*2).toString('base64'),mouth});streamSamples+=count;
 }
 await cmd('speech.stream.finish',{speech_id:voice,total_samples:streamSamples});
 await cmd('performance.direct',{session_id:sid,gesture:'chest',gesture_hold_ms:900,variant:0});
 const chest=await waitFor(s=>s.values.Movement2>.99&&s.values.Param60>.8);assert.equal(chest.speech.active,true);assert.equal(chest.values.key11,1);await page.locator('#stage').screenshot({path:join(out,'chest-speaking.png')});checked.push('native frontal chest pose during real PCM playback; appearance preserved');
 await cmd('performance.direct',{session_id:sid,gesture:'grass',gesture_hold_ms:1800,variant:0});const grass=await waitFor(s=>s.performance.motion_actions.name==='grass'&&s.values.Movement1>.99&&s.values.Param41<-.65);assert.equal(grass.speech.active,true);assert.ok(grass.performance.media_ms>chest.performance.media_ms);assert.ok(grass.values.Movement2<.01);await page.locator('#stage').screenshot({path:join(out,'grass-speaking.png')});
 await cmd('engine.pause',{paused:true});const a=await cmd('performance.state');await sleep(250);const b=await cmd('performance.state');assert.equal(a.media_ms,b.media_ms);assert.equal(a.motion_actions.elapsed_ms,b.motion_actions.elapsed_ms);await cmd('engine.pause',{paused:false});checked.push('native grass replaces chest after exit; voice continues; actual audio clock pauses the coordinated group');
 const before=await cmd('speech.status');await cmd('performance.release');await waitFor(s=>!s.performance.motion_actions.active);const after=await cmd('speech.status');assert.equal(after.active,true);assert.ok(after.audio_time_ms>before.audio_time_ms);assert.ok((await cmd('state.get')).values.Movement1<.01);checked.push('release returns hand and prop without interrupting speech or replaying a prior group');
 await cmd('performance.direct',{gesture:'point',variant:0,gesture_hold_ms:600});const reference=await waitFor(s=>s.performance.motion_actions.name==='point'&&s.performance.motion_actions.phase==='hold');await waitFor(s=>!s.performance.motion_actions.active);
 const acting:any[]=[];
 for(let variant=0;variant<3;variant++){
  const gesture='wave';await cmd('performance.direct',{gesture,variant,gesture_hold_ms:1500});const samples:any[]=[];
  while(true){const s=await cmd('state.get',{hand_landmarks:true});if(!s.performance.motion_actions.active)break;samples.push(s);assert.equal(s.speech.active,true);assert.equal(s.values.key11,1);await sleep(35);}
  const held=samples.filter(s=>s.performance.motion_actions.phase==='hold');assert.ok(held.length>5);
  const range=(id:string)=>Math.max(...held.map(s=>s.values[id]))-Math.min(...held.map(s=>s.values[id]));
  for(const key of ['Param36','Param39','Param41'])assert.ok(held.every(s=>Math.abs(s.values[key]-reference.values[key])<.001),`native point joint ${key}`);
  const hand=Math.max(...held.map(s=>s.hand_landmarks.right.y));assert.ok(hand>.3&&hand<.65,`point-position palm ${hand}`);assert.ok(held.every(s=>s.values.Movement3===0&&s.values.Param60===0));assert.ok(range('Param42')>.25);
  acting.push({gesture,variant,visible_hand_y:hand,wrist_range:range('Param42'),same_point_joints:true,open_palm:true});
 }
 checked.push('all three open-palm wave variants preserve native point shoulder/elbow joints during real audio; wrist movement, open palm, automatic return; retired cheer rejected');
 await cmd('performance.direct',{gesture:'thanks',gesture_hold_ms:1000});await waitFor(s=>s.performance.motion_actions.active&&s.values.Movement2>.9);await cmd('performance.cancel',{session_id:sid});assert.equal((await cmd('speech.status')).active,false);await waitFor(s=>!s.performance.motion_actions.active,5000);const final=await cmd('state.get');assert.equal(final.values.key11,1);assert.ok(final.values.Movement2<.01);checked.push('cancel stops voice; native group exits without getting stuck; appearance retained');
 writeFileSync(join(out,'native-integration.json'),JSON.stringify({ok:true,runtime_version:capabilities.runtime_version,checked,acting,trace},null,2));console.log(JSON.stringify({ok:true,checked,acting}));
}finally{await browser.close();}
