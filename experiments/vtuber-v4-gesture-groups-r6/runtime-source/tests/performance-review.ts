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
 assert.equal(await page.locator('article').count(),14);assert.equal(await page.locator('video').count(),42);
 assert.match(await page.locator('article h2').first().innerText(),/屈肘张掌/);
 assert.match(await page.locator('article h2').nth(1).innerText(),/指出重点/);
 assert.ok(!(await page.locator('article h2').allInnerTexts()).some(x=>x.includes('庆祝')));
 await page.locator('.play-group').first().click();await page.waitForFunction(()=>{const v=document.querySelector('video')!;return !v.paused&&v.videoWidth>0;});
 await page.screenshot({path:join(out,'gesture-groups-gallery.png'),fullPage:false});
 await page.locator('#motion-filter').selectOption('cajole');await page.waitForFunction(()=>document.querySelectorAll('article').length===1);assert.equal(await page.locator('video').count(),3);assert.match(await page.locator('article h2').innerText(),/撒娇/);await page.locator('#motion-filter').selectOption('body');await page.waitForFunction(()=>document.querySelectorAll('article').length===6);
 assert.equal(await page.locator('video').count(),18);assert.ok((await page.locator('article').evaluateAll(rows=>rows.every(r=>r.getAttribute('data-category')==='body'))));
 await page.screenshot({path:join(root,'test-results/v4-groups-r6/body-gallery.png'),fullPage:false});
 await page.locator('#motion-filter').selectOption('with-hands');await page.waitForFunction(()=>document.querySelectorAll('article').length===8);assert.equal(await page.locator('video').count(),24);
 await page.locator('#motion-filter').selectOption('all');await page.waitForFunction(()=>document.querySelectorAll('article').length===14);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#stage').selectOption('comparison');await page.waitForFunction(()=>document.getElementById('progress')!.textContent==='等待新版比较');
 assert.equal(await page.locator('video').count(),0);assert.equal(await page.locator('[data-choice]').count(),0);
 for(const stage of ['motion']){
  const pairs=await(await fetch(base+`/dataset/vtuber-v4/review/${stage==='motion'?'body':'comparison'}-pairs.json`)).json();
  for(const pair of pairs)for(const clip of pair.clips)for(const key of ['media','video','poster'])assert.ok((await fetch(base+'/dataset/vtuber-v4/review/'+clip[key],{method:'HEAD'})).ok);
 }
 assert.deepEqual(await(await fetch(base+'/api/performance/review')).json(),before,'read-only review must not modify human choices');
 await page.goto(base+'/dataset/vtuber-v4/review/index.html?focus=cajole#motion');await page.waitForSelector('article video');assert.equal(await page.locator('article').count(),1);assert.equal(await page.locator('video').count(),3);const report={ok:true,cajole_focus_link:true,motion_groups:14,variants:42,body_only_groups:6,body_filter:true,combination_filter:true,celebration_removed:true,blind_comparison_pending:true,all_media_available:true,mobile_no_horizontal_overflow:true,ratings_unchanged:true};
 writeFileSync(join(root,'test-results/v4-groups-r6/review-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
