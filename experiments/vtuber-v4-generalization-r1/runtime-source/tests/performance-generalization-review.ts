import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'..'),base='http://127.0.0.1:8765',out=join(root,'test-results/v4-generalization');mkdirSync(out,{recursive:true});
const ratingHash=()=>createHash('sha256').update(readFileSync(join(root,'.runtime/performance/ratings.json'))).digest('hex'),before=ratingHash();
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage({viewport:{width:1200,height:1000}});await page.addInitScript('window.__name=target=>target;');
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const report:any={ok:false,runtime_version:'v4.13.0-clause-plan',checked:[]};
try{
 await page.goto(base+'/dataset/vtuber-v4/review/generalization.html');await page.waitForSelector('#table tr');
 assert.equal(await page.locator('#table tr').count(),4);assert.equal(await page.locator('video').count(),6);assert.match(await page.locator('#result').innerText(),/尚未通过/);
 const data=await(await fetch(base+'/dataset/vtuber-v4/review/generalization-report.json')).json();assert.equal(data.engineering_checks_passed,true);assert.equal(data.quality_gate_passed,false);assert.equal(data.promoted,false);
 const sources=await page.locator('video').evaluateAll(v=>v.map(x=>(x as HTMLVideoElement).src));for(const src of sources)assert.equal((await fetch(src,{method:'HEAD'})).status,200);
 await page.locator('video').first().evaluate(async v=>{await (v as HTMLVideoElement).play();});await page.waitForFunction(()=>document.querySelector('video')!.currentTime>.2,{timeout:15000});
 await page.locator('video').first().evaluate(v=>(v as HTMLVideoElement).pause());await page.screenshot({path:join(out,'review-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'review-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 report.checked.push('four ablation rows; six audio/video demonstrations; explicit failed quality gate; media playback; mobile layout');
 await page.goto(base+'/dataset/vtuber-v4/review/index.html#comparison');await page.waitForSelector('#review-result');assert.equal(await page.locator('[data-choice].selected').count(),24);
 assert.equal(await page.locator('#review-result a[href="generalization.html"]').count(),1);assert.equal(ratingHash(),before);assert.deepEqual(errors,[]);
 report.checked.push('24 original human votes unchanged; original comparison links to the research page');report.ok=true;
}finally{writeFileSync(join(out,'review-browser.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
