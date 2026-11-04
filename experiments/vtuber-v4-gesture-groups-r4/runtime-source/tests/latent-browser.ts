import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8765';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const experiment=join(root,read(join(root,'latent/default-run.json')).path),run=read(join(experiment,'run.json'));
const examples=read(join(experiment,'predictions.json')),output=existsSync(join(experiment,'FULL-MANIFEST.json'))?join(root,'test-results/latent'):join(experiment,'browser');mkdirSync(output,{recursive:true});
const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe'].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const report:any={base,experiment,started:new Date().toISOString(),cases:[],case_failures:[],checked:[]},errors:string[]=[];
const resident={idle:true,breath:true,blink:true,physicsEnabled:true};
async function request(path:string,body?:any,expected=200){const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;}
async function command(method:string,params:any={}){return(await request('/api/command',{method,params})).result;}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 const status=await request('/api/latent/status'),profile=await request('/api/profile');
 assert.equal(status.ready,true);assert.deepEqual(status.output_shape,[64,16]);assert.equal(status.expression_names.length,17);assert.deepEqual(status.background_behavior,resident);report.status=status;
 await command('engine.reset',{paused:true});await command('parameters.set',{values:{ParamEyeLOpen:1,ParamEyeROpen:1}});
 await command('engine.step',{frames:264});const blink=await command('state.get');
 assert.ok(blink.driver.ParamEyeLOpen<.02);assert.equal(blink.action_driver.ParamEyeLOpen,1);assert.deepEqual(blink.behavior,resident);report.resident_blink={driver:blink.driver.ParamEyeLOpen,semantic:blink.action_driver.ParamEyeLOpen};
 const cases:[string,string,string?,number?][]=[
 ['regression','greeting_calm'],['regression','anger_boundary','key1',.8],['regression','shy_praise','key7',.35],
 ['regression','point_explain','Movement3',.95],['regression','grass_prop','Movement1',.95],['regression','chest_gesture','Movement2',.95],
 ['regression','config_glasses','key11',.95],['regression','config_monocle','key12',.95],['regression','config_bowl','key10',.95],
 ['regression','config_skirt','Clothes1',0],['regression','config_shoes','Clothes4',.95],['regression','config_tail','Clothes5',0],
 ['regression','config_collar','Clothes3',.95],['regression','config_body1','Clothes2',.39],['regression','config_body2','Clothes2',.99],
 ['regression','config_rabbit','key9',.95],['regression','config_heart','key4',.95],['regression','config_smug','key6',.95],
 ['regression','config_sweat','key13',.95],['regression','moved','key2',.95],['regression','confused','key3',.95],
 ['regression','celebrate','key5',.95],['regression','config_lean','LeanInput',0],
 ['regression','config_native'],['flow','anger_boundary','key1',.8]];
 for(const [kind,family,key,minimum] of cases){
  try{
  const sample=examples[kind+'-'+family];assert.ok(sample,'missing '+family);
  const p=await request('/api/latent/predict',{text:sample.text,context:sample.context,style:sample.style,kind});
  assert.equal(p.provenance.checkpoint_sha256,run.models[kind].checkpoint_sha256);
  assert.equal(p.expression_probabilities[0].length,17);
  for(const values of p.values){assert.equal(values.length,16);values.forEach((v:number,i:number)=>assert.ok(Number.isFinite(v)&&v>=profile.channels[i].min&&v<=profile.channels[i].max));}
  const before=await command('state.get');
  await request('/api/latent/execute',{prediction_id:p.prediction_id,paused:true});
  const start=await command('state.get',{geometry:true});assert.deepEqual(start.behavior,resident);assert.equal(start.background_time_ms,before.background_time_ms);
  if(family==='config_native'){assert.equal(p.execution_mode,'native_motion');assert.equal(p.native_motion,'脱捕');assert.equal(p.command.params.duration_ms,13800);assert.ok(!p.command.params.events.some((e:any)=>e.method==='parameters.set'));}
  const trace:any[]=await page.evaluate(({duration,family})=>{
   const e=(window as any).live2dDemo.engine,result:any[]=[];
   e.framing=family.startsWith('config_')?'full':'portrait';
   for(let i=0;i<Math.ceil(duration/100)+3;i++){
    e.dispatch('engine.step',{frames:6});const s=e.dispatch('state.get',{geometry:true});
    result.push({time_ms:s.time_ms,background_time_ms:s.background_time_ms,behavior:s.behavior,values:Object.fromEntries(['key1','key2','key3','key4','key5','key6','key7','key8','key9','key10','key11','key12','key13','LeanInput','Movement1','Movement2','Movement3','Clothes1','Clothes2','Clothes3','Clothes4','Clothes5','ParamBreath','Param32','ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ'].map(k=>[k,s.values[k]])),geometry:s.geometry});
    if(i===(family==='confused'?31:24)){e.draw();result.at(-1).preview=e.canvas.toDataURL('image/png');}
   }return result;
  },{duration:p.command.params.duration_ms,family});
  for(const t of trace)if(t.preview){writeFileSync(join(output,kind+'-'+family+'.png'),Buffer.from(t.preview.split(',')[1],'base64'));delete t.preview;}
  assert.ok(trace.every(t=>Object.values(t.behavior).every(v=>v===true)));
  for(const id of ['ParamBreath','Param32'])assert.ok(Math.max(...trace.map(t=>t.values[id]))-Math.min(...trace.map(t=>t.values[id]))>(id==='ParamBreath'?.1:.001));
  if(key){const v=trace.map(t=>t.values[key]);if(key==='LeanInput')assert.ok(Math.min(...v)<-5);else if(key==='Clothes1'||key==='Clothes5')assert.ok(Math.min(...v)<.05);else assert.ok(Math.max(...v)>minimum!,family+' did not visibly enter '+key+': '+Math.max(...v));}
  if(family==='confused')assert.ok(Math.max(...trace.map(t=>t.values.key8))>.95);
  if(family==='greeting_calm')assert.ok(trace.every(t=>t.values.key7<.01&&t.values.key1<.01&&Math.max(t.values.Movement1,t.values.Movement2,t.values.Movement3)<.03));
  if(family==='anger_boundary')assert.ok(trace.every(t=>t.values.key7<.01));
  if(family==='shy_praise')assert.ok(Math.max(...trace.map(t=>t.values.key7))<=.401);
  if(family!=='config_native')for(const k of ['key1','key7','key10','key11','key12','Movement1','Movement2','Movement3','Clothes2','Clothes3','Clothes4'])assert.ok(Math.abs(trace.at(-1).values[k])<.03,family+' did not restore '+k);
  assert.ok(Math.abs(trace.at(-1).values.Clothes5-1)<.03);
  const meshDelta=Math.max(...trace.map(t=>Math.hypot(t.geometry.weighted_x-start.geometry.weighted_x,t.geometry.weighted_y-start.geometry.weighted_y)));
  assert.ok(meshDelta>1,'rendered mesh must change');
  await request('/api/latent/execute',{prediction_id:p.prediction_id},400);
  report.cases.push({kind,family,timing:p.timing,constraints:p.constraints,execution_mode:p.execution_mode,mesh_delta:meshDelta,trace});
  console.log(JSON.stringify({verified:family,kind,mesh_delta:meshDelta}));
  }catch(e:any){report.case_failures.push({kind,family,error:e.stack});console.log(JSON.stringify({failed:family,error:e.message}));await command('engine.reset',{paused:true});}
 }
 assert.deepEqual(report.case_failures,[],'all neural playback cases must pass');
 report.checked.push('actual neural outputs execute face, hands, clothing, accessories, body presets and full 13.8s native motion through Cubism');
 report.checked.push('all four background behaviors persist, their phase survives pose resets, and open-eye targets retain resident blinking');
 const sample=examples['regression-anger_boundary'];
 await page.locator('#latent-text').fill(sample.text);await page.locator('#latent-context').fill(sample.context);await page.locator('#latent-style').selectOption(sample.style);await page.locator('#latent-predict').click();
 await page.waitForFunction(()=>document.getElementById('latent-details')!.textContent!.includes('prediction_id'),{timeout:60000});
 assert.equal(JSON.parse((await page.locator('#latent-details').textContent())!).expression_names.length,17);
 await page.locator('#latent-execute').click();await page.waitForFunction(()=>document.getElementById('latent-result')!.textContent!.includes('正在播放'));
 await page.screenshot({path:join(output,'console-desktop.png'),fullPage:true});
 const gallery=await browser.newPage({viewport:{width:1280,height:900}});gallery.on('pageerror',e=>errors.push(e.message));
 await gallery.goto(base+'/dataset/vtuber-v3/review/index.html');await gallery.waitForFunction(()=>document.querySelectorAll('.card').length===44);
 await gallery.locator('[data-sheet="config_shoes"]').click();assert.ok(await gallery.locator('dialog').isVisible());await gallery.locator('#close').click();
 await gallery.locator('#variant').selectOption('all');assert.equal(await gallery.locator('.card').count(),200);
 await gallery.locator('#split').selectOption('train');assert.equal(await gallery.locator('.card').count(),176);
 await gallery.locator('#variant').selectOption('representatives');
 assert.ok(await gallery.locator('.picture').first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0));
 await gallery.screenshot({path:join(output,'dataset-desktop.png')});await gallery.setViewportSize({width:390,height:844});assert.ok(await gallery.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await gallery.screenshot({path:join(output,'dataset-mobile.png')});
 report.checked.push('prediction and playback UI; 200-clip/44-family gallery, 176 train filter, storyboards and mobile layout');
 await command('engine.reset');assert.deepEqual(errors,[]);report.ok=true;
}catch(e:any){report.ok=false;report.error=e.stack;throw e;}
finally{report.browser_errors=errors;writeFileSync(join(output,'verification.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({ok:report.ok,checked:report.checked,error:report.error,cases:report.cases.length}));}
