/** Isolated production actor, real GPU workers, and verified gesture resources. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,createWriteStream,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';
const root=join(import.meta.dirname,'..'),out=join(root,process.env.LIVE2D_SMOKE_OUT??'test-results/native28-refactor-r2/smoke'),base='http://127.0.0.1:8775';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({runtime:PERFORMANCE_RUNTIME_VERSION,dist:existsSync(join(root,'dist/index.html'))}));process.exit(0);}
mkdirSync(out,{recursive:true});const report:any={ok:false,errors:[],frames:[],checks:[]};
const log=createWriteStream(join(out,'server.log'));
const child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775',LIVE2D_REVIEW_ROOT:join(out,'isolated-reviews')},stdio:['ignore','pipe','pipe'],windowsHide:true});
child.stdout.pipe(log);child.stderr.pipe(log);let browser:any;
async function command(method:string,params:any={}){const response=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const data:any=await response.json();assert.equal(response.status,200,method+': '+JSON.stringify(data));return data.result;}
try{
 for(let i=0;i<100;i++){try{const h:any=await(await fetch(base+'/api/health')).json();if(h.process_id===child.pid)break;}catch{}await sleep(100);}
 const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));
 browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1365,height:1050}});
 await page.addInitScript('window.__name=target=>target;');page.on('pageerror',(e:any)=>report.errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});await page.waitForFunction(()=>!(document.querySelector('#performance-play') as HTMLButtonElement).disabled);
 const caps=await command('capabilities.get');assert.equal(caps.runtime_version,PERFORMANCE_RUNTIME_VERSION);assert.equal(caps.plan_schema,'performance.plan.v4');assert.equal(caps.action_catalog.actions.length,17);assert.equal(caps.emotion_labels.length,28);
 assert.equal(await page.locator('.performance-settings').evaluate((e:HTMLDetailsElement)=>e.open),false);
 await page.evaluate(()=>(window as any).live2dDemo.engine.command({method:'speech.unlock'}));
 // The asset has no verified palm-facing wave. Greeting keeps hands down and
 // varies a finite head/body beat; supported native hands are tested separately.
 const variants=[];
 for(let variant=0;variant<3;variant++){
  await command('performance.direct',{action_id:'wave',variant,action_strength:1,action_hold_ms:1400,hold_ms:7000,cue_id:'wave'});
  const samples:any[]=[];let bodyRange=0,shot=false;
  const begin=Date.now();
  while(Date.now()-begin<4700){
   const state=await command('state.get',{hand_landmarks:true}),p=await command('performance.state');
   assert.ok(Object.values(state.values).every(Number.isFinite));
   if(p.motion_actions.active&&p.motion_actions.name==='wave'){
    assert.equal(p.motion_actions.active_arm,null);
    for(const key of ['Param36','Param41','Param42','Movement1','Movement2','Movement3'])assert.ok(Math.abs(state.values[key])<.001,key+' greeting leaves hands down');
    bodyRange=Math.max(bodyRange,...['AngleX','AngleY','AngleZ','PositionZ','LeanInput'].map(k=>Math.abs(state.values[k])));
    if(p.motion_actions.phase==='hold'&&!shot){await page.locator('#stage').screenshot({path:join(out,'wave-'+variant+'.png')});shot=true;}
    samples.push({phase:p.motion_actions.phase,palm:state.hand_landmarks,values:{Param42:state.values.Param42,Param36:state.values.Param36,Param62:state.values.Param62}});
   }await sleep(55);
  }
  assert.ok(samples.length>10);assert.ok(bodyRange>2,'greeting still has visible body acting');
  assert.ok(shot);variants.push({variant,body_range:bodyRange,samples});
  await command('performance.release',{cue_id:'wave'});await sleep(2200);
 }
 report.waves=variants;
 // Real speech + live native affect, manual neutral, frozen playback, and cancel.
 const started=await command('performance.start'),sid=started.session_id;
 await command('performance.finish',{session_id:sid,seq:0,text:'大家好呀，今天见到你们真的很开心。谢谢你一直陪着我，我们慢慢把事情说清楚吧。'});
 let paused=false,neutral=false,done:any;
 const begin=Date.now();
 while(Date.now()-begin<60000){
  const state=await command('state.get'),p=await command('performance.state');if(p.queue?.error)throw Error(p.queue.error);
  assert.ok(Object.values(state.values).every(Number.isFinite));report.frames.push({at:Date.now()-begin,speech:state.speech,affect:p.affect,actions:p.action_history});
  if(!paused&&state.speech.phase==='playing'&&state.speech.audio_time_ms>1200){
   await command('engine.pause',{paused:true});await sleep(100);const a=await command('performance.state');await sleep(650);const b=await command('performance.state');
   for(const key of ['actor_ms','action_clock_ms','motion_ms','affect','expression','motion_actions','body_action'])assert.deepEqual(b[key],a[key],key+' paused');
   await command('engine.pause',{paused:false});paused=true;
  }
  if(!neutral&&state.speech.phase==='playing'&&state.speech.audio_time_ms>2200){
   await command('performance.direct',{emotion:'neutral',hold_ms:800,cue_id:'neutral'});await sleep(300);const n=await command('performance.state');assert.equal(n.emotion,'neutral');assert.equal(n.expression.eye,'normal');neutral=true;
  }
  if(p.queue?.phase==='finished'&&!state.speech.active){done=p;break;}await sleep(55);
 }
 assert.ok(done);assert.ok(paused&&neutral);assert.ok(done.plan_history.length>=2);
 for(const row of done.plan_history){assert.equal(row.plan.schema,'performance.plan.v4');assert.equal(row.input.affect.length,64);assert.deepEqual(Object.keys(row.input.planner_state).sort(),['age_ms','last_action','last_variant','phase']);}
 report.plan_history=done.plan_history;report.metrics=done.queue.metrics;
 await command('performance.cancel',{session_id:sid});const cancelled=await command('performance.state');assert.equal(cancelled.affect.intensity,0);
 await command('appearance.update',{glasses:'black'});assert.equal((await command('appearance.get')).glasses,'black');
 await sleep(700);await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(report.errors,[]);report.checks=['17 actions / native28 / v4','3 finite greeting variants with no invalid palm substitution','real speech playback-time history and affect','pause freezes all acting state','neutral overrides eyes and face','cancel and appearance','responsive UI'];report.ok=true;
}catch(error){report.error=String(error);throw error;}finally{
 await browser?.close();child.kill();for(let i=0;i<50&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);log.end();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({ok:report.ok,checks:report.checks}));
