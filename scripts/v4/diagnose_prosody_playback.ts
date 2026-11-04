/** Profile actual presentation, not merely media clock equality. */
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
const root=join(import.meta.dirname,'../..'),study=join(root,'research/vtuber-v4-playback-diagnosis-r1');
const out=join(root,'test-results/v4-playback-diagnosis-r1');mkdirSync(study,{recursive:true});mkdirSync(out,{recursive:true});
const publicRoot=join(root,'datasets/vtuber-v4/review'),archived=join(publicRoot,'prosody-playback-before.html');
if(!existsSync(archived))copyFileSync(join(publicRoot,'prosody-study.html'),archived);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:1050}});await page.addInitScript('window.__name=target=>target;');
await page.addInitScript(()=>{
 const audit={sets:[] as any[],frames:[] as any[],events:[] as any[],origin:0};(window as any).frameAudit=audit;
 const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime')!;
 Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...descriptor,set(value:number){
  audit.sets.push({at:performance.now(),tag:this.tagName,label:this.getAttribute('aria-label'),from:descriptor.get!.call(this),to:value});descriptor.set!.call(this,value);
 }});
 document.addEventListener('play',event=>{
  const video=event.target as HTMLVideoElement;if(video.tagName!=='VIDEO'||(video as any).__audited)return;(video as any).__audited=true;
  const loop=(now:number,meta:VideoFrameCallbackMetadata)=>{audit.frames.push({at:now,media:meta.mediaTime,frames:meta.presentedFrames,label:video.getAttribute('aria-label')});video.requestVideoFrameCallback(loop);};video.requestVideoFrameCallback(loop);
 },true);
 for(const name of ['seeking','seeked','waiting','stalled'])document.addEventListener(name,event=>{const m=event.target as HTMLMediaElement;if(['VIDEO','AUDIO'].includes(m.tagName))audit.events.push({name,tag:m.tagName,at:performance.now(),time:m.currentTime});},true);
});
const rows:any[]=[];
try{
 const targets=process.argv.includes('--after')?[
  {id:'single_20',url:'http://127.0.0.1:8765/dataset/vtuber-v4/review/playback-check.html',fps:'20'},
  {id:'single_60',url:'http://127.0.0.1:8765/dataset/vtuber-v4/review/playback-check.html',fps:'60'}
 ]:[{id:'original_triple_20',url:'http://127.0.0.1:8765/dataset/vtuber-v4/review/prosody-playback-before.html',fps:''}];
 for(const target of targets){
  await page.goto(target.url);await page.waitForFunction(()=>document.querySelectorAll('video').length>0&&!(document.getElementById('play') as HTMLButtonElement)?.disabled&&[...document.querySelectorAll('video')].every(v=>v.readyState>=2));
  if(target.fps)await page.selectOption('#fps',target.fps);
  await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement)?.disabled);
  await page.evaluate(()=>{(window as any).frameAudit.origin=performance.now();});await page.locator('#play').click();
  await page.waitForTimeout(7500);
  const raw=await page.evaluate(()=>({...(window as any).frameAudit,quality:[...document.querySelectorAll('video')].map(v=>({total:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames,time:v.currentTime}))}));
  const labels=[...new Set(raw.frames.map((f:any)=>f.label))];
  const summaries=labels.map(label=>{const fs=raw.frames.filter((f:any)=>f.label===label&&f.at-raw.origin>1000),wall:number[]=[],media:number[]=[];
   for(let i=1;i<fs.length;i++){wall.push(fs[i].at-fs[i-1].at);media.push((fs[i].media-fs[i-1].media)*1000);}
   const q=(a:number[],p:number)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1]??null;
   return {label,callbacks:fs.length,presentation_gap_p50_ms:q(wall,.5),presentation_gap_p95_ms:q(wall,.95),
    max_presentation_gap_ms:Math.max(...wall),source_step_p50_ms:q(media,.5),gaps_over_100_ms:wall.filter(t=>t>100).length};});
  const summary={id:target.id,steady_current_time_writes:raw.sets.filter((s:any)=>s.tag==='VIDEO'&&s.at-raw.origin>1000).length,
    total_video_time_writes:raw.sets.filter((s:any)=>s.tag==='VIDEO').length,video_seek_events:raw.events.filter((e:any)=>e.name==='seeking'&&e.tag==='VIDEO').length,
    summaries,quality:raw.quality,browser:browser.version(),scope:'Headless system Chrome presentation; not direct measurement of the user in-app browser.'};
  rows.push(summary);writeFileSync(join(out,target.id+'-raw.json'),JSON.stringify(raw));console.log(JSON.stringify(summary));
 }
 writeFileSync(join(out,process.argv.includes('--after')?'playback-after.json':'playback-before.json'),JSON.stringify({rows},null,2));
}finally{await browser.close();}
