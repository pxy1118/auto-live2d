/** Actual native model deformation, finite body acting and Qwen speech. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,createWriteStream,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import bindings from '../contracts/emotion-bindings.json';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';
const root=join(import.meta.dirname,'..'),out=join(root,process.env.LIVE2D_ACTING_OUT??'test-results/emotion-acting'),base='http://127.0.0.1:8775';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
mkdirSync(out,{recursive:true});const report:any={ok:false,errors:[],profiles:[],winks:[],speech:[]};
const log=createWriteStream(join(out,'server.log'));
const child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775',LIVE2D_REVIEW_ROOT:join(out,'isolated-reviews')},stdio:['ignore','pipe','pipe'],windowsHide:true});
child.stdout.pipe(log);child.stderr.pipe(log);let browser:any;
async function command(method:string,params:any={}){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const data:any=await r.json();assert.equal(r.status,200,method+JSON.stringify(data));return data.result;}
try{
 for(let i=0;i<100;i++){try{const h:any=await(await fetch(base+'/api/health')).json();if(h.process_id===child.pid)break;}catch{}await sleep(100);}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1365,height:1050}});await page.addInitScript('window.__name=target=>target;');page.on('pageerror',(e:any)=>report.errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 const caps=await command('capabilities.get');assert.equal(caps.runtime_version,PERFORMANCE_RUNTIME_VERSION);
 assert.equal(await page.locator('.performance-settings').evaluate((e:HTMLDetailsElement)=>e.open),false);
 await page.locator('.performance-settings summary').click();await page.selectOption('#acting-choice','love');await page.click('#acting-preview');await sleep(1000);
 assert.equal((await command('performance.state')).body_action.name,'cajole');await page.locator('#stage').screenshot({path:join(out,'love-body.png')});await page.click('#acting-release');await sleep(750);
 await page.evaluate(()=>(window as any).live2dDemo.engine.command({method:'behavior.set',params:{blink:false}}));
 for(const [label,b] of Object.entries(bindings.bindings)){
  await command('performance.direct',{cue_id:'profile',emotion:label,action_id:'none',intensity:1,hold_ms:4000});await sleep(1450);
  const s=await command('state.get'),p=await command('performance.state');assert.ok(Object.values(s.values).every(Number.isFinite));assert.equal(p.expression.eye,'normal');
  for(const id of ['ParamEyeLOpen','ParamEyeROpen'])assert.ok(s.values[id]>=0&&s.values[id]<=1.5);
  assert.ok([0,1].includes(s.values.key1),'black shading is a drawing switch');
  if(['sadness','grief','disappointment','remorse'].includes(label))assert.ok(s.values.ParamEyeBallY<-.55,label+' must actually look downward');
  if(['sadness','grief'].includes(label)){assert.ok(s.values.ParamEyeLOpen<.5);assert.ok(s.values.key2>.9,'tear drawing visible');}
  if(label==='embarrassment'){assert.ok(s.values.ParamEyeBallX<-.5);assert.ok(s.values.key7>.9,'blush visible');}
  if(label==='curiosity')assert.ok(s.values.ParamEyeLOpen>1.4&&Math.abs(s.values.ParamEyeBallX)<.1,'open eyes looking ahead');
  await page.locator('#stage').screenshot({path:join(out,label+'.png')});report.profiles.push({label,title:b.title,values:s.values,expression:p.expression});
 }
 await command('performance.release',{cue_id:'profile'});await sleep(700);
 for(const side of ['left','right']){
  await command('performance.direct',{cue_id:'wink',expression:'wink_'+side,intensity:1,hold_ms:3000});
  let caught=false;const start=Date.now(),samples=[];
  while(Date.now()-start<1400){
   const s=await command('state.get'),p=s.performance;const closed=s.values[side==='left'?'ParamEyeLOpen':'ParamEyeROpen'],other=s.values[side==='left'?'ParamEyeROpen':'ParamEyeLOpen'];
   samples.push({closed,other,accent:p.expression.accent});
   if(!caught&&closed<.08&&other>.7){
    await command('engine.pause',{paused:true});await sleep(40);const a=await command('performance.state');await sleep(200);assert.deepEqual((await command('performance.state')).expression,a.expression);
    await page.locator('#stage').screenshot({path:join(out,'wink-'+side+'.png')});await command('engine.pause',{paused:false});caught=true;
   }await sleep(15);
  }
  assert.ok(caught,side+' eye must close independently on the actual model');assert.equal((await command('performance.state')).expression.accent,null);report.winks.push({side,samples});await command('performance.release',{cue_id:'wink'});await sleep(600);
 }
 await command('performance.direct',{cue_id:'cajole',emotion:'love',intensity:1,hold_ms:6000});
 const motion=[];const start=Date.now();while(Date.now()-start<4400){const s=await command('state.get');assert.equal(s.performance.motion_actions.active,false);motion.push({x:s.values.PositionX,z:s.values.PositionZ,lean:s.values.LeanInput,body:s.performance.body_action});await sleep(40);}
 assert.ok(Math.max(...motion.map(s=>s.x))-Math.min(...motion.map(s=>s.x))>5);assert.equal(motion.at(-1)!.body.active,false);report.cajole=motion;await command('performance.release',{cue_id:'cajole'});
 // Real GPU path: one audio unit across commas; check mouth changes while
 // a geometric expression is active, and cancel/recovery.
 await page.waitForFunction(()=>!(document.querySelector('#performance-play') as HTMLButtonElement).disabled,{timeout:300000});
 await page.evaluate(()=>(window as any).live2dDemo.engine.command({method:'speech.unlock'}));
 const started=await command('performance.start'),sid=started.session_id;
 await command('performance.finish',{session_id:sid,seq:0,text:'你终于回来啦，我今天真的很想你。再陪我聊一会儿，好不好呀？'});
 let directed=false,done:any;const begin=Date.now();
 while(Date.now()-begin<60000){const s=await command('state.get'),p=await command('performance.state');if(p.queue?.error)throw Error(p.queue.error);
  if(s.speech.phase==='playing'){
   if(!directed){await command('performance.direct',{emotion:'love',cue_id:'speech-love',hold_ms:5000,intensity:.9});directed=true;}
   report.speech.push({audio:s.speech.audio_time_ms,mouth:s.values.ParamMouthOpenY,eyeL:s.values.ParamEyeLOpen,eyeR:s.values.ParamEyeROpen,body:p.body_action,expression:p.expression});
  }
  if(p.queue?.phase==='finished'&&!s.speech.active){done=p;break;}await sleep(45);
 }
 assert.ok(done&&directed);assert.ok(Math.max(...report.speech.map(s=>s.mouth))-Math.min(...report.speech.map(s=>s.mouth))>.15);report.metrics=done.queue.metrics;report.plan_history=done.plan_history;
 assert.equal(done.queue.metrics.filter((row:any)=>row.continuous_utterance).length,1);
 await command('performance.cancel',{session_id:sid});await sleep(800);await page.screenshot({path:join(out,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(out,'mobile.png'),fullPage:true});
 const gallery=await browser.newPage({viewport:{width:1200,height:1060}});const cases=['neutral','sadness','remorse','curiosity','wink-left','wink-right','love-body','embarrassment'];
 const {readFileSync}=await import('node:fs');await gallery.setContent('<style>body{margin:0;background:#f4f6ef;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px}figure{margin:0;background:white}img{width:100%;height:465px;object-fit:cover}figcaption{text-align:center;padding:8px}</style><main>'+cases.map(name=>'<figure><img src="data:image/png;base64,'+readFileSync(join(out,name+'.png')).toString('base64')+'"><figcaption>'+name+'</figcaption></figure>').join('')+'</main>');await gallery.screenshot({path:join(out,'gallery.png'),fullPage:true});
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.error=String(e);throw e;}finally{await browser?.close();child.kill();log.end();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,profiles:report.profiles.length,winks:report.winks.length,speech_frames:report.speech.length,metrics:report.metrics}));
