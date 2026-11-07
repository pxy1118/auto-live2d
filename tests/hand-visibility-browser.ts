/** Native drawable visibility, including weak gestures and transition frames. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
const root=join(import.meta.dirname,'..'),out=join(root,process.env.LIVE2D_HAND_OUT??'test-results/hand-ghost/after');mkdirSync(out,{recursive:true});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const log=createWriteStream(join(out,'server.log')),child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775',LIVE2D_REVIEW_ROOT:join(out,'isolated-reviews')},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log);child.stderr.pipe(log);let browser:any;
const report:any={ok:false,errors:[],cases:[],replacement:null,visibility_checks:0};
try{
 for(let i=0;i<100;i++){try{const h:any=await(await fetch('http://127.0.0.1:8775/api/health')).json();if(h.process_id===child.pid)break;}catch{}await sleep(100);}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1365,height:1050}});await page.addInitScript('window.__name=target=>target;');page.on('pageerror',(e:any)=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:8775');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 // Skin/arm drawings are grouped by the model's part hierarchy, never by UI
 // state. Shadows can have authored fractional alpha; group maxima must be opaque.
 await page.evaluate(()=>{
  const e=(window as any).live2dDemo.engine,m=e._model,parents=m.getPartParentPartIndices();
  const groups:Record<string,number[]>={right:[],left:[],point:[],chest:[],grass:[]};
  const ids={right:'Part130',left:'Part131',point:'Part54',chest:'Part52',grass:'Part44'};
  for(let i=0;i<m.getDrawableCount();i++){
   const path=[];let p=m.getDrawableParentPartIndex(i);for(let j=0;j<20&&p>=0;j++){path.push(e.partIds[p]);p=parents[p];}
   for(const [group,id] of Object.entries(ids))if(path.includes(id))groups[group].push(i);
  }
  (window as any).handProbe=()=>{
   const values=e.control.state(true).values,switches={Movement1:values.Movement1,Movement2:values.Movement2,Movement3:values.Movement3};
   const alpha=Object.fromEntries(Object.entries(groups).map(([g,indices])=>[g,Math.max(...indices.map(i=>m.getDrawableOpacity(i)))]));
   const violations=[];
   for(const [k,v] of Object.entries(switches))if(v!==0&&v!==1)violations.push(k+'='+v);
   if(switches.Movement1+switches.Movement3>1)violations.push('competing right hand drawings');
   const expected={right:1-switches.Movement1-switches.Movement3,left:1-switches.Movement2,point:switches.Movement3,chest:switches.Movement2,grass:switches.Movement1};
   for(const [g,v] of Object.entries(expected))if(Math.abs(alpha[g]-v)>.002)violations.push(g+' alpha='+alpha[g]+' expected='+v);
   return {action:e.performance.state().motion_actions,switches,alpha,violations};
  };
 });
 for(const name of ['wave','chest','grass','point','thanks','explain','refuse'])for(let variant=0;variant<3;variant++)for(const strength of [1,.7,.35]){
  const row=await page.evaluate(async ({name,variant,strength})=>{
   const e=(window as any).live2dDemo.engine;await e.command({method:'engine.reset',params:{paused:true}});
   await e.command({method:'performance.direct',params:{action_id:name,variant,action_strength:strength,action_hold_ms:1400,hold_ms:8000}});
   const samples=[];for(let frame=0;frame<290;frame+=3){await e.command({method:'engine.step',params:{frames:3}});const s=(window as any).handProbe();samples.push({frame:frame+3,...s});}
   return {name,variant,strength,samples};
  },{name,variant,strength});
  for(const sample of row.samples){assert.deepEqual(sample.violations,[],name+'/'+variant+'/'+strength+' frame '+sample.frame+': '+sample.violations);report.visibility_checks++;}
  assert.equal(row.samples.at(-1).action.active,false,'finite native action must recover');report.cases.push(row);
 }
 // Pause at each same 2-second pose used in the pre-fix screenshots.
 for(const name of ['wave','point','chest','thanks','grass','explain','refuse']){
  const variant=['explain','refuse'].includes(name)?1:0;
  await page.evaluate(async ({name,variant})=>{const e=(window as any).live2dDemo.engine;await e.command({method:'engine.reset',params:{paused:true}});await e.command({method:'performance.direct',params:{action_id:name,variant,action_strength:.7,action_hold_ms:1800,hold_ms:7000}});await e.command({method:'engine.step',params:{frames:120}});},{name,variant});
  await page.locator('#stage').screenshot({path:join(out,name+'-'+variant+'-0.7.png')});
 }
 report.replacement=await page.evaluate(async()=>{
  const e=(window as any).live2dDemo.engine,samples=[];await e.command({method:'engine.reset',params:{paused:true}});
  for(const [name,strength,frames] of [['chest',.35,90],['wave',.7,95],['point',.35,95],['grass',.7,300]] as const){
   await e.command({method:'performance.direct',params:{cue_id:'replace',action_id:name,action_strength:strength,action_hold_ms:1400,hold_ms:7000}});
   for(let f=0;f<frames;f+=3){await e.command({method:'engine.step',params:{frames:3}});samples.push((window as any).handProbe());}
  }
  await e.command({method:'performance.release',params:{}});
  for(let f=0;f<180;f+=3){await e.command({method:'engine.step',params:{frames:3}});samples.push((window as any).handProbe());}
  return samples;
 });
 for(const s of report.replacement){assert.deepEqual(s.violations,[]);report.visibility_checks++;}assert.equal(report.replacement.at(-1).action.active,false);
 // Internal native-motion and manual parameter routes use the same guard.
 report.native=await page.evaluate(async()=>{
  const e=(window as any).live2dDemo.engine,samples=[];
  for(const name of ['默认手切举手','举手切默认手','狗尾草切换出来','狗尾草切回默认手','竖手指切出来动画','竖手指切回默认']){
   await e.command({method:'engine.reset',params:{paused:true}});await e.command({method:'motions.play',params:{name,hold:true}});
   for(let f=0;f<85;f++){await e.command({method:'engine.step',params:{frames:1}});samples.push({name,frame:f,...(window as any).handProbe()});}
  }
  return samples;
 });
 for(const s of report.native){assert.deepEqual(s.violations,[],s.name+': '+s.violations);report.visibility_checks++;}
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.error=String(e);throw e;}finally{await browser?.close();child.kill();log.end();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,cases:report.cases.length,visibility_checks:report.visibility_checks,checks:['native drawables remain opaque','exclusive hand drawings','3 variants x 3 strengths x 7 gestures','enter hold exit blend','manual replacement and cancel','native motion paths']}));
