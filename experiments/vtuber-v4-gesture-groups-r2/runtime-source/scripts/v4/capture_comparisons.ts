import { chromium } from 'playwright';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'../..'),folder=process.env.COMPARISON_DIR??join(root,'datasets/vtuber-v4/review/comparisons');
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath});const page=await browser.newPage({viewport:{width:1100,height:900}});await page.addInitScript('window.__name = target => target;');
try{
 await page.goto(process.env.DEMO_URL??'http://127.0.0.1:8765');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.evaluate(()=>{const s=document.getElementById('stage')!;s.style.width='480px';s.style.height='720px';});
 const indices=process.env.PAIR_INDICES?process.env.PAIR_INDICES.split(',').map(Number):Array.from({length:Number(process.env.PAIRS??24)},(_,i)=>i);
 for(const i of indices)for(const label of (process.env.CAPTURE_LABELS??'A,B').split(',')){
  const id=`${String(i).padStart(2,'0')}-${label}`,out=join(folder,id);mkdirSync(out,{recursive:true});
  const input=readFileSync(join(folder,id+'.json'),'utf8'),input_sha256=createHash('sha256').update(input).digest('hex');
  if(existsSync(join(out,'done.json'))){const done=JSON.parse(readFileSync(join(out,'done.json'),'utf8'));if(done.schema==='capture.v4.3'&&done.input_sha256===input_sha256)continue;}
  const params=JSON.parse(input);
  const result=await page.evaluate(async params=>(await (window as any).live2dDemo.engine.command({method:'performance.capture',params})).result,params);
  for(const image of result.images)writeFileSync(join(out,String(image.frame).padStart(4,'0')+'.png'),Buffer.from(image.png,'base64'));
  if(result.hand_landmarks)writeFileSync(join(out,'hands.json'),JSON.stringify(result.hand_landmarks));
  if(params.verify_hands)writeFileSync(join(out,'actual.json'),JSON.stringify({parameter_ids:result.parameter_ids,values:result.actual}));
  writeFileSync(join(out,'done.json'),JSON.stringify({schema:'capture.v4.3',input_sha256,background_reset:true,hz:result.hz,image_hz:result.image_hz??10,frames:result.images.length,actual_finite:result.actual.every(row=>row.every(Number.isFinite))}));
  console.log(JSON.stringify({pair:i+1,label}));
 }
}finally{await browser.close();}
