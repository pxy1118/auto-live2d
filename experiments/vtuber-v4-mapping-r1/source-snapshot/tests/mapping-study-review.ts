/** Actual single-decoder playback, frame presentation and research-page checks. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'..'),out=join(root,'test-results/v4-mapping-r1');mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(join(root,p),'utf8')),sha=(p:string)=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex');
const base='http://127.0.0.1:8765',protectedFiles=read('research/vtuber-v4-mapping-r1/runtime-before.json').files;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:1050}});await page.addInitScript('window.__name=target=>target;');
await page.addInitScript(()=>{
 const audit={sets:[] as number[],frames:[] as any[],seeks:[] as number[],origin:0};(window as any).mappingAudit=audit;
 const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime')!;
 Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...d,set(value:number){audit.sets.push(performance.now());d.set!.call(this,value);}});
 document.addEventListener('seeking',()=>audit.seeks.push(performance.now()),true);
 document.addEventListener('play',e=>{const v=e.target as HTMLVideoElement;if(v.tagName!=='VIDEO'||(v as any).__audit)return;(v as any).__audit=true;
  const tick=(at:number,meta:VideoFrameCallbackMetadata)=>{audit.frames.push({at,media:meta.mediaTime});v.requestVideoFrameCallback(tick);};v.requestVideoFrameCallback(tick);},true);
});
const errors:string[]=[],writes:string[]=[],sockets:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});page.on('websocket',s=>{if(new URL(s.url()).pathname==='/ws')sockets.push(s.url());});
const result:any={ok:false,checks:[],pacing:[],human_votes_created:0};
try{
 await page.goto(base+'/dataset/vtuber-v4/review/mapping-study.html');
 await page.waitForFunction(()=>document.querySelectorAll('#scene option').length===4&&!(document.getElementById('play') as HTMLButtonElement).disabled);
 assert.equal(await page.locator('video').count(),1);assert.equal(await page.locator('audio').count(),0);assert.equal(await page.locator('#variant option').count(),3);
 const report=read('research/vtuber-v4-mapping-r1/results.json'),scenes=read('datasets/vtuber-v4/review/mapping-study-scenes.json');
 assert.equal(report.clips,12);assert.equal(report.actual_frames,8979);assert.equal(report.promoted,false);assert.equal(report.trained,false);
 for(const s of scenes){assert.ok(s.same_audio_pcm&&s.arm_inputs_identical);for(const v of s.variants){assert.equal(v.fps,60);assert.equal(sha('datasets/vtuber-v4/review/'+v.video),v.video_sha256);}}
 for(const mode of ['current','mapped','mapped_micro']){
  await page.selectOption('#variant',mode);await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement).disabled);
  await page.evaluate(()=>{const a=(window as any).mappingAudit;a.frames=[];a.sets=[];a.seeks=[];a.origin=performance.now();});
  await page.locator('#restart').click();await page.waitForTimeout(7300);await page.locator('#pause').click();
  const raw=await page.evaluate(()=>(window as any).mappingAudit),fs=raw.frames.filter((f:any)=>f.at-raw.origin>1000);
  const gaps=fs.slice(1).map((f:any,i:number)=>f.at-fs[i].at),sorted=[...gaps].sort((a,b)=>a-b);
  const row={mode,frames_presented:fs.length,presentation_gap_p95_ms:sorted[Math.ceil(sorted.length*.95)-1],
    maximum_presentation_gap_ms:Math.max(...gaps),gaps_over_100_ms:gaps.filter(x=>x>100).length,
    steady_current_time_writes:raw.sets.filter((x:number)=>x-raw.origin>1000).length,steady_seek_events:raw.seeks.filter((x:number)=>x-raw.origin>1000).length};
  writeFileSync(join(out,`playback-${mode}-raw.json`),JSON.stringify(raw));result.pacing.push(row);console.log(JSON.stringify(row));
  assert.ok(fs.length>270);assert.equal(row.steady_current_time_writes,0);assert.equal(row.steady_seek_events,0);assert.ok(row.presentation_gap_p95_ms<40);
  const t=await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime);await page.waitForTimeout(200);assert.equal(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime),t);
 }
 // Switching a version is an explicit user action and should retain its position.
 const at=await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime);await page.selectOption('#variant','mapped');
 await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement).disabled&&!document.querySelector('video')!.seeking);
 assert.ok(Math.abs(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)-at)<.06);
 await page.selectOption('#scene','shy');await page.selectOption('#variant','mapped_micro');await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement).disabled);
 await page.locator('video').evaluate(v=>new Promise(resolve=>{const m=v as HTMLVideoElement;m.requestVideoFrameCallback((_,meta)=>resolve(meta.mediaTime));m.currentTime=1.5;}));
 await page.locator('#play').click();await page.waitForTimeout(250);await page.locator('#pause').click();await page.waitForTimeout(150);
 assert.match(await page.locator('#title').innerText(),/近景/);await page.locator('summary').click();
 await page.screenshot({path:join(out,'review-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'review-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(sockets,[]);
 for(const [p,h] of Object.entries(protectedFiles))assert.equal(sha(p),h,p);
 result.checks.push('12 genuine 60 fps videos; paired decoded speech and original arm/finger inputs unchanged',
  'three conditions each played for 7.3 seconds; no steady currentTime writes or seek events; presentation P95 below 40 ms',
  'paused clock stays fixed; explicit version switch retains position; scene switch and seek work',
  'portrait micro-expression view; desktop/mobile without overflow or browser errors; no actor socket/backend writes',
  'neutral readbacks identical; default runtime, weights, previous feedback and ratings unchanged');
 result.ok=true;result.browser_version=browser.version();result.scope='Headless system Chrome, fixed-intent execution ablation; not a naturalness preference or online semantic/TTS latency result.';
}catch(error){result.failure=String(error);throw error;
}finally{result.errors=errors;writeFileSync(join(out,'review-browser.json'),JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result));
