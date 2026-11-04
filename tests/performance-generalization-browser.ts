/** Real automatic two-clause development demos, never final-test or human votes. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=join(import.meta.dirname,'..'),base='http://127.0.0.1:8765',out=join(root,'test-results/v4-generalization'),media=join(root,'datasets/vtuber-v4/review/generalization-r1');
mkdirSync(out,{recursive:true});mkdirSync(join(media,'audio'),{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1200,height:1000}});await page.addInitScript('window.__name=target=>target;');
const scenes=[
 {name:'welcome',title:'迎接回来与继续聊天',context:'熟悉的观众结束晚班回来，你自然地欢迎。',text:'我还以为今天等不到你了呢。今晚想听你说说近况。',arm:'wave'},
 {name:'positive',title:'同一句话 · 真心夸奖',context:'朋友给你准备了细致的手工礼物，你真心夸奖。',text:'你真是让我刮目相看了。这份心意我会好好收着。',emotion:'happy'},
 {name:'irony',title:'同一句话 · 生气反讽',context:'朋友再次失信，你失望而恼火地挖苦。',text:'你真是让我刮目相看了。这件事需要你认真给我一个解释。',emotion:'angry'},
 {name:'cajole',title:'软声请求与情绪延续',context:'你向亲近的人软声讨一口甜点，带撒娇意味。',text:'就让我尝一小块嘛。真的只要一小块就够了。',body:'cajole'},
 {name:'point',title:'强调细节与身体配合',context:'指出观众漏读的文字，是强调重点。',text:'答案其实藏在末尾那句话里。你看最后一行还有半句呢。',arm:'point'},
 {name:'quote',title:'转述他人情绪',context:'正在平静读别人的发言，不代入角色，不表演引号内容。',text:'我只是转述她说的“别再拿我的家人开玩笑”，这不是我的感受。我们继续读下一条留言。',neutral:true},
];
const report:any={ok:false,scope:'development demonstrations, not blind or final-test evidence',scenes:[]};
async function cmd(method:string,params:any={}){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d.result;}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});await cmd('speech.unlock');
 const health=await(await fetch('http://127.0.0.1:8768/health')).json();assert.equal(health.streaming.run.stage,'generalization_research_candidate');report.planner_checkpoint=health.streaming.run.performance_planner.sha256;
 report.runtime_version=(await cmd('capabilities.get')).runtime_version;
 for(let index=0;index<scenes.length;index++){
  const scene=scenes[index];await cmd('engine.reset');
  await page.evaluate(()=>{
   const w=window as any,e=w.live2dDemo.engine;w.__trace=[];w.__pcm=[];w.__audioStarts={};w.__recording=true;w.__begin=performance.now();
   if(!w.__originalCommand){w.__originalCommand=e.command.bind(e);e.command=async(command:any)=>{if(w.__recording&&command.method==='speech.stream.append')w.__pcm.push(structuredClone(command.params));return w.__originalCommand(command);};}
   const tick=()=>{if(!w.__recording)return;const now=performance.now()-w.__begin,s=e.speechState(),p=e.performance.state();
    if(s.phase==='playing'&&w.__audioStarts[s.speech_id]===undefined)w.__audioStarts[s.speech_id]=now-s.audio_time_ms;
    w.__trace.push({at:now,values:[...e.control.lastFinal],media:p.media_ms,clause:p.clause});requestAnimationFrame(tick);};requestAnimationFrame(tick);
  });
  const sid=(await cmd('performance.start',{context:scene.context,motion_style:'natural'})).session_id;await cmd('performance.finish',{session_id:sid,seq:0,text:scene.text});
  let final:any;const start=Date.now();
  while(Date.now()-start<45000){const p=await cmd('performance.state');if(p.queue.error)throw Error(p.queue.error);if(p.queue.phase==='finished'){final=p;break;}await sleep(80);}
  assert.ok(final,scene.name+' did not finish');await sleep(1200);
  const capture=await page.evaluate(()=>{const w=window as any;w.__recording=false;return {trace:w.__trace,pcm:w.__pcm,audioStarts:w.__audioStarts,parameters:w.live2dDemo.engine.control.parameters};});
  assert.ok(capture.pcm.length>0);assert.ok(final.plan_history.length>=2);const plans=final.plan_history.map((e:any)=>e.plan);
  if(scene.arm)assert.ok(final.plan_history.some((e:any)=>e.arm_applied&&e.plan.arm===scene.arm),scene.name+' hand never applied');
  if(scene.body)assert.ok(final.plan_history.some((e:any)=>e.body_applied&&e.plan.body===scene.body),scene.name+' body never applied');
  if(scene.emotion)assert.equal(plans[0].emotion,scene.emotion);
  const ids=capture.parameters.map((p:any)=>p.id),eyeIds=['key5','key3','key4','key6'].map(k=>ids.indexOf(k));
  for(const row of capture.trace){assert.ok(row.values.every(Number.isFinite));assert.ok(eyeIds.every(i=>[0,1].includes(row.values[i])));assert.ok(eyeIds.reduce((n,i)=>n+row.values[i],0)<=1);}
  if(scene.neutral)assert.ok(capture.trace.every((r:any)=>r.values[ids.indexOf('key1')]<.1));
  const trim=Math.max(0,Math.min(...Object.values(capture.audioStarts) as number[])),duration=capture.trace.at(-1).at-trim,frames=Math.ceil(duration*60/1000),values:number[][]=[];let cursor=0;
  for(let f=0;f<frames;f++){const at=trim+f*1000/60;while(cursor+1<capture.trace.length&&capture.trace[cursor+1].at<=at)cursor++;values.push(capture.trace[cursor].values);}
  const pcmById=new Map<string,any[]>();for(const part of capture.pcm){if(!pcmById.has(part.speech_id))pcmById.set(part.speech_id,[]);pcmById.get(part.speech_id)!.push(part);}
  const sampleRate=capture.pcm[0].sample_rate,raw=Buffer.alloc(Math.ceil(frames/60*sampleRate)*2);
  for(const [id,parts] of pcmById){parts.sort((a,b)=>a.index-b.index);const pcm=Buffer.concat(parts.map(p=>Buffer.from(p.pcm16_base64,'base64'))),offset=Math.max(0,Math.round((capture.audioStarts[id]-trim)*sampleRate/1000))*2;assert.ok(Number.isFinite(offset));if(offset<raw.length)pcm.copy(raw,offset,0,Math.min(pcm.length,raw.length-offset));}
  const name=String(index).padStart(2,'0')+'-A',wav=Buffer.alloc(44);wav.write('RIFF');wav.writeUInt32LE(raw.length+36,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(raw.length,40);writeFileSync(join(media,'audio',name+'.wav'),Buffer.concat([wav,raw]));
  const eyeOrder=['key5','key3','key4','key6'],faceKeys=['key1','key2','key7','key8','key9','key13'];
  const params={channels:ids,values,face:values.map(v=>[...faceKeys.map(k=>v[ids.indexOf(k)]),eyeOrder.some(k=>v[ids.indexOf(k)]===1)?1:0]),eye:values.map(v=>eyeOrder.findIndex(k=>v[ids.indexOf(k)]===1)+1),mouth:values.map(v=>v[ids.indexOf('ParamMouthOpenY')]),images:true,hz:60,image_hz:30,verify_hands:true};
  writeFileSync(join(media,name+'.json'),JSON.stringify(params));writeFileSync(join(out,scene.name+'-trace.json'),JSON.stringify({audioStarts:capture.audioStarts,trim,trace:capture.trace,plan_history:final.plan_history,metrics:final.queue.metrics}));
  report.scenes.push({index,...scene,frames,audio_sample_rate:sampleRate,plan_history:final.plan_history,metrics:final.queue.metrics});await page.locator('#stage').screenshot({path:join(out,scene.name+'.png')});await cmd('performance.cancel',{session_id:sid});console.log(JSON.stringify({scene:scene.name,frames,plans:plans.map((p:any)=>({arm:p.arm,body:p.body,emotion:p.emotion}))}));
 }
 const sid=(await cmd('performance.start')).session_id;await cmd('performance.finish',{session_id:sid,seq:0,text:'我想把这个过程仔细讲清楚。'});await sleep(80);await cmd('performance.cancel',{session_id:sid});const count=(await cmd('performance.state')).plan_history.length;await sleep(1300);assert.equal((await cmd('performance.state')).plan_history.length,count);assert.equal((await cmd('speech.status')).active,false);
 report.cancelled_late_results_do_not_replay=true;report.ok=true;
}finally{writeFileSync(join(out,'browser.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,scenes:report.scenes.length}));
