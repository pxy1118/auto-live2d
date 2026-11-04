/** Real media/UI check; creates no human votes and never contacts the live actor. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8775';
const out=join(root,'test-results/v4-prosody-study');mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(join(root,p),'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex');
const before=read('research/vtuber-v4-prosody-study/runtime-before.json');
const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:1050}});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[],writes:string[]=[],sockets:string[]=[];page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});page.on('websocket',s=>{if(new URL(s.url()).pathname==='/ws')sockets.push(s.url());});
const result:any={ok:false,checks:[],human_votes_created:0};
try{
 await page.goto(base+'/dataset/vtuber-v4/review/prosody-study.html');await page.waitForSelector('#scene option',{state:'attached'});
 assert.equal(await page.locator('#scene option').count(),8);assert.equal(await page.locator('video').count(),3);
 assert.equal(await page.locator('[name=choice]').count(),5);assert.equal(await page.locator('[name=choice]:checked').count(),0);
 const report=read('research/vtuber-v4-prosody-study/results.json');assert.equal(report.clips,24);assert.equal(report.actual_parameter_frames,17829);
 assert.equal(report.promoted,false);assert.equal(report.trained,false);assert.equal(report.human_votes,0);assert.equal(report.paired_action_counts_matched,true);
 for(const [p,h] of Object.entries(report.source_hashes))assert.equal(sha(p),h,p);
 const scenes=read('datasets/vtuber-v4/review/prosody-study-scenes.json');
 for(const scene of scenes){
  assert.equal(scene.muxed_audio_identical,true);
  for(const v of scene.variants)assert.equal((await fetch(base+'/dataset/vtuber-v4/review/'+v.video,{method:'HEAD'})).status,200);
 }
 await page.locator('#play').click();
 await page.waitForFunction(()=>{const a=document.querySelector('audio')!;return a.currentTime>.8&&[...document.querySelectorAll('video')].every(v=>v.currentTime>.5);});
 const playing=await page.evaluate(()=>({audio:document.querySelector('audio')!.currentTime,videos:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,width:v.videoWidth,height:v.videoHeight,muted:v.muted}))}));
 assert.ok(playing.videos.every(v=>v.width===480&&v.height===720&&v.muted&&Math.abs(v.time-playing.audio)<.12));
 await page.locator('#pause').click();const paused=await page.evaluate(()=>document.querySelector('audio')!.currentTime);await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>document.querySelector('audio')!.currentTime),paused);
 await page.locator('#seek').evaluate((el:HTMLInputElement)=>{el.value='4.2';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>Math.abs(v.currentTime-4.2)<.1));
 // UI exercise uses an unsaved note only; no ratings are exported to research.
 await page.locator('#note').fill('UI test only');await page.locator('#next').click();await page.locator('#previous').click();
 assert.equal(await page.locator('#note').inputValue(),'UI test only');await page.locator('#note').fill('');
 await page.selectOption('#scene','neutral');assert.match(await page.locator('#title').innerText(),/中性/);
 await page.selectOption('#scene','welcome');assert.equal(await page.locator('#note').inputValue(),'');
 await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement).disabled);
 await page.locator('summary').click();await page.screenshot({path:join(out,'review-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'review-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(sockets,[]);
 for(const [p,h] of Object.entries(before.files))assert.equal(sha(p),h,p);
 result.checks.push('24 real videos with identical per-scene muxed audio; 8 three-way blinded scenes',
  'actual audio playback and muted video clocks within 120 ms; pause and seek synchronized',
  'scene navigation and note retention; five valid preference choices; no generated human votes',
  'desktop/mobile without overflow or browser errors; no actor socket, no backend writes',
  'default configuration, existing runtime source, original weights and human ratings hashes unchanged');
 result.playing=playing;result.browser_version=browser.version();result.ok=true;
}catch(error){result.failure=String(error);throw error;
}finally{result.errors=errors;writeFileSync(join(out,'review-browser.json'),JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result));
