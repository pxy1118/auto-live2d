/** Regression: actual presentation and zero automatic seeks, not clock equality alone. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'..'),out=join(root,'test-results/v4-playback-diagnosis-r1');mkdirSync(out,{recursive:true});
const sha=(p:string)=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex');
const before=JSON.parse(readFileSync(join(root,'research/vtuber-v4-playback-diagnosis-r1/runtime-before.json'),'utf8'));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:1050}});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[],writes:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});
const result:any={ok:false,checks:[]};
try{
 await page.goto('http://127.0.0.1:8765/dataset/vtuber-v4/review/playback-check.html');
 await page.waitForFunction(()=>document.querySelectorAll('#scene option').length===3&&!(document.getElementById('play') as HTMLButtonElement).disabled);
 assert.equal(await page.locator('video').count(),1);assert.equal(await page.locator('audio').count(),0);assert.equal(await page.locator('#fps').inputValue(),'60');
 assert.match(await page.locator('#clock').innerText(),/0:13/);
 assert.match(await page.locator('.notice').innerText(),/未通过/);assert.equal(await page.locator('[name=choice]').count(),0);
 const scenes:any[]=await (await fetch('http://127.0.0.1:8765/dataset/vtuber-v4/review/playback-check-scenes.json')).json();
 assert.ok(scenes.every(s=>s.same_audio_pcm&&s.same_60hz_parameter_readback&&s.maximum_parameter_difference===0));
 for(const scene of scenes)for(const fps of ['20','60'])assert.equal(sha('datasets/vtuber-v4/review/'+scene.videos[fps]),scene.video_sha256[fps]);
 await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('video')!.currentTime>.6);
 await page.locator('#pause').click();const paused=await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime);await page.waitForTimeout(250);
 assert.equal(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime),paused);
 // Explicit user seeking remains available; it is separate from steady playback.
 await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime=4.2);
 await page.waitForFunction(()=>Math.abs(document.querySelector('video')!.currentTime-4.2)<.02);
 await page.selectOption('#fps','20');await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement).disabled);
 await page.selectOption('#fps','60');await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement).disabled);
 await page.selectOption('#scene','cajole-fixed');await page.waitForFunction(()=>!(document.getElementById('play') as HTMLButtonElement).disabled);assert.match(await page.locator('#title').innerText(),/撒娇/);
 await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 // The old public URL now reaches the repaired viewer; its archived original remains intact.
 await page.goto('http://127.0.0.1:8765/dataset/vtuber-v4/review/prosody-study.html');
 await page.waitForSelector('#fps');assert.equal(await page.locator('video').count(),1);
 const pacing=JSON.parse(readFileSync(join(out,'playback-after.json'),'utf8'));
 const sixty=pacing.rows.find((r:any)=>r.id==='single_60');assert.equal(sixty.steady_current_time_writes,0);assert.equal(sixty.video_seek_events,0);
 assert.ok(sixty.summaries.length===1&&sixty.summaries[0].callbacks>250&&sixty.summaries[0].presentation_gap_p95_ms<40);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 for(const [p,h] of Object.entries(before.files))assert.equal(sha(p),h,p);
 result.checks.push('single muxed audio/video clock; no parallel decoders, no shared-audio corrections',
  'three exact trajectories at real 60 fps; identical original readback and decoded speech',
  'steady playback has zero currentTime writes or seek events; observed 60 fps presentation P95 below 40 ms',
  'pause, explicit seek, frame-rate switch and scene switch work; desktop/mobile without overflow',
  'rejected experiment clearly labeled; no new rating request; original default, weights and ratings unchanged');
 result.pacing=sixty;result.ok=true;
}catch(error){result.failure=String(error);throw error;
}finally{result.errors=errors;writeFileSync(join(out,'browser-verification.json'),JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result));
