import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const base=process.env.DEMO_URL??'http://127.0.0.1:8765';
const out=process.env.SEMANTIC_RESULT_DIR??join(import.meta.dirname,'../test-results/semantic-paragraph-r1/final');
mkdirSync(out,{recursive:true});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,executablePath,args:['--disable-background-timer-throttling']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));await page.addInitScript('window.__name = target => target;');
async function command(method:string,params:any={}){
 const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});
 const d:any=await r.json();if(!r.ok)throw new Error(JSON.stringify(d));return d.result;
}
const report:any={ok:false,base,errors,trace:[]};
try{
 await page.goto(base+'/?speech=1#performance-panel');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#performance-title')?.textContent==='本地语义表演',{timeout:30000});
 const text='大家好呀。这件事就交给我吧。再陪我一会儿好不好？你突然这么夸我，我有点不好意思啦。';
 await page.locator('#performance-text').fill(text);assert.equal(await page.locator('#performance-text').getAttribute('maxlength'),'300');
 const started=Date.now();await page.locator('#performance-play').click();
 for(;;){
  const p=await command('performance.state'),s=(await command('state.get')).speech;
  if(p.queue?.error)throw new Error(p.queue.error);
  report.trace.push({at_ms:Date.now()-started,phase:p.queue?.phase,speech:s,clause:p.clause});
  if(p.queue?.phase==='finished'){
   assert.equal(p.clause,0);assert.equal(p.text,text);assert.equal(p.queue.metrics.filter((m:any)=>m.semantic_prefill_ms!==undefined).length,1);
   assert.equal(new Set(report.trace.filter((t:any)=>t.speech.active).map((t:any)=>t.speech.speech_id)).size,1);
   assert.equal(Math.max(...report.trace.map((t:any)=>t.speech.underruns)),0);assert.equal(p.semantic.duration_final,true);
   report.metrics=p.queue.metrics;report.semantic=p.semantic;break;
  }
  if(Date.now()-started>90000)throw new Error('visible paragraph button timed out');
  await new Promise(r=>setTimeout(r,90));
 }
 await page.waitForFunction(()=>document.querySelector('#performance-message')?.textContent?.includes('完成'),{timeout:5000});
 await page.locator('#performance-panel').screenshot({path:join(out,'continuous-panel.png')});
 report.first_audio_ms=report.trace.find((t:any)=>t.speech.phase==='playing')?.at_ms;report.elapsed_ms=Date.now()-started;
 assert.deepEqual(errors,[]);report.ok=true;
 await page.locator('#performance-stop').click();
}catch(e:any){report.failure=e.stack??String(e);throw e;}
finally{writeFileSync(join(out,'visible-button.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,first_audio_ms:report.first_audio_ms,elapsed_ms:report.elapsed_ms},null,2));
