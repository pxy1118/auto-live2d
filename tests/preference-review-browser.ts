/** All synthetic test votes stay outside the user's review dataset. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
const root=join(import.meta.dirname,'..'),out=join(root,'test-results/preference-review'),data=join(out,'synthetic-'+Date.now()),base='http://127.0.0.1:8775';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));mkdirSync(out,{recursive:true});
const report:any={ok:false,errors:[],test_data:data},log=createWriteStream(join(out,'server.log'));
const child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775',LIVE2D_REVIEW_ROOT:data},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.pipe(log);child.stderr.pipe(log);let browser:any;
async function cmd(method:string,params:any={},expected=200){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const d:any=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d.result;}
async function waitForCase(caseId:string,predicate:(row:any)=>boolean,timeout=70000){const begin=Date.now();while(Date.now()-begin<timeout){const row=await cmd('review.get',{case_id:caseId});if(predicate(row))return row;await sleep(150);}throw Error('case wait timed out');}
try{
 for(let i=0;i<100;i++){try{const h:any=await(await fetch(base+'/api/health')).json();if(h.process_id===child.pid)break;}catch{}await sleep(100);}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1365,height:1100}});await page.addInitScript('window.__name=target=>target;');page.on('pageerror',(e:any)=>report.errors.push(e.message));
 await page.goto(base+'/review');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 assert.equal(await page.locator('#review-scenario option').count(),101);
 await page.fill('#review-text','你终于回来啦，我很想你。再陪我聊一会儿，好不好嘛？');await page.click('#review-create');
 await page.waitForFunction(()=>!(document.querySelector('#review-play-A') as HTMLButtonElement).disabled,{timeout:150000});
 let list=await cmd('review.list');const caseId=list.cases[0].id;assert.ok(caseId);const folder=join(data,caseId),audio=readFileSync(join(folder,'audio.ndjson'),'utf8');report.case_id=caseId;
 await cmd('review.rate',{case_id:caseId,choice:'A',scores:{A:5,B:4,C:3},issues:[],note:'synthetic test',takes:{}},400);
 await page.click('#review-play-A');await sleep(1500);await page.click('#review-stop');await waitForCase(caseId,r=>!r.active&&r.takes.A?.status==='interrupted');assert.ok(await page.locator('#review-save').isDisabled());
 for(const candidate of ['A','B','C']){
  await page.waitForFunction(c=>!(document.querySelector('#review-play-'+c) as HTMLButtonElement).disabled,candidate);await page.click('#review-play-'+candidate);
  await cmd('performance.direct',{emotion:'love'},400);
  const row=await waitForCase(caseId,r=>!r.active&&r.takes[candidate]?.complete);
  const take=JSON.parse(readFileSync(join(folder,'take-'+row.takes[candidate].id+'.json'),'utf8'));
  assert.ok(take.samples.some(s=>s.playback_phase==='playing'&&s.affect_vector?.length===64));assert.ok(take.plans.length);assert.notEqual(take.plans[0].reason,'busy','a previous interrupted take must finish exiting before the next take');
  assert.ok(take.samples.some(s=>s.actual.ParamMouthOpenY>.1));assert.equal(take.audio_sha256,row.audio.sha256);assert.ok(take.plans.every(p=>p.input.review_candidate===candidate));
  assert.equal(readFileSync(join(folder,'audio.ndjson'),'utf8'),audio);report[candidate]={samples:take.samples.length,plans:take.plans,audio_sha256:take.audio_sha256};
 }
 await page.reload();await page.waitForFunction(()=>(window as any).live2dDemo?.ready);await page.waitForFunction(()=>document.querySelectorAll('#review-history option').length>1);await page.locator('.performance-settings summary').click();await page.selectOption('#review-history',caseId);
 await page.waitForFunction(()=>!(document.querySelector('#review-vote') as HTMLFieldSetElement).disabled);
 await page.check('input[name="review-choice"][value="B"]');await page.selectOption('#review-score-A','3');await page.selectOption('#review-score-B','5');await page.selectOption('#review-score-C','4');await page.fill('#review-note','自动化测试评分，仅保存到隔离测试目录。');await page.click('#review-save');
 await page.waitForFunction(()=>document.querySelector('#review-status')?.textContent?.includes('已保存选择'));
 const ratings=readdirSync(folder).filter(f=>f.startsWith('rating-'));assert.equal(ratings.length,1);const rating=JSON.parse(readFileSync(join(folder,ratings[0]),'utf8'));assert.equal(rating.choice,'B');assert.equal(rating.training_ready,false);report.rating=rating;
 await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(out,'mobile.png'),fullPage:true});
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready);assert.equal(await page.locator('#review-vote').count(),0);assert.equal(await page.locator('.performance-settings').evaluate((e:HTMLDetailsElement)=>e.open),false);
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.error=String(e);throw e;}finally{await browser?.close();child.kill();log.end();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,case_id:report.case_id,test_data:data,candidates:['A','B','C'].map(c=>({candidate:c,samples:report[c]?.samples})),checks:['shared audio hash','interrupted take cannot vote','actual affect and actions','reload resumes case','explicit rating persisted','responsive separate review UI']}));
