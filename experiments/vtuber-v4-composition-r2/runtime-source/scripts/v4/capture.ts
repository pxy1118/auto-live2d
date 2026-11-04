import { chromium } from 'playwright';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
const root=join(import.meta.dirname,'../..'),folder=process.env.DATASET_ROOT??join(root,'datasets/vtuber-v4');
const base=process.env.DEMO_URL??'http://127.0.0.1:8765';
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const profile=read(join(folder,'profile.json')),manifest=read(join(folder,'manifest.json'));
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1100,height:900}});await page.addInitScript('window.__name = target => target;');
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
await page.evaluate(()=>{const s=document.getElementById('stage')!;s.style.width='480px';s.style.height='720px';});
const out=join(folder,'recordings');mkdirSync(out,{recursive:true});
const review=join(folder,'review');mkdirSync(join(review,'frames'),{recursive:true});
const examples=manifest.items.filter((x:any)=>Number(x.id.slice(1,4))<16&&['v1','v4'].some(v=>x.id.endsWith(v)));
const exampleIds=process.env.REVIEW_IDS?new Set(process.env.REVIEW_IDS.split(',')):new Set(examples.map((x:any)=>x.id));
const shard=Number(process.env.CHUNK_INDEX??0),shards=Number(process.env.CHUNK_COUNT??1);
try{
  for(let index=0;index<manifest.items.length;index++){
    if(index%shards!==shard)continue;
    const item=manifest.items[index],file=join(out,item.id+'.json.gz');if(existsSync(file))continue;
    const clip=read(join(folder,'clips',item.id+'.json'));const audio=read(join(folder,clip.audio.replace('.wav','.json')));
    const result=await page.evaluate(async input=>{const w=window as any;return (await w.live2dDemo.engine.command({method:'performance.capture',params:input})).result;},
      {channels:profile.channels.map((p:any)=>p.id),values:clip.values,face:clip.face,eye:clip.eye,mouth:audio.features.values,images:exampleIds.has(item.id),full_update:process.env.FAST_CAPTURE!=='1'});
    for(const image of result.images){const name=`${item.id}-${String(image.frame).padStart(4,'0')}.png`;writeFileSync(join(review,'frames',name),Buffer.from(image.png,'base64'));}
    delete result.images;writeFileSync(file,gzipSync(JSON.stringify({id:item.id,source:'real_cubism_offline_execution',...result}),{level:6}));
    if(index%20===0)console.log(JSON.stringify({captured:index+1,total:manifest.items.length}));
  }
  const sequences=read(join(folder,'sequences.json'));const sequenceOut=join(folder,'dialogue-recordings');mkdirSync(sequenceOut,{recursive:true});
  const probe=read(join(folder,'clips',manifest.items[0].id+'.json'));
  const capture=async(full_update:boolean)=>page.evaluate(async params=>(await (window as any).live2dDemo.engine.command({method:'performance.capture',params})).result,
    {channels:profile.channels.map((p:any)=>p.id),values:probe.values,face:probe.face,eye:probe.eye,full_update});
  const full=await capture(true),fast=await capture(false);
  const error=Math.max(...full.actual.flatMap((row:any,i:number)=>row.map((v:number,j:number)=>Math.abs(v-fast.actual[i][j]))));
  const useFull=error>1e-5;
  writeFileSync(join(review,'capture-equivalence.json'),JSON.stringify({maximum_parameter_error:error,physics_hz:60,geometry_hz:useFull?60:20,full_update:useFull}));
  for(let index=0;index<sequences.length;index++){
    if(index%shards!==shard)continue;
    const seq=sequences[index],file=join(sequenceOut,seq.id+'.json.gz');if(existsSync(file))continue;
    const path=join(folder,'dialogues',seq.id+'.json');if(!existsSync(path))throw new Error('Run build_sequences.py before dialogue capture');
    const clip=read(path);
    const result=await page.evaluate(async input=>(await (window as any).live2dDemo.engine.command({method:'performance.capture',params:input})).result,
      {channels:profile.channels.map((p:any)=>p.id),values:clip.values,face:clip.face,eye:clip.eye,mouth:clip.mouth,full_update:useFull});
    delete result.images;writeFileSync(file,gzipSync(JSON.stringify({id:seq.id,source:'real_cubism_multi_clause_execution',...result}),{level:6}));
    if(index%20===0)console.log(JSON.stringify({dialogues:index+1,total:sequences.length}));
  }
  writeFileSync(join(review,shards>1?`capture-${shard}.json`:'capture.json'),JSON.stringify({ok:errors.length===0,shard,shards,clips:manifest.items.length,pilot_examples:examples.map((x:any)=>x.id),errors,source:'Cubism model readback; no human naturalness judgment'},null,2));
}finally{await browser.close();}
