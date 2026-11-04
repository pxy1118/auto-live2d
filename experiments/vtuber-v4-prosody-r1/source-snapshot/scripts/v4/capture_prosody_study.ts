/** Separate renderer; real Cubism geometry and physics, no default actor takeover. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {conditions,renderInputs} from '../../research/vtuber-v4-prosody-study/conductor';
import {gestureArmChannels} from '../../src/gesture-library';
import {bodyChannels} from '../../src/body-motion';

const root=join(import.meta.dirname,'../..'),study=join(root,'research/vtuber-v4-prosody-study');
const data=join(root,'datasets/vtuber-v4-prosody-r1'),out=join(root,'test-results/v4-prosody-study');mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const preserved=read(join(study,'runtime-before.json')).files,index=read(join(data,'manifest.json')),manifest=read(join(study,'asset-manifest.json'));
for(const [p,h] of Object.entries(preserved))assert.equal(sha(join(root,p)),h,p);
const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe'].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath});
const page=await browser.newPage({viewport:{width:480,height:720},deviceScaleFactor:1});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[],runtimeSockets:string[]=[],writes:string[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('websocket',s=>{if(new URL(s.url()).pathname==='/ws')runtimeSockets.push(s.url());});
page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});
const report:any={schema:'prosody-capture.v1',ok:false,trained:false,promoted:false,semantic_model_used:false,real_tts:true,
  actual_cubism:true,naturalness_accepted:false,parameter_hz:60,video_hz:20,clips:[],browser_version:browser.version(),browser_executable:executablePath,
  protocol_sha256:sha(join(study,'protocol.json'))};
try{
 await page.goto('http://127.0.0.1:8775/research/vtuber-v4-prosody-study/render.html');
 await page.waitForFunction(()=>(window as any).prosodyCapture?.ready,undefined,{timeout:90000});
 const description=await page.evaluate(async()=>(await (window as any).prosodyCapture.engine.command({method:'model.describe',params:{}})).result);
 assert.equal(description.asset_hash,manifest.assetHash);report.asset_hash=manifest.assetHash;
 const limits=new Map(description.parameters.map((p:any)=>[p.id,p]));
 for(const input of index.scenes){
  const scene=read(join(data,input.path));assert.equal(sha(join(data,scene.id,'audio.wav')),scene.audio_sha256);
  for(const condition of conditions){
   const id=scene.id+'-'+condition,folder=join(out,id);mkdirSync(folder,{recursive:true});
   const generated=renderInputs(manifest,scene,condition),params={...generated.params,images:true};
   let outOfRange=0;for(const row of params.values)for(let j=0;j<row.length;j++){const p:any=limits.get(params.channels[j]);if(row[j]<p.min-1e-5||row[j]>p.max+1e-5)outOfRange++;}
   writeFileSync(join(folder,'input.json.gz'),gzipSync(JSON.stringify(generated)));
   const captured=await page.evaluate(async params=>(await (window as any).prosodyCapture.engine.command({method:'performance.capture',params})).result,params);
   assert.equal(captured.actual.length,generated.frames);assert.ok(captured.actual.every((r:number[])=>r.every(Number.isFinite)));
   const pidx=(k:string)=>captured.parameter_ids.indexOf(k);
   let twoRaised=0;for(const row of captured.actual){
    const right=['Param36','Param39','Param41','Movement1','Movement3'].some(k=>Math.abs(row[pidx(k)]-(limits.get(k) as any).default)>.05);
    const left=['Param62','Param59','Param60','Movement2'].some(k=>Math.abs(row[pidx(k)]-(limits.get(k) as any).default)>.05);
    if(right&&left)twoRaised++;
   }
   const continuous=[...bodyChannels,'Param36','Param39','Param41','Param42','Param62','Param59','Param60','Param61'];
   const normalized=captured.actual.map((r:number[])=>continuous.map(k=>{const p:any=limits.get(k);return r[pidx(k)]/Math.max(1e-6,p.max-p.min);}));
   const absVelocity:number[]=[],absAcceleration:number[]=[];
   for(let f=1;f<normalized.length;f++)for(let j=0;j<continuous.length;j++){
    absVelocity.push(Math.abs(normalized[f][j]-normalized[f-1][j])*60);
    if(f>1)absAcceleration.push(Math.abs(normalized[f][j]-2*normalized[f-1][j]+normalized[f-2][j])*3600);
   }
   const percentile=(a:number[],q:number)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*q)-1]??0;
   const imageFrames=captured.images.map((x:any,i:number)=>{writeFileSync(join(folder,String(i).padStart(4,'0')+'.png'),Buffer.from(x.png,'base64'));return x.frame;});
   const imageCount=captured.images.length;delete captured.images;
   writeFileSync(join(folder,'actual.json.gz'),gzipSync(JSON.stringify(captured)));
   const finalInput=generated.params.values.at(-1)!;
   const neutral=['neutral','quoted'].includes(scene.id);
   const row={id,scene:scene.id,condition,frames:generated.frames,images:imageCount,image_frames:imageFrames,
     duration_ms:generated.frames/60*1000,audio_duration_ms:scene.duration_ms,two_raised_arm_samples:twoRaised,
     out_of_range_inputs:outOfRange,rest_input_max:Math.max(...finalInput.map(Math.abs)),
     silent_control_is_zero:neutral?generated.params.values.every(row=>row.every(v=>v===0)):null,
     events:generated.events,acoustic_accents:generated.accents,
     parameter_velocity_p95:percentile(absVelocity,.95),parameter_acceleration_p95:percentile(absAcceleration,.95),
     policy_tick_p95_ms:percentile(generated.computes,.95),
     compute_scope:'Local policy tick only; excludes semantic/TTS/network/render and is not end-to-end latency.',
     input_sha256:sha(join(folder,'input.json.gz')),recording_sha256:sha(join(folder,'actual.json.gz'))};
   assert.equal(twoRaised,0,id);assert.equal(outOfRange,0,id);assert.ok(row.rest_input_max<.015,`${id} did not drain: ${row.rest_input_max}`);
   if(neutral)assert.equal(row.silent_control_is_zero,true);
   report.clips.push(row);writeFileSync(join(out,'capture-progress.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify({captured:id,frames:row.frames,images:imageCount,two_raised:twoRaised,rest:row.rest_input_max}));
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(runtimeSockets,[]);assert.deepEqual(writes,[]);
 for(const [p,h] of Object.entries(preserved))assert.equal(sha(join(root,p)),h,p);
 report.ok=true;report.default_and_human_ratings_unchanged=true;report.runtime_websocket_opened=false;
 report.frames=report.clips.reduce((n:number,c:any)=>n+c.frames,0);report.errors=errors;
}catch(error){report.failure=String(error);throw error;
}finally{report.errors=errors;report.runtime_sockets=runtimeSockets;report.requests_with_writes=writes;writeFileSync(join(out,'capture.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,clips:report.clips.length,actual_frames:report.frames}));
