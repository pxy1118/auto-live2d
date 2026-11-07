/** Render feedback recipes on the actual Cubism model, including body-only
 * gestures, native contact poses, bilateral blink and finite recovery. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream,mkdirSync,writeFileSync,renameSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
const root=join(import.meta.dirname,'..'),out=join(root,'test-results/acting-feedback-r3'),base='http://127.0.0.1:8775';mkdirSync(out,{recursive:true});
const resumeVideo=process.argv.includes('--video-only'),transitionOnly=process.argv.includes('--transition-only'),resume=resumeVideo||transitionOnly;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms)),report:any=resume?JSON.parse(readFileSync(join(out,'report.json'),'utf8')):{ok:false,cases:[],errors:[],visibility_checks:0};
if(resume){assert.equal(report.cases.length,16);assert.equal(report.visibility_checks,1920);assert.deepEqual(report.errors,[]);}
const log=createWriteStream(join(out,'server.log')),server=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775',LIVE2D_REVIEW_ROOT:join(out,'isolated-reviews')},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.pipe(log);server.stderr.pipe(log);let browser:any;
try{
 for(let i=0;i<100;i++){try{const h:any=await(await fetch(base+'/api/health')).json();if(h.process_id===server.pid)break;}catch{}await sleep(100);}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1365,height:1050}});await page.addInitScript('window.__name=target=>target;');page.on('pageerror',(e:any)=>report.errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});await page.click('#portrait-view');
 await page.evaluate(()=>{
  const e=(window as any).live2dDemo.engine,m=e._model,parents=m.getPartParentPartIndices(),groups:Record<string,number[]>={};
  for(const id of ['Part130','Part131','Part54','Part52','Part44']){groups[id]=[];for(let i=0;i<m.getDrawableCount();i++){let p=m.getDrawableParentPartIndex(i);for(let j=0;j<20&&p>=0;j++){if(e.partIds[p]===id){groups[id].push(i);break;}p=parents[p];}}}
  (window as any).feedbackProbe=()=>{const s=e.control.state(true),p=e.performance.state(),v=s.values,alpha=Object.fromEntries(Object.entries(groups).map(([k,ix])=>[k,Math.max(...ix.map(i=>m.getDrawableOpacity(i)))]));
   const expected={Part130:1-v.Movement1-v.Movement3,Part131:1-v.Movement2,Part54:v.Movement3,Part52:v.Movement2,Part44:v.Movement1};
   const violations=Object.entries(expected).filter(([k,value])=>Math.abs(alpha[k]-value)>.002).map(([k])=>k);
   const vertices=[];for(let i=0;i<m.getDrawableCount();i++)if(m.getDrawableOpacity(i)>.99){const xy=m.getDrawableVertexPositions(i);for(let j=0;j<xy.length;j+=2)vertices.push(xy[j]);}
   return {values:v,expression:p.expression,body:p.body_action,gesture:p.motion_actions,alpha,violations,mesh_x:vertices.reduce((a,b)=>a+b,0)/vertices.length};
  };
 });
 const cases=[...['shake','tremble','proud','cajole'].flatMap(action=>[0,1,2].map(variant=>({action,variant}))),{action:'chest',variant:0},{action:'point',variant:0},{action:'refuse',variant:0},{action:'lean',variant:2}];
 for(const c of resume?[]:cases){
  const row=await page.evaluate(async ({action,variant})=>{const e=(window as any).live2dDemo.engine;
   await e.command({method:'engine.reset',params:{paused:true}});await e.command({method:'behavior.set',params:{blink:false,idle:false}});
   await e.command({method:'performance.direct',params:{action_id:action,variant,action_strength:.85,action_hold_ms:2100,hold_ms:6000}});
   const samples=[];for(let frame=0;frame<360;frame+=3){await e.command({method:'engine.step',params:{frames:3}});samples.push({frame:frame+3,...(window as any).feedbackProbe()});}
   return {action,variant,samples};
  },c);
  for(const s of row.samples){assert.deepEqual(s.violations,[],`${c.action}/${c.variant} ${s.frame}`);assert.ok(Object.values(s.values).every(Number.isFinite));report.visibility_checks++;}
  assert.equal(row.samples.at(-1).body.active||row.samples.at(-1).gesture.active,false,'finite action must recover');
  if(['shake','tremble','proud','cajole','lean'].includes(c.action))for(const s of row.samples)assert.equal(s.values.Movement1+s.values.Movement2+s.values.Movement3,0,'body action leaves hands down');
  if(c.action==='proud'&&c.variant===0||c.action==='cajole'&&c.variant===2){const closed=row.samples.filter((s:any)=>s.expression.accent?.closure>.8);assert.ok(closed.length>=2);assert.ok(closed.every((s:any)=>s.values.ParamEyeLOpen<.25&&s.values.ParamEyeROpen<.25));}
  if(c.action==='proud'&&c.variant===1)assert.ok(row.samples.some((s:any)=>s.values.ParamEyeROpen<.1&&s.values.ParamEyeLOpen>.7));
  if(c.action==='refuse'){const held=row.samples.filter((s:any)=>s.gesture.phase==='hold');assert.ok(Math.max(...held.map((s:any)=>s.values.AngleX))>3);assert.ok(Math.min(...held.map((s:any)=>s.values.AngleX))< -3);assert.ok(held.every((s:any)=>s.values.Movement3===1));}
  if(c.action==='tremble'){const held=row.samples.filter((s:any)=>s.body.phase==='hold');assert.ok(Math.max(...held.map((s:any)=>s.values.PositionX))-Math.min(...held.map((s:any)=>s.values.PositionX))>.5);assert.ok(Math.max(...held.map((s:any)=>s.mesh_x))-Math.min(...held.map((s:any)=>s.mesh_x))>.0001,'actual mesh must move');}
  report.cases.push(row);
  await page.evaluate(async ({action,variant})=>{const e=(window as any).live2dDemo.engine;await e.command({method:'engine.reset',params:{paused:true}});await e.command({method:'behavior.set',params:{blink:false,idle:false}});await e.command({method:'performance.direct',params:{action_id:action,variant,action_strength:.85,action_hold_ms:2100,hold_ms:6000}});await e.command({method:'engine.step',params:{frames:65}});},c);
  await page.locator('#stage').screenshot({path:join(out,`${c.action}-${c.variant}.png`)});
 }
 if(!resumeVideo){
  const thresholds=JSON.parse(readFileSync(join(root,'models/multilingual-emotions-base/thresholds.json'),'utf8'));
  report.model_transition=await page.evaluate(async thresholds=>{
   const e=(window as any).live2dDemo.engine;await e.command({method:'engine.reset',params:{paused:true}});await e.command({method:'behavior.set',params:{blink:false,idle:false}});
   let audio=0;const original=e.speech.info.bind(e.speech),sid='1'.repeat(32),speech='2'.repeat(32),text='先想一下。哦，放心了。';
   e.speech.info=()=>({phase:audio<8000?'playing':'idle',speech_id:speech,audio_time_ms:audio});
   try{
    e.performance.start({session_id:sid},e.control.state(true).values);
    const labels=e.performance.capabilities().emotion_labels;
    e.performance.utterance({session_id:sid,speech_id:speech,text,audio_duration_ms:8000,audio_duration_final:true,clauses:[{clause:0,text:'先想一下。',start_fraction:0},{clause:1,text:'哦，放心了。',start_fraction:.4}],affect_timeline:{schema:'emotion.timeline.v2',labels,thresholds,points:[{text,window_text:text,start:0,end:text.length,start_fraction:0,probabilities:Object.fromEntries(labels.map((l:string)=>[l,l==='neutral'?.9:0]))}]}});
    const samples=[];let offered0=false,offered1=false;
    for(audio=50;audio<=9500;audio+=50){
     await e.command({method:'engine.step',params:{frames:3}});const s=e.performance.state();
     if(s.clause===0&&!offered0||s.clause===1&&!offered1){const clause=s.clause;offered0||=clause===0;offered1||=clause===1;
      e.performance.offerPlan({session_id:sid,speech_id:speech,clause,plan:{schema:'performance.plan.v4',clause,action:{id:clause===0?'proud':'chest',variant:0,strength:.85,hold_ms:clause===0?2600:1400,onset_fraction:clause===0?.7:.12},confidence:{action:1}},input:{source:'controlled_transition_probe'}});
     }
     samples.push({audio_ms:audio,...(window as any).feedbackProbe()});
    }
    return {samples,plans:e.performance.state().plan_history,actions:e.performance.state().action_history};
   }finally{e.speech.info=original;}
  },thresholds);
  const transition=report.model_transition;assert.ok(transition.plans.some((p:any)=>p.reason==='transition'));assert.deepEqual(transition.actions.map((a:any)=>a.name),['proud','chest']);
  for(const s of transition.samples){assert.deepEqual(s.violations,[]);assert.equal(Boolean(s.body.active&&s.gesture.active),false);}
 }
 // A normal-speed clip for reviewing the authored motion, separate from the
 // deterministic stepped measurements above. No user ratings are created.
 if(!transitionOnly){const context=await browser.newContext({viewport:{width:1000,height:1000},recordVideo:{dir:out,size:{width:800,height:800}}});const videoPage=await context.newPage();await videoPage.addInitScript('window.__name=target=>target;');
 await videoPage.goto(base);await videoPage.waitForFunction(()=>(window as any).live2dDemo?.engine?.ready,{timeout:60000});
 await videoPage.addStyleTag({content:'.app-header,.composer,.app-footer,.stage-heading,.stage-footer{display:none!important}.workspace{display:block;padding:0}.stage-shell{border:0;border-radius:0}#stage{height:980px}.sample-caption{position:fixed;top:20px;left:20px;font:24px sans-serif;z-index:10;color:#345344}'});
 await videoPage.evaluate(()=>{const el=document.createElement('div');el.className='sample-caption';document.body.append(el);(window as any).live2dDemo.engine.framing='portrait';});
 for(const [action,variant,label] of [['shake',0,'反对 · 摇头'],['tremble',1,'紧张 · 轻颤'],['cajole',2,'撒娇 · 眨眨眼'],['proud',0,'得意 · 前倾邀功'],['proud',1,'得意 · 后仰昂首'],['chest',0,'释然 · 抚胸']] as const){
  await videoPage.evaluate(async ({action,variant,label})=>{const e=(window as any).live2dDemo.engine;document.querySelector('.sample-caption')!.textContent=label;await e.command({method:'engine.reset',params:{paused:false}});await e.command({method:'performance.direct',params:{action_id:action,variant,action_strength:.85,action_hold_ms:2100,hold_ms:5000}});},{action,variant,label});await sleep(4300);
 }
 const video=videoPage.video();await context.close();renameSync(await video.path(),join(out,'acting-examples.webm'));report.video='acting-examples.webm';}
 assert.deepEqual(report.errors,[]);delete report.error;report.ok=true;
}catch(error){report.error=String(error);throw error;}finally{await browser?.close();server.kill();log.end();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,cases:report.cases.length,visibility_checks:report.visibility_checks,video:report.video}));
