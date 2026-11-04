import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=join(import.meta.dirname,'..'),base=process.env.DEMO_URL??'http://127.0.0.1:8765',out=join(root,'test-results/v4');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1200,height:1000}});await page.addInitScript('window.__name = target => target;');
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));const checked:string[]=[];
async function command(method:string,params:any={},status=200,id?:string){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,...(id?{request_id:id}:{})})});const data:any=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data.result;}
try{
 await page.goto(base);await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});await command('speech.unlock');await command('engine.pause',{paused:true});
 const s=await command('performance.start');await command('performance.direct',{session_id:s.session_id,clause:0,emotion:'shy',expression:'><',intensity:.7,hold_ms:2000});
 await command('performance.finish',{session_id:s.session_id,seq:0,text:'你突然这样夸我，我会不好意思的。'});
 await page.waitForFunction(()=>(window as any).live2dDemo.engine.speechState().active,{timeout:30000});await delay(400);
 let state=await command('state.get');assert.equal(state.speech.phase,'paused');assert.equal(state.performance.media_ms,0);assert.equal(state.performance.clause_started,false);assert.equal(state.values.key5,0);
 await command('engine.pause',{paused:false});await page.waitForFunction(()=>(window as any).live2dDemo.engine.control.lastFinal[(window as any).live2dDemo.engine.control.indices.get('key5')]>.5,{timeout:30000});
 assert.equal((await command('performance.state')).emotion,'shy');
 checked.push('pause before PCM keeps future clause cue inactive; audio resume activates it and reports directed emotion');
 await command('performance.cancel',{session_id:s.session_id});await command('parameters.set',{values:{AngleX:12},duration_ms:100});await delay(200);state=await command('state.get');assert.ok(Math.abs(state.driver.AngleX-12)<.01);
 await command('parameters.set',{values:{Clothes1:1}});await command('appearance.update',{glasses:'black',skirt:'long'});state=await command('state.get');assert.equal(state.values.Clothes1,0);
 await command('gesture.set',{side:'right',pose:'point_index'});await delay(1400);state=await command('state.get');assert.equal(state.values.Movement3,1);assert.equal(state.values.key11,1);
 checked.push('manual parameter, native gesture and explicit appearance ownership after cancellation');
 const conflictId=crypto.randomUUID();await command('performance.start',null,400);await command('appearance.get',{},200,conflictId);await command('state.get',{},400,conflictId);
 const cap=await command('capabilities.get');assert.equal(cap.parameters.filter(p=>p.render_verified).length,509);
 checked.push('invalid params, cross-interface request ID conflict, verified capabilities');
 // An open-eye neural trajectory must still allow the resident blink to close the actual mesh.
 await command('engine.reset');
 const blinkSession=(await command('performance.start')).session_id,streamId='d'.repeat(32);
 await command('speech.stream.begin',{performance_session_id:blinkSession,speech_id:streamId,estimated_duration_ms:6000});
 await command('performance.segment',{session_id:blinkSession,clause:0,text:'眨眼层验证',speech_id:streamId});
 await command('performance.chunk',{session_id:blinkSession,start_ms:0,channels:['ParamEyeLOpen','ParamEyeROpen'],values:Array.from({length:24},()=>[1.25,1.25])});
 const sampleRate=24000,samples=sampleRate*2;
 for(let i=0;i<3;i++)await command('speech.stream.append',{speech_id:streamId,index:i,sample_rate:sampleRate,offset_samples:i*samples,samples,pcm16_base64:Buffer.alloc(samples*2).toString('base64'),mouth:{method:'test',hz:60,duration_ms:2000,values:Array(121).fill(0)}});
 await command('speech.stream.finish',{speech_id:streamId,total_samples:samples*3});
 let eyeMin=2,eyeMax=0;const blinkStart=Date.now();
 while(Date.now()-blinkStart<6100){const state=await command('state.get');eyeMin=Math.min(eyeMin,state.values.ParamEyeLOpen);eyeMax=Math.max(eyeMax,state.values.ParamEyeLOpen);await delay(12);}
 assert.ok(eyeMax>1.1,`neural open eye: ${eyeMax}`);assert.ok(eyeMin<.2,`resident blink must close the generated eye: ${eyeMin}`);
 await command('performance.cancel',{session_id:blinkSession});checked.push('generated open-eye target retains resident blink on real Cubism parameters');
 writeFileSync(join(out,'handoff-verification.json'),JSON.stringify({ok:true,runtime_version:cap.runtime_version,checked,blink:{minimum:eyeMin,maximum:eyeMax}},null,2));console.log(JSON.stringify({ok:true,checked}));
}finally{await browser.close();}
