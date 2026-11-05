/** Same text before/after: count real TTS streams and their wall-clock joins. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
const root=join(import.meta.dirname,'..'),out=join(root,'test-results/emotion-action-v1'),baseline=process.env.SPEECH_BASELINE==='1',long=process.env.SPEECH_LONG==='1',base='http://127.0.0.1:8775';mkdirSync(out,{recursive:true});
const label=baseline?'before':long?'long':'after',report:any={ok:false,phase:label,frames:[],errors:[]},sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{await fetch(base+'/api/health');throw Error('8775 is occupied');}catch(e){if(!(e instanceof TypeError))throw e;}
const log=createWriteStream(join(out,label+'-server.log'));
const child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:root,env:{...process.env,PORT:'8775'},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function command(method:string,params:any={}){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v.result;}
try{
 for(let i=0;i<100;i++){try{const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.process_id,child.pid);break;}catch{await sleep(100);}}
 const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));assert.ok(executablePath);
 browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1365,height:1050}});await page.addInitScript('window.__name=target=>target;');page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base+'/');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});await page.waitForFunction(()=>!(document.getElementById('performance-play') as HTMLButtonElement).disabled);
 await page.evaluate(()=>{const demo=(window as any).live2dDemo,command=demo.engine.command.bind(demo.engine),events:any[]=[];(window as any).speechAudit=events;demo.engine.command=async(c:any)=>{if(['speech.stream.begin','speech.stream.finish','performance.utterance','performance.segment'].includes(c.method))events.push({method:c.method,params:c.params,at:performance.now()});return command(c);};});
 report.model_before=await fetch('http://127.0.0.1:8768/stream/status').then(r=>r.json());
 report.text=long?'我们先把桌面上的资料整理一下，再按顺序核对每一份文件。接着把今天的安排记下来，慢慢做就好，不用着急。'.repeat(5):'大家好呀，今天很高兴见到你。我们先把事情说清楚，然后再一起慢慢想办法，好不好？';await page.locator('#performance-text').fill(report.text);
 const begin=Date.now();await page.locator('#performance-play').click();let done:any;
 while(Date.now()-begin<(long?150000:90000)){const state=await command('state.get'),p=await command('performance.state');report.frames.push({wall_ms:Date.now()-begin,clause:p.clause,speech:state.speech});assert.ok(Object.values(state.values).every(Number.isFinite));if(p.queue?.error)throw Error(p.queue.error);if(p.queue?.phase==='finished'){done=p;break;}await sleep(80);}
 assert.ok(done,'Speech did not finish');report.total_wall_ms=Date.now()-begin;report.plans=done.plan_history;report.metrics=done.queue.metrics;report.events=await page.evaluate(()=>(window as any).speechAudit);
 const starts=report.events.filter((e:any)=>e.method==='speech.stream.begin');report.tts_streams=starts.length;const ids=new Set(starts.map((e:any)=>e.params.speech_id));report.stream_ids=[...ids];
 const windows=[...ids].map((id:any)=>{const frames=report.frames.filter((f:any)=>f.speech.speech_id===id&&f.speech.phase==='playing');const first=frames[0];const end=report.events.find((e:any)=>e.method==='speech.stream.finish'&&e.params.speech_id===id);const last=report.frames.filter((f:any)=>f.speech.speech_id===id).at(-1);return {id,start_ms:first?first.wall_ms-first.speech.audio_time_ms:null,duration_ms:last?.speech.audio_time_ms,underruns:Math.max(...frames.map((f:any)=>f.speech.underruns??0))};});
 report.audio_windows=windows;report.join_gaps_ms=windows.slice(1).map((w:any,i:number)=>w.start_ms-(windows[i].start_ms!+windows[i].duration_ms!));report.first_audio_ms=report.frames.find((f:any)=>f.speech.phase==='playing')?.wall_ms;
 report.model_after=await fetch('http://127.0.0.1:8768/stream/status').then(r=>r.json());
 if(!baseline){assert.equal(report.model_after.uses_4b,false);assert.equal(report.model_after.runtime_counts.plan_calls-report.model_before.runtime_counts.plan_calls,done.plan_history.length);assert.equal(report.model_after.runtime_counts.emotion_batches-report.model_before.runtime_counts.emotion_batches,starts.length);assert.equal(starts.length,long?2:1,'Comma and sentence punctuation must share one TTS utterance');assert.ok(done.plan_history.length>=2,'Continuous speech must keep multiple semantic plans');assert.ok(windows.every((row:any)=>row.underruns===0));if(long)assert.ok(report.join_gaps_ms.every((gap:number)=>gap<300),'Prefetched length-limit joins must not wait for model startup');}
 await command('performance.cancel',{session_id:done.session_id});assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.error=String(error);throw error;}finally{await browser?.close();child.kill();for(let i=0;i<50&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);report.isolated_server_stopped=child.exitCode!==null||child.signalCode!==null;log.end();writeFileSync(join(out,label+'.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({ok:report.ok,phase:label,tts_streams:report.tts_streams,first_audio_ms:report.first_audio_ms,total_wall_ms:report.total_wall_ms,join_gaps_ms:report.join_gaps_ms,plans:report.plans?.length}));
