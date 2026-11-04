import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'..'),base='http://127.0.0.1:8765',out=join(root,'test-results/v4-context-study');mkdirSync(out,{recursive:true});
const sha=(path:string)=>createHash('sha256').update(readFileSync(join(root,path))).digest('hex');
const before=JSON.parse(readFileSync(join(root,'research/vtuber-v4-context-study/runtime-before.json'),'utf8'));
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:1000}});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[],mutations:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')mutations.push(r.method()+' '+r.url());});
const report:any={ok:false,checks:[]};
try{
 await page.goto(base+'/dataset/vtuber-v4/review/context-study.html');await page.waitForSelector('#results tr');
 assert.equal(await page.locator('#results tr').count(),8);assert.equal(await page.locator('[data-scene]').count(),20);
 assert.equal(await page.locator('#scenes article').count(),60);assert.equal(await page.locator('#body-select option').count(),6);
 const result:any=await (await fetch(base+'/dataset/vtuber-v4/review/context-study-report.json')).json();
 assert.equal(result.training_runs.length,9);assert.equal(result.promoted,false);assert.equal(result.old_test_loaded,false);
 for(const [path,hash] of Object.entries(result.source_hashes))assert.equal(sha(path),hash);
 const refs:any=await (await fetch(base+'/dataset/vtuber-v4/review/body-strength-references/manifest.json')).json();
 assert.equal(refs.clips.length,18);assert.equal(refs.clips.reduce((n:number,x:any)=>n+x.frames,0),4536);
 for(const c of refs.clips){assert.equal(c.arm_inputs_unchanged,true);assert.equal((await fetch(base+'/dataset/vtuber-v4/review/'+c.video,{method:'HEAD'})).status,200);}
 for(const body of ['lean','sway','nod','tilt','turn','cajole']){await page.selectOption('#body-select',body);assert.equal(await page.locator('#references video').count(),3);}
 await page.locator('#refs-play').click();await page.waitForFunction(()=>[...document.querySelectorAll('#references video')].every(v=>(v as HTMLVideoElement).currentTime>.3),{timeout:15000});
 await page.locator('#refs-pause').click();assert.ok(await page.locator('#references video').evaluateAll(v=>v.every(x=>(x as HTMLVideoElement).paused)));
 const media=await page.locator('#references video').evaluateAll(v=>v.map(x=>({duration:(x as HTMLVideoElement).duration,time:(x as HTMLVideoElement).currentTime,width:(x as HTMLVideoElement).videoWidth})));
 assert.ok(media.every(x=>Math.abs(x.duration-4.2)<.06&&x.width>0));
 assert.ok(Math.max(...media.map(x=>x.time))-Math.min(...media.map(x=>x.time))<.2);
 await page.selectOption('#scene-select','94-pair-praise-line');assert.equal(await page.locator('[data-scene]').count(),1);assert.equal(await page.locator('#scenes article').count(),3);await page.locator('#scenes summary').click();
 await page.screenshot({path:join(out,'review-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'review-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
 for(const [path,hash] of Object.entries(before.files))assert.equal(sha(path),hash);
 const old=JSON.parse(readFileSync(join(root,'research/vtuber-v4-intent-study/provenance.json'),'utf8'));
 for(const [path,entry] of Object.entries(old.files) as [string,any][])assert.equal(sha(path),entry.sha256);
 report.checks.push('eight complete result rows / nine new matched training runs','all 20 development stories / 60 clauses; original quote context preserved',
    '18 actual Cubism clips / 4536 readback frames; six body groups / three strengths; playable synchronized video',
    'desktop/mobile layout; published source hashes; read-only page','original 81 research artifacts, ratings, encoder and default configuration hashes unchanged');
 report.media=media;report.ok=true;
}finally{writeFileSync(join(out,'review-browser.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
