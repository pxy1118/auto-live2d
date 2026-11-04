/** Actual Cubism amplitude references. No semantic model or motion edits. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {BodyMotionLayer,bodyChannels,bodyMotionNames,bodyMotionLabels} from '../../src/body-motion';
const root=join(import.meta.dirname,'../..'),out=join(root,'test-results/v4-context-study/body-calibration');mkdirSync(out,{recursive:true});
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const ratings=join(root,'.runtime/performance/ratings.json'),before=sha(ratings),curveHash=sha(join(root,'src/body-motion.ts'));
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath});const page=await browser.newPage({viewport:{width:1100,height:900}});
await page.addInitScript('window.__name=target=>target;');const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const manifest:any={schema:'body-strength-reference.v1',source:'unchanged BodyMotionLayer, real Cubism full geometry/physics update',
    semantic_model_used:false,audio_used:false,human_naturalness_accepted:false,promoted:false,curve_sha256:curveHash,
    strengths:[.2,.5,.8],hz:60,image_hz:20,duration_ms:4200,clips:[],ratings_before:before};
try{
 await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.evaluate(()=>{const el=document.getElementById('stage')!;el.style.width='480px';el.style.height='720px';});
 await page.waitForTimeout(150);
 const parameters=await page.evaluate(()=>(window as any).live2dDemo.engine.command({method:'model.describe',params:{}}).then((r:any)=>r.result.parameters));
 const defaults=Object.fromEntries(parameters.map((p:any)=>[p.id,p.default]));
 for(const name of bodyMotionNames)for(const strength of [.2,.5,.8]){
  const id=`${name}-${Math.round(strength*100)}`,folder=join(out,id);mkdirSync(folder,{recursive:true});
  const layer=new BodyMotionLayer();layer.request({name,id,variant:0,strength,holdMs:2200,source:'director'},0);
  const values=Array.from({length:252},(_,f)=>{const v=layer.tick(f/60*1000);return bodyChannels.map(k=>(defaults[k]??0)+(v[k]??0));});
  const params={channels:bodyChannels,values,hz:60,image_hz:20,images:true,full_update:true};
  writeFileSync(join(folder,'input.json'),JSON.stringify(params));
  const result=await page.evaluate(async params=>(await (window as any).live2dDemo.engine.command({method:'performance.capture',params})).result,params);
  assert.equal(result.actual.length,252);assert.equal(result.images.length,84);assert.ok(result.actual.every((row:number[])=>row.every(Number.isFinite)));
  const range=(key:string)=>{const j=result.parameter_ids.indexOf(key),v=result.actual.map((row:number[])=>row[j]);assert.ok(j>=0);return {min:Math.min(...v),max:Math.max(...v),range:Math.max(...v)-Math.min(...v)};};
  const body=Object.fromEntries(bodyChannels.map(k=>[k,range(k)]));assert.ok(Object.values(body).some((r:any)=>r.range>.8));
  const armIds=['Param36','Param39','Param41','Param42','Param43','Param62','Param59','Param60','Param61','Movement1','Movement2','Movement3'];
  for(const key of armIds){const r=range(key);assert.ok(Math.abs(r.min-(defaults[key]??0))<1e-4&&Math.abs(r.max-(defaults[key]??0))<1e-4,`${id} changed arm/hand input ${key}`);}
  for(let i=0;i<result.images.length;i++)writeFileSync(join(folder,String(i).padStart(4,'0')+'.png'),Buffer.from(result.images[i].png,'base64'));
  const frame_map=result.images.map((x:any,i:number)=>({image:i,parameter_frame:x.frame}));delete result.images;
  writeFileSync(join(folder,'actual.json.gz'),gzipSync(JSON.stringify(result)));
  manifest.clips.push({id,name,label:bodyMotionLabels[name],strength,variant:0,frames:252,images:84,body_ranges:body,arm_inputs_unchanged:true,frame_map,
      input_sha256:sha(join(folder,'input.json')),recording_sha256:sha(join(folder,'actual.json.gz'))});
  console.log(JSON.stringify({captured:id,frames:252,images:84,arms_unchanged:true}));
 }
 assert.deepEqual(errors,[]);assert.equal(sha(ratings),before);assert.equal(sha(join(root,'src/body-motion.ts')),curveHash);
 manifest.ok=true;writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
}finally{await browser.close();}
