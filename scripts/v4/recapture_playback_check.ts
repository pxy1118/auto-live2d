/** Re-render identical archived 60 Hz inputs at genuine 60 fps. No frame interpolation. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const root=join(import.meta.dirname,'../..'),old=join(root,'test-results/v4-prosody-study');
const study=join(root,'research/vtuber-v4-playback-diagnosis-r1'),out=join(root,'test-results/v4-playback-diagnosis-r1');mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),unpack=(p:string)=>JSON.parse(gunzipSync(readFileSync(p)).toString());
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const original=read(join(old,'capture.json')),runtime=read(join(root,'research/vtuber-v4-prosody-study/runtime-before.json'));
for(const [p,h] of Object.entries(runtime.files))assert.equal(sha(join(root,p)),h,p);
writeFileSync(join(study,'runtime-before.json'),JSON.stringify(runtime,null,2));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:480,height:720},deviceScaleFactor:1});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[],writes:string[]=[],sockets:string[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});page.on('websocket',s=>{if(new URL(s.url()).pathname==='/ws')sockets.push(s.url());});
const report:any={ok:false,trajectory_changed:false,physics_hz:60,image_hz:60,interpolated_video:false,clips:[],source_asset_hash:original.asset_hash};
try{
 await page.goto('http://127.0.0.1:8775/research/vtuber-v4-prosody-study/render.html');await page.waitForFunction(()=>(window as any).prosodyCapture?.ready,undefined,{timeout:90000});
 for(const id of ['welcome-fixed','cajole-fixed','welcome-rhythm_posture']){
  const folder=join(out,id);mkdirSync(folder,{recursive:true});
  const archived=unpack(join(old,id,'input.json.gz')),previous=unpack(join(old,id,'actual.json.gz'));
  const params={...archived.params,image_hz:60,images:true};
  const captured=await page.evaluate(async params=>(await (window as any).prosodyCapture.engine.command({method:'performance.capture',params})).result,params);
  assert.equal(captured.images.length,archived.frames);assert.deepEqual(captured.parameter_ids,previous.parameter_ids);
  let maxDelta=0;for(let f=0;f<captured.actual.length;f++)for(let j=0;j<captured.actual[f].length;j++)maxDelta=Math.max(maxDelta,Math.abs(captured.actual[f][j]-previous.actual[f][j]));
  assert.ok(maxDelta<=.00002,`${id}: physics readback changed by ${maxDelta}`);
  for(let f=0;f<captured.images.length;f++)writeFileSync(join(folder,String(f).padStart(4,'0')+'.png'),Buffer.from(captured.images[f].png,'base64'));
  delete captured.images;writeFileSync(join(folder,'actual.json.gz'),gzipSync(JSON.stringify(captured)));
  const row={id,frames:archived.frames,image_hz:60,maximum_parameter_difference:maxDelta,
      input_sha256:sha(join(old,id,'input.json.gz')),original_recording_sha256:sha(join(old,id,'actual.json.gz')),recording_sha256:sha(join(folder,'actual.json.gz'))};
  report.clips.push(row);console.log(JSON.stringify(row));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(sockets,[]);
 for(const [p,h] of Object.entries(runtime.files))assert.equal(sha(join(root,p)),h,p);
 report.ok=true;
}catch(error){report.failure=String(error);throw error;
}finally{report.errors=errors;writeFileSync(join(out,'capture.json'),JSON.stringify(report,null,2));await browser.close();}
