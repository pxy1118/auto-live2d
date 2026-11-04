import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8778';
const out=join(root,'test-results/v4-composition-r2');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage({viewport:{width:1200,height:1000}});
await page.addInitScript('window.__name=target=>target;');
const report:any={ok:false,checked:[],frames:[]};
const keys=['key5','key3','key4','key6'];
async function cmd(method:string,params:any={}){return page.evaluate(async command=>(await (window as any).live2dDemo.engine.command(command)).result,{method,params});}
function check(s:any,wanted:number){const v=keys.map(k=>s.values[k]);assert.deepEqual(v,keys.map((_,i)=>i===wanted?1:0));report.frames.push(v);}
try{
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 report.runtime_version=(await cmd('capabilities.get')).runtime_version;assert.equal(report.runtime_version,'v4.12.2-discrete-eyes');
 await cmd('engine.reset',{paused:true});await cmd('behavior.set',{idle:false,blink:false,breath:false});
 await page.locator('#portrait-view').click();await cmd('engine.step',{frames:1});check(await cmd('state.get'),-1);
 await page.locator('#stage').screenshot({path:join(out,'normal.png')});
 const names=['＞＜','圈圈眼','爱心眼','屑屑眼'];
 for(let i=0;i<names.length;i++){
  await cmd('performance.direct',{expression:names[i],intensity:.2,hold_ms:1000,cue_id:'eye'});
  await cmd('engine.step',{frames:1});check(await cmd('state.get'),i);
  await page.locator('#stage').screenshot({path:join(out,`eye-${i+1}.png`)});
 }
 await cmd('performance.direct',{expression:'脸红',intensity:.35,hold_ms:3000,cue_id:'blush'});
 await cmd('engine.step',{frames:18});const blush=await cmd('state.get');check(blush,3);assert.ok(blush.values.key7>.2&&blush.values.key7<.35);
 await cmd('engine.step',{frames:50});check(await cmd('state.get'),-1);
 await cmd('performance.release',{});await cmd('engine.reset',{paused:true});
 await cmd('expressions.set',{name:'＞＜',enabled:true,strength:.12,fade_ms:1000});await cmd('engine.step',{frames:1});check(await cmd('state.get'),0);
 await cmd('expressions.set',{name:'屑屑眼',enabled:true,strength:.591,exclusive:false});await cmd('engine.step',{frames:1});check(await cmd('state.get'),3);
 await cmd('expressions.clear');await cmd('parameters.set',{values:{key3:.8,key4:.7,key5:.2,key6:.1}});await cmd('engine.step',{frames:1});check(await cmd('state.get'),1);
 await cmd('parameters.set',{values:{key5:.95},stage:'post'});await cmd('engine.step',{frames:1});check(await cmd('state.get'),0);
 await cmd('parameters.release');await cmd('engine.step',{frames:1});check(await cmd('state.get'),-1);
 report.checked=['actual Cubism 0/1 outputs for four special eye drawings','one-frame switching and expiry with no overlap','continuous blush independent of discrete eye state','legacy expression strength/fade/exclusivity','conflicting pre/post raw parameter stages'];
 const review=await browser.newPage();await review.goto(base+'/dataset/vtuber-v4/review/eye-fix.html');await review.waitForSelector('article');assert.equal(await review.locator('video').count(),4);
 await review.locator('article button').first().click();await review.waitForFunction(()=>[...document.querySelectorAll('article:first-child video')].every(v=>(v as HTMLVideoElement).currentTime>.1),{timeout:15000});
 report.checked.push('two correction pairs load and synchronized MP4 playback advances');
 await review.goto(base+'/dataset/vtuber-v4/review/index.html#comparison');await review.waitForSelector('#review-result');
 assert.equal(await review.locator('[data-choice].selected').count(),24);assert.match(await review.locator('#review-result').innerText(),/新版 11/);
 assert.equal(await review.locator('#review-result a').getAttribute('href'),'eye-fix.html');report.checked.push('completed 24 human votes and failed acceptance result remain visible with correction link');report.ok=true;
}finally{writeFileSync(join(out,'eye-browser.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,checked:report.checked}));
