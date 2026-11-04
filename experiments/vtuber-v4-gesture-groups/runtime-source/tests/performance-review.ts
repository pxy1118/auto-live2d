import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8765',out=join(root,'test-results/v4');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1440,height:1100}});
const before=await(await fetch(base+'/api/performance/review')).json();
try{
 await page.goto(base+'/dataset/vtuber-v4/review/index.html#motion');await page.waitForSelector('article video');
 assert.equal(await page.locator('article').count(),8);assert.equal(await page.locator('video').count(),16);
 assert.match(await page.locator('article h2').first().innerText(),/抚胸/);
 assert.match(await page.locator('article h2').nth(1).innerText(),/狗尾草/);
 await page.locator('.play-group').first().click();await page.waitForFunction(()=>{const v=document.querySelector('video')!;return !v.paused&&v.videoWidth>0;});
 await page.screenshot({path:join(out,'gesture-groups-gallery.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#stage').selectOption('comparison');await page.waitForFunction(()=>document.getElementById('progress')!.textContent==='等待新版比较');
 assert.equal(await page.locator('video').count(),0);assert.equal(await page.locator('[data-choice]').count(),0);
 for(const stage of ['motion']){
  const pairs=await(await fetch(base+`/dataset/vtuber-v4/review/${stage==='motion'?'body':'comparison'}-pairs.json`)).json();
  for(const pair of pairs)for(const clip of pair.clips)for(const key of ['media','video','poster'])assert.ok((await fetch(base+'/dataset/vtuber-v4/review/'+clip[key],{method:'HEAD'})).ok);
 }
 assert.deepEqual(await(await fetch(base+'/api/performance/review')).json(),before,'read-only review must not modify human choices');
 const report={ok:true,motion_groups:8,variants:16,blind_comparison_pending:true,all_media_available:true,mobile_no_horizontal_overflow:true,ratings_unchanged:true};
 writeFileSync(join(out,'review-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
