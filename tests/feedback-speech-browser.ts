/** Actual GPU selector, unchanged Qwen voice, and the final rendered action.
 * These known feedback phrases are training replay, not a blind acceptance set.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
const root=join(import.meta.dirname,'..'),out=join(root,'test-results/acting-feedback-r3/speech'),base='http://127.0.0.1:8775';mkdirSync(out,{recursive:true});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));const report:any={ok:false,cases:[],errors:[],source:'training_phrase_replay_not_blind_evaluation'};
const log=createWriteStream(join(out,'server.log')),server=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775',LIVE2D_REVIEW_ROOT:join(out,'isolated-reviews')},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.pipe(log);server.stderr.pipe(log);let browser:any;
async function cmd(method:string,params:any={}){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const d:any=await r.json();assert.equal(r.status,200,method+JSON.stringify(d));return d.result;}
try{
 for(let i=0;i<100;i++){try{const h:any=await(await fetch(base+'/api/health')).json();if(h.process_id===server.pid)break;}catch{}await sleep(100);}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1365,height:1050}});await page.addInitScript('window.__name=target=>target;');page.on('pageerror',(e:any)=>report.errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,undefined,{timeout:60000});await page.waitForFunction(()=>!(document.querySelector('#performance-play') as HTMLButtonElement).disabled,undefined,{timeout:180000});await page.evaluate(()=>(window as any).live2dDemo.engine.command({method:'speech.unlock'}));
 for(const [text,action] of [['这样把责任都推给别人，我不太认同。','shake'],['呼，原来只是虚惊一场，太好了。','chest'],['啊，原来是这里漏了一步，我明白了。','point'],['希望我等会儿不会说错话，你给我打打气吧。','tremble'],['要是能再多陪你一会儿就好了。','cajole'],['这次终于拿到第一名了，我有一点小骄傲。','proud'],['怎么一直没有你的消息？哦，原来你已经平安到家了，那我就放心了。','chest']] as const){
  await page.evaluate(()=>(window as any).live2dDemo.engine.command({method:'engine.reset'}));
  const started=await cmd('performance.start',{context:'和熟悉的观众自然聊天。'}),sid=started.session_id;await cmd('performance.finish',{session_id:sid,seq:0,text});
  const frames:any[]=[];let done:any,paused=false,shot=false;const begin=Date.now();
  while(Date.now()-begin<60000){const s=await cmd('state.get'),p=await cmd('performance.state');if(p.queue?.error)throw Error(p.queue.error);
   if(s.speech.phase==='playing'){
    frames.push({audio_ms:s.speech.audio_time_ms,actor_ms:p.actor_ms,mouth:s.values.ParamMouthOpenY,body:p.body_action,gesture:p.motion_actions,expression:p.expression});
    if(!paused&&text=== '这样把责任都推给别人，我不太认同。'&&s.speech.audio_time_ms>700){await cmd('engine.pause',{paused:true});const a=await cmd('performance.state');await sleep(250);const b=await cmd('performance.state');for(const key of ['actor_ms','expression','motion_actions','body_action'])assert.deepEqual(b[key],a[key]);await cmd('engine.pause',{paused:false});paused=true;}
    const acting=p.motion_actions?.active?p.motion_actions:p.body_action;
    if(!shot&&acting?.name===action&&acting.phase==='hold'){await page.locator('#stage').screenshot({path:join(out,action+'-'+report.cases.length+'.png')});shot=true;}
   }
   if(p.queue?.phase==='finished'&&!s.speech.active){done=p;break;}await sleep(40);
  }
  assert.ok(done,'speech completed');assert.ok(Math.max(...frames.map(f=>f.mouth))-Math.min(...frames.map(f=>f.mouth))>.1,'mouth remains audio-owned');
  const row={text,expected:action,actions:done.action_history,plans:done.plan_history,metrics:done.queue.metrics,frames,pass:done.action_history.some((a:any)=>a.name===action)};report.cases.push(row);
  assert.ok(row.pass,text+' must execute '+action);assert.equal(done.queue.metrics.filter((m:any)=>m.continuous_utterance).length,1,'commas keep one Qwen unit');await cmd('performance.cancel',{session_id:sid});
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.error=String(error);throw error;}finally{await browser?.close();server.kill();log.end();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,cases:report.cases.length,source:report.source}));
