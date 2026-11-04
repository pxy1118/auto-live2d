/** Actual Cubism mapping/micro-expression ablation, genuine 60 fps. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {conditions,generateMappedInputs,AssetInputMapper,mappedOutputs} from '../../research/vtuber-v4-mapping-r1/mapping';
import {gestureArmChannels,gestureFingerChannels} from '../../src/gesture-library';
const root=join(import.meta.dirname,'../..'),study=join(root,'research/vtuber-v4-mapping-r1'),data=join(root,'datasets/vtuber-v4-mapping-r1');
const out=join(root,'test-results/v4-mapping-r1');mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),unpack=(p:string)=>JSON.parse(gunzipSync(readFileSync(p)).toString());
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const preserve=read(join(study,'runtime-before.json')).files,protocol=read(join(study,'protocol.json'));
const settings=read(join(study,'mapping-settings.json')).settings;
for(const [p,h] of Object.entries(preserve))assert.equal(sha(join(root,p)),h,p);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:480,height:720},deviceScaleFactor:1});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[],writes:string[]=[],sockets:string[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});page.on('websocket',s=>{if(new URL(s.url()).pathname==='/ws')sockets.push(s.url());});
const report:any={ok:false,promoted:false,trained:false,human_quality_accepted:false,clips:[],probes:[],video_hz:60,
 protocol_sha256:sha(join(study,'protocol.json')),mapping_settings_sha256:sha(join(study,'mapping-settings.json')),browser_version:browser.version()};
const percentile=(a:number[],q:number)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*q)-1]??0;
try{
 await page.goto('http://127.0.0.1:8775/research/vtuber-v4-prosody-study/render.html');await page.waitForFunction(()=>(window as any).prosodyCapture?.ready,undefined,{timeout:90000});
 const desc=await page.evaluate(async()=>(await (window as any).prosodyCapture.engine.command({method:'model.describe',params:{}})).result);
 assert.equal(desc.asset_hash,read(join(study,'asset-manifest.json')).assetHash);report.asset_hash=desc.asset_hash;
 writeFileSync(join(study,'parameters.json'),JSON.stringify(desc.parameters,null,2));
 const limits=new Map<string,any>(desc.parameters.map((p:any)=>[p.id,p])),defaults=Object.fromEntries(desc.parameters.map((p:any)=>[p.id,p.default]));
 for(const k of mappedOutputs)assert.equal(limits.get(k).physicsOutput,false,`mapped output ${k} conflicts with physics ownership`);
 for(const item of protocol.scenes){
  const scene=read(join(data,item.id,'scene.json')),base=unpack(join(data,item.id,'baseline.json.gz'));
  await page.evaluate(framing=>(window as any).prosodyCapture.engine.framing=framing,scene.framing);
  let neutralReference:number[][]|undefined;
  for(const condition of conditions){
   const id=scene.id+'-'+condition,folder=join(out,id);mkdirSync(folder,{recursive:true});
   const generated=generateMappedInputs(settings,base,scene,condition,defaults),{params}=generated;
   const j=(k:string)=>params.channels.indexOf(k),originalJ=(k:string)=>base.params.channels.indexOf(k);
   for(let f=0;f<params.values.length;f++)for(const k of [...gestureArmChannels,...gestureFingerChannels]){
    const old=originalJ(k)>=0?base.params.values[f][originalJ(k)]:defaults[k];
    assert.equal(params.values[f][j(k)],old,`${id} altered arm/finger ${k}`);
   }
   let outOfRange=0;for(const row of params.values)for(let k=0;k<row.length;k++){const p=limits.get(params.channels[k]);assert.ok(p);if(row[k]<p.min-1e-5||row[k]>p.max+1e-5)outOfRange++;}
   assert.equal(outOfRange,0,id);writeFileSync(join(folder,'input.json.gz'),gzipSync(JSON.stringify(generated)));
   const result=await page.evaluate(async params=>(await (window as any).prosodyCapture.engine.command({method:'performance.capture',params})).result,{...params,images:true});
   assert.equal(result.images.length,generated.frames);assert.equal(result.actual.length,generated.frames);assert.ok(result.actual.every((r:number[])=>r.every(Number.isFinite)));
   const index=(k:string)=>result.parameter_ids.indexOf(k),range=(k:string)=>{const v=result.actual.map((r:number[])=>r[index(k)]);return {min:Math.min(...v),max:Math.max(...v),range:Math.max(...v)-Math.min(...v)};};
   let twoRaised=0;for(const row of result.actual){
    const right=['Param36','Param39','Param41','Movement1','Movement3'].some(k=>Math.abs(row[index(k)]-defaults[k])>.05);
    const left=['Param62','Param59','Param60','Movement2'].some(k=>Math.abs(row[index(k)]-defaults[k])>.05);if(left&&right)twoRaised++;
   }
   assert.equal(twoRaised,0,id);
   for(const k of ['key3','key4','key5','key6'])assert.ok(result.actual.every((r:number[])=>r[index(k)]===0));
   for(const k of ['key10','key11','key12','Clothes1','Clothes2','Clothes3','Clothes4','Clothes5'])assert.ok(result.actual.every((r:number[])=>Math.abs(r[index(k)]-defaults[k])<1e-5),`${id} changed appearance ${k}`);
   if(scene.id==='neutral'){
    if(!neutralReference)neutralReference=result.actual;
    else assert.deepEqual(result.actual,neutralReference,'Neutral clip changed under the new layers');
   }
   for(let f=0;f<result.images.length;f++)writeFileSync(join(folder,String(f).padStart(4,'0')+'.png'),Buffer.from(result.images[f].png,'base64'));
   delete result.images;writeFileSync(join(folder,'actual.json.gz'),gzipSync(JSON.stringify(result)));
   const movement=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ'];const speed:number[]=[],acceleration:number[]=[];
   for(let f=1;f<result.actual.length;f++)for(const k of movement){const col=index(k),span=limits.get(k).max-limits.get(k).min;
    speed.push(Math.abs(result.actual[f][col]-result.actual[f-1][col])*60/span);
    if(f>1)acceleration.push(Math.abs(result.actual[f][col]-2*result.actual[f-1][col]+result.actual[f-2][col])*3600/span);
   }
   const fields=[...mappedOutputs,'LeanInput','ParamEyeLOpen','ParamEyeROpen','ParamBrowLY','ParamBrowRY','ParamMouthForm'];
   const row={id,scene:scene.id,condition,framing:scene.framing,frames:generated.frames,image_hz:60,
    arm_finger_inputs_identical:true,two_raised_arm_samples:twoRaised,out_of_range_inputs:outOfRange,
    special_eyes_normal:true,appearance_unchanged:true,ranges:Object.fromEntries(fields.map(k=>[k,range(k)])),
    body_input_velocity_p95:percentile(speed,.95),body_input_acceleration_p95:percentile(acceleration,.95),
    policy_compute_p95_ms:percentile(generated.computes,.95),
    timing_scope:'Local generation only; not concurrent TTS or end-to-end inference latency.',
    input_sha256:sha(join(folder,'input.json.gz')),recording_sha256:sha(join(folder,'actual.json.gz'))};
   report.clips.push(row);writeFileSync(join(out,'capture-progress.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify({captured:id,frames:generated.frames,framing:scene.framing,arm_unchanged:true,neutral_identical:scene.id==='neutral'}));
  }
 }
 // Actual step readbacks distinguish each axis; torso is not always later than head.
 for(const inputName of ['FaceAngleX','FaceAngleY','FaceAngleZ','EyeRightX','EyeRightY']){
  const m=new AssetInputMapper(settings),amplitude=inputName.startsWith('Eye')?.2:5;
  const values=Array.from({length:180},(_,f)=>{const inputs={FaceAngleX:0,FaceAngleY:0,FaceAngleZ:0,EyeRightX:0,EyeRightY:0};inputs[inputName]=f>=30?amplitude:0;const r=m.step(inputs,f===0?0:1/60);return mappedOutputs.map(k=>r[k]);});
  const result=await page.evaluate(async params=>(await (window as any).prosodyCapture.engine.command({method:'performance.capture',params})).result,{channels:mappedOutputs,values,hz:60,image_hz:60,images:false,full_update:true});
  writeFileSync(join(out,inputName+'-probe.json.gz'),gzipSync(JSON.stringify(result)));
  const responses=settings.filter((s:any)=>s.Input===inputName&&mappedOutputs.includes(s.OutputLive2D)).map((s:any)=>{
   const col=result.parameter_ids.indexOf(s.OutputLive2D),start=result.actual[29][col],target=s.OutputRangeLower+(amplitude-s.InputRangeLower)/(s.InputRangeUpper-s.InputRangeLower)*(s.OutputRangeUpper-s.OutputRangeLower);
   const frame=result.actual.findIndex((r:number[],i:number)=>i>=30&&Math.abs(r[col]-start)>=.9*Math.abs(target-start));
   assert.ok(frame>=30);return {output:s.OutputLive2D,asset_smoothing:s.Smoothing,tau_ms:s.Smoothing*5,t90_ms:(frame-30)/60*1000,actual_target:target};
  });report.probes.push({input:inputName,responses});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(sockets,[]);
 for(const [p,h] of Object.entries(preserve))assert.equal(sha(join(root,p)),h,p);
 report.ok=true;report.neutral_readbacks_identical=true;report.actual_frames=report.clips.reduce((n:number,c:any)=>n+c.frames,0);
}catch(error){report.failure=String(error);throw error;
}finally{report.errors=errors;writeFileSync(join(out,'capture.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,clips:report.clips.length,actual_frames:report.actual_frames,probes:report.probes}));
