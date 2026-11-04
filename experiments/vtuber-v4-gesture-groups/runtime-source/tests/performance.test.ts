import assert from 'node:assert/strict';
import test from 'node:test';
import { PerformanceController } from '../src/performance';
import { PerformanceService } from '../server/performance-service';
import { streamChannels,defaultAppearance } from '../src/performance-profile';
import { MotorPolicy } from '../src/motor';
import { RequestLedger } from '../server/request-ledger';
import {GestureLibrary} from '../src/gesture-library';
const params=streamChannels.map(id=>({id,label:id,group:'',min:id.startsWith('ParamEye')&&id.endsWith('Open')?0:-30,max:30,default:id.endsWith('Open')?1:0,type:0,physicsInput:false,physicsOutput:false}));
const id='a'.repeat(32),speech=(time=0)=>({speech_id:'b'.repeat(32),audio_time_ms:time});
function actor(){const p=new PerformanceController(params);p.start({session_id:id,motion_backend:'continuous'},Object.fromEntries(params.map(p=>[p.id,p.default])));p.segment({session_id:id,clause:0,text:'测试',speech_id:'b'.repeat(32)});return p;}
function advance(p:PerformanceController,ms:number,media=0){let values:any;for(let t=0;t<ms;t+=1000/60)values=p.tick(1/60,{...speech(media),phase:'playing',speech_id:p.state().speech_id},{});return values;}
test('appearance updates are atomic and survive speech, cancellation and new sessions',()=>{
  const p=actor();p.appearanceOwned=true;p.updateAppearance({glasses:'black',skirt:'short',body:'preset2'});
  assert.throws(()=>p.updateAppearance({glasses:'none',unknown:true}));assert.equal(p.getAppearance().glasses,'black');
  p.cancel(id);let v=advance(p,100);assert.equal(v.key11,1);assert.equal(v.Clothes1,1);
  p.start({session_id:'c'.repeat(32)},{});assert.equal(p.getAppearance().body,'preset2');p.reset();assert.deepEqual(p.getAppearance(),defaultAppearance);
});
test('explicit emotional intensity is independent of duration and survives clause changes',()=>{
  const p=actor();p.direct({emotion:'angry',intensity:.85,hold_ms:4000,cue_id:'anger'});
  assert.ok(advance(p,1000).key1>.84);assert.equal(p.state().emotion,'angry');assert.equal(p.state().automatic_emotion,'neutral');p.segment({session_id:id,clause:1,text:'下一句',speech_id:'c'.repeat(32)});
  assert.ok(advance(p,2000).key1>.84);p.release({cue_id:'anger'});assert.equal(p.state().emotion,'neutral');assert.ok(advance(p,2500).key1<.01);
  p.direct({emotion:'shy',intensity:.2,hold_ms:2000});assert.ok(Math.abs(advance(p,700).key7-.2)<.01);
  p.release({});p.direct({emotion:'shy',intensity:.9,hold_ms:2000});assert.ok(Math.abs(advance(p,700).key7-.9)<.02);
});
test('future clause cues do not run early, eyes exclude one another and expire',()=>{
  const p=actor();p.direct({expression:'><',intensity:.8,clause:2,hold_ms:800});assert.equal(advance(p,1000).key5,0);
  p.segment({session_id:id,clause:2,text:'现在',speech_id:'c'.repeat(32)});
  assert.equal(p.tick(1,{speech_id:'c'.repeat(32),phase:'buffering',audio_time_ms:0},{}).key5,0,'network start must not activate the future clause cue');
  assert.ok(advance(p,400).key5>.7);
  p.direct({expression:'圈圈眼',intensity:1,hold_ms:1000});const values=advance(p,700);assert.ok(values.key3>.95);assert.ok(values.key5<.2);
  assert.ok(advance(p,3000).key3<.02);
});
test('only future uncommitted chunks can replace tracks; cancellation rejects late chunks',()=>{
  const p=actor();const make=(start:number,offset:number)=>({session_id:id,start_ms:start,channels:['AngleX'],values:Array.from({length:24},(_,i)=>[offset+i*.15]),expressions:{黑脸:.7},hold_ms:4000});
  assert.equal(p.chunk(make(0,0)).accepted,true);assert.equal(p.chunk(make(200,15)).accepted,false);
  advance(p,100,399);const before=p.state().values[0];assert.equal(p.chunk(make(400,-20)).accepted,true);
  const boundary=advance(p,17,400).AngleX;assert.ok(Math.abs(boundary-before)<.1,'continuous at chunk replacement');
  assert.throws(()=>p.chunk({...make(800,0),channels:['Clothes1']}));p.cancel(id);assert.throws(()=>p.chunk(make(800,0)));
});
test('automatic emotion respects media schedule and fades on actor time during silence',()=>{
  const p=actor();p.chunk({session_id:id,start_ms:500,channels:['AngleX'],values:Array(24).fill([0]),expressions:{脸红:.6},hold_ms:1000});
  assert.equal(advance(p,800,0).key7,0);assert.ok(advance(p,500,600).key7>.5);assert.ok(advance(p,4000,600).key7<.01);
});
test('session commands deduplicate request IDs and serialize concurrent starts',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({ready:true}),{status:200});
  let begins=0;const service=new PerformanceService(async c=>({result:c.method==='state.get'?{speech:{enabled:true}}:c.method==='performance.begin'?(begins++,{}):{}}));
  try{
    const first=await service.command({method:'performance.start',request_id:'start'});const sid=first.result.session_id;
    const a={method:'performance.append',params:{session_id:sid,seq:0,text:'还没标点'},request_id:'append'};
    assert.deepEqual(await service.command(a),await service.command(a));
    await assert.rejects(service.command({...a,params:{...a.params,text:'不同'}}));
    await assert.rejects(service.command({method:'performance.start',request_id:'another'}));assert.equal(begins,1);
    await service.command({method:'performance.cancel',params:{session_id:sid},request_id:'cancel'});
    await assert.rejects(service.command({method:'performance.finish',params:{session_id:sid,seq:1},request_id:'late'}));
  }finally{service.disconnect();globalThis.fetch=original;}
});
test('quiet speech keeps arms at rest even when the motor expert proposes a large pose',()=>{
  const p=new MotorPolicy();p.begin({});let result:any;
  for(let i=0;i<360;i++)result=p.apply({Param36:.8,Param42:.4,AngleX:4,PositionZ:3,Movement1:.4},1/60,{actor:i*1000/60,media:i*1000/60,playing:true,ended:false,confidence:.1,threshold:.8,active:true});
  assert.equal(result.Param36,0);assert.equal(result.Param42,0);assert.equal(result.Movement1,0);assert.equal(p.count,0);assert.ok(result.AngleX<=2);
});
test('a semantic gesture happens once, returns to rest, and has a gap across short clauses',()=>{
  const p=new MotorPolicy();p.begin({});let maximum=0,atFive=1;
  for(let i=0;i<720;i++){
    if(i&&i%60===0)p.segment();
    const v=p.apply({Param36:.8,Param42:.4,Movement1:.4},1/60,{actor:i*1000/60,media:i*1000/60,playing:true,ended:false,confidence:1,threshold:.8,active:true});
    maximum=Math.max(maximum,v.Param36);if(i===300)atFive=v.Param36;assert.equal(v.Movement1,0);
  }
  assert.ok(maximum>.25);assert.ok(atFive<.01);assert.ok(p.count<=2);
});
test('a sustained emotional cue does not force a hand gesture',()=>{
  const p=actor();p.chunk({session_id:id,start_ms:0,channels:['Param36'],values:Array.from({length:24},()=>[.8]),motor_probability:0});
  p.direct({emotion:'angry',intensity:.85,hold_ms:4000});const v=advance(p,1500,800);
  assert.ok(v.key1>.84);assert.equal(v.Param36,0);assert.equal(p.state().gesture_policy.count,0);
});

test('rare gestures retain their full lift and wrist excursion',()=>{
  const p=new MotorPolicy();p.begin({});let lift=0,lo=1,hi=-1;
  for(let i=0;i<165;i++){
    const v=p.apply({Param36:.96,Param42:.33*Math.sin(i/60*7)},1/60,{actor:i*1000/60,media:i*1000/60,playing:true,ended:false,confidence:1,threshold:.8,active:true});
    lift=Math.max(lift,v.Param36);lo=Math.min(lo,v.Param42);hi=Math.max(hi,v.Param42);
  }
  assert.ok(lift>.9,'low frequency must not shrink a deliberate raised-arm gesture');assert.ok(hi-lo>.5,'wrist must retain a visible wave');assert.equal(p.count,1);
});

test('a short utterance finishes its gesture on a separate motion clock and survives a clause boundary',()=>{
  const p=actor();p.direct({gesture_hint:'打招呼',intensity:1,hold_ms:5000});
  p.chunk({session_id:id,start_ms:0,channels:['Param36'],values:Array.from({length:24},()=>[.95])});
  for(let i=0;i<16;i++)p.tick(1/60,{...speech(i*1000/60),phase:'playing'},{});
  const media=p.mediaMs;
  for(let i=0;i<50;i++)p.tick(1/60,{...speech(media),phase:'idle'},{});
  assert.equal(p.mediaMs,media);assert.ok(p.motionMs>media+700);assert.equal(p.state().gesture_policy.phase,'active');
  p.segment({session_id:id,clause:1,text:'接着说',speech_id:'c'.repeat(32)});
  for(let i=0;i<12;i++)p.tick(1/60,{speech_id:'c'.repeat(32),audio_time_ms:0,phase:'buffering'},{});
  p.tick(1/60,{speech_id:'c'.repeat(32),audio_time_ms:16,phase:'playing'},{});
  assert.equal(p.state().gesture_policy.count,1);assert.equal(p.state().gesture_origin?.text,'测试');assert.equal(p.mediaMs,media+16);
  for(let i=0;i<300;i++)p.tick(1/60,{speech_id:'c'.repeat(32),audio_time_ms:16,phase:'idle'},{});
  assert.equal(p.state().gesture_policy.phase,'idle');assert.ok(p.state().values[params.findIndex(x=>x.id==='Param36')]<.01);
});

test('evicted responses and runtime reconnects never re-execute an old external request ID',async()=>{
  const ledger=new RequestLedger(2);let effects=0;
  const first=()=>ledger.execute('first','appearance.update',async()=>++effects);
  assert.equal(await first(),1);assert.equal(await first(),1);assert.equal(effects,1);
  await assert.rejects(ledger.execute('first','performance.direct',async()=>++effects),{code:'request_id_conflict'});
  await ledger.execute('second','state.get',async()=>0);await ledger.execute('third','state.get',async()=>0);
  await assert.rejects(first(),{code:'request_id_expired'});assert.equal(effects,1);
  ledger.retireAll();await assert.rejects(ledger.execute('third','state.get',async()=>++effects),{code:'request_id_expired'});assert.equal(effects,1);
});

const nativeFixture=[
 {name:'默认手切举手',end:{Movement2:1,Param60:.86,Param56:1}},
 {name:'举手切默认手',end:{Movement2:0,Param60:0,Param56:1}},
].map((m,i)=>({name:m.name,file:m.name,hold:true,data:{Meta:{Duration:1},Curves:Object.entries(m.end).map(([id,value])=>({Target:'Parameter',Id:id,Segments:[0,i?1:0,0,1,value]}))}}));
test('a coordinated group owns body and arm curves while preserving voice and appearance channels',()=>{
 const p=new PerformanceController(params,nativeFixture as any);p.start({session_id:id},{});p.direct({gesture:'chest',gesture_hold_ms:600,emotion:'shy',intensity:.8});p.appearanceOwned=true;p.updateAppearance({glasses:'black'});
 let peak=0,lean=0,values:any;
 for(let i=0;i<200;i++){values=p.tick(1/60,{speech_id:null,phase:'idle',audio_time_ms:0},{});peak=Math.max(peak,values.Param60??0);lean=Math.max(lean,Math.abs(values.LeanInput??0));assert.equal(values.key11,1);assert.equal(values.ParamMouthOpenY,undefined);assert.equal(values.Param56,undefined);}
 assert.ok(peak>.8);assert.ok(lean>.5);assert.equal(p.state().motion_actions.active,false);assert.ok(Math.abs(values.Param60)<.01);
});
test('action group replacement completes its exit before entering the pending group',()=>{
 const g=new GestureLibrary();assert.ok(g.request({name:'wave',source:'director',id:'one'},0,{}));g.tick(1000,{});
 assert.ok(g.request({name:'cheer',source:'director',id:'two'},1000,{}));assert.equal(g.state(1000).pending,'cheer');
 g.tick(2100,{});assert.equal(g.state(2100).name,'cheer');assert.equal(g.state(2100).count,2);g.tick(3000,{});assert.equal(g.state(3000).name,'cheer');
 assert.equal(g.request({name:'wave',source:'model',id:'old-auto'},3100,{}),false,'automatic requests cannot replace an explicit director action');
});
test('semantic model proposals execute an action group once per gesture opportunity',()=>{
 const p=new PerformanceController(params);p.start({session_id:id},{});p.segment({session_id:id,clause:0,text:'你好',speech_id:'b'.repeat(32)});
 p.chunk({session_id:id,start_ms:0,channels:['Param36'],values:Array.from({length:24},()=>[.05]),motor_probability:1,motor_threshold:.65,gesture_intent:'wave',gesture_confidence:.95});
 let high=0;for(let i=0;i<300;i++){const v=p.tick(1/60,{...speech(i*1000/60),phase:'playing'},{});high=Math.max(high,v.Param36??0);}
 assert.ok(high>.9,'the model chooses a complete coordinated group, not its weak raw joint proposal');assert.equal(p.state().motion_actions.count,1);assert.equal(p.state().motion_actions.active,false);
});

test('releasing an exiting group cannot extend the exit or replay a queued action',()=>{
 const g=new GestureLibrary();g.request({name:'wave',source:'director',id:'one',holdMs:500},0,{});
 g.tick(1500,{});const end=g.state(1500).duration_ms;
 g.release(1600);assert.equal(g.state(1600).duration_ms,end);g.release(1800);assert.equal(g.state(1800).duration_ms,end);
 g.tick(2300,{});assert.equal(g.state(2300).active,false);assert.equal(g.state(2300).count,1);
});

test('a body-only group follows actual audio progress and preserves existing face ownership',()=>{
 const p=new PerformanceController(params);p.direct({gesture:'wave',gesture_hold_ms:1200});
 let v=p.tick(1/60,{...speech(100),phase:'playing'},{});assert.equal(v.key1,undefined);
 const before=p.state().motion_actions.elapsed_ms;
 for(let i=0;i<30;i++)p.tick(1/60,{...speech(100),phase:'playing'},{});
 assert.equal(p.state().motion_actions.elapsed_ms,before,'wall time must not advance a stalled audio clock');
 for(let i=0;i<30;i++)p.tick(1/60,{...speech(100),phase:'buffering'},{});
 assert.equal(p.state().motion_actions.elapsed_ms,before,'an audio underflow holds the current body pose');
 p.tick(1/60,{...speech(350),phase:'playing'},{});assert.equal(p.state().motion_actions.elapsed_ms,before+250);
});
