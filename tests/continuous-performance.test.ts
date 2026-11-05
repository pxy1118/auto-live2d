import assert from 'node:assert/strict';
import test from 'node:test';
import {semanticClauses,utteranceEnd} from '../server/utterance';
import {bufferedAudio} from '../server/audio-stream';
import {PerformanceController} from '../src/performance';
import {PerformanceService} from '../server/performance-service';
import {streamChannels} from '../src/performance-profile';
const id='a'.repeat(32),speechId='b'.repeat(32);
const parameters=streamChannels.map(id=>({id,label:id,group:'',min:-30,max:30,default:0,type:0,physicsInput:false,physicsOutput:false}));
const plan=(clause:number,emotion='happy',extra:any={})=>({schema:'performance.plan.v1',clause,arm:'none',body:'none',emotion,eye:'normal',arm_variant:0,body_variant:0,body_strength:0,expressions:{黑脸:emotion==='angry'?.8:0,流泪:0,脸红:0,加载:0,兔牙:0,流冷汗:0},eye_strength:0,arm_hold_ms:700,body_hold_ms:1000,face_hold_ms:5000,onset_ms:0,confidence:{arm:1,body:1,emotion:.45,eye:1},emotion_threshold:.32,affect_strength:.8,...extra});
const audio=(time:number,phase='playing')=>({speech_id:speechId,audio_time_ms:time,phase});
const request=()=>({session_id:id,speech_id:speechId,text:'大家好，今天很开心。我们继续聊吧。',audio_duration_ms:10000,audio_duration_final:false,clauses:[{clause:0,text:'大家好，今天很开心。',start_fraction:0,performance_plan:plan(0)},{clause:1,text:'我们继续聊吧。',start_fraction:.5,performance_plan:plan(1,'angry')}]});
function actor(){const value=new PerformanceController(parameters);value.start({session_id:id},{});value.utterance(request());return value;}

test('known text shares one speech unit across commas and sentence punctuation',()=>{
 const text='大家好呀，今天很高兴见到你。我们先说明，然后继续聊。';assert.equal(utteranceEnd(text,true),text.length);assert.equal(utteranceEnd('大家好呀，今天很高兴见到你',false),0);
 const clauses=semanticClauses(text,3);assert.equal(clauses.length,2);assert.equal(clauses[0].text,'大家好呀，今天很高兴见到你。');assert.equal(clauses[1].clause,4);
});
test('speech length limits preserve astral characters and model offsets use code points',()=>{
 const text='好'.repeat(239)+'😀欢迎你。';const end=utteranceEnd(text,true);assert.equal(end,239);assert.equal(text.slice(0,end)+text.slice(end),text);
 const pieces=semanticClauses('你好😀。我们继续聊。',0);assert.equal(pieces[1].start,4);assert.equal(pieces[0].end,4);
});
test('one audio clock changes clause plans, freezes on pause and never replays after duration correction',()=>{
 const p=actor();p.tick(.1,audio(100),{});assert.equal(p.state().automatic_emotion,'happy');assert.equal(p.state().plan_history.length,1);
 p.finishSpeech(speechId,20000);p.tick(.1,audio(9000),{});assert.equal(p.clause,0);
 p.tick(1,audio(11000,'paused'),{});assert.equal(p.clause,0);assert.equal(p.state().plan_history.length,1);
 p.tick(.1,audio(11000),{});assert.equal(p.clause,1);assert.equal(p.state().automatic_emotion,'angry');assert.equal(p.state().speech_id,speechId);assert.equal(p.state().plan_history.length,2);
 p.finishSpeech(speechId,1000);p.tick(.1,audio(12000),{});assert.equal(p.clause,1);assert.equal(p.state().plan_history.length,2);
 p.cancel(id);p.tick(1,audio(16000),{});assert.equal(p.state().utterance,null);assert.equal(p.state().plan_history.length,2);
});
test('malformed future clauses fail atomically and background emotion cannot overwrite classifier plans',()=>{
 const p=actor(),before=p.state();const invalid=request();invalid.clauses[1].start_fraction=0;assert.throws(()=>p.utterance(invalid));assert.deepEqual(p.state(),before);
 p.chunk({session_id:id,start_ms:0,channels:['AngleX'],values:Array.from({length:24},()=>[0]),expressions:{黑脸:0},emotion:'neutral'});
 p.tick(.1,audio(6000),{});const values=p.tick(.3,audio(6300),{});assert.equal(p.state().automatic_emotion,'angry');assert.ok(values.key1>.5);
});
test('classifier emotion spans the current spoken clause instead of expiring after a short training clip',()=>{
 const p=new PerformanceController(parameters);p.start({session_id:id},{});
 p.utterance({...request(),audio_duration_ms:20000,audio_duration_final:true,clauses:[{clause:0,text:'大家好，今天很开心。我们继续聊吧。',start_fraction:0,performance_plan:plan(0,'angry',{face_hold_ms:1000})}]});
 p.tick(.1,audio(100),{});const values=p.tick(2,audio(7000),{});assert.equal(p.state().automatic_emotion,'angry');assert.ok(values.key1>.7);
});
test('audio drains while the plan is pending and releases only after validation',async()=>{
 let release!:()=>void,observed=0;const ready=new Promise<void>(r=>release=r);
 const body=new ReadableStream<Uint8Array>({start(controller){for(const value of [{type:'start'},{type:'chunk'},{type:'end'}])controller.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));controller.close();}});
 const stream=bufferedAudio(body,ready,()=>observed++,()=>{});let first=false;const pending=stream.events.next().then(value=>{first=true;return value;});
 await new Promise(r=>setImmediate(r));assert.equal(observed,3);assert.equal(first,false);release();assert.equal((await pending).value.type,'start');
 const rest=[];for await(const value of stream.events)rest.push(value.type);assert.deepEqual(rest,['chunk','end']);await stream.close();
});
test('truncated TTS cancels its producer instead of becoming a successful utterance',async()=>{
 let cancelled=false;const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"type":"chunk"}'));controller.close();}});
 const stream=bufferedAudio(body,Promise.resolve(),()=>{},()=>{cancelled=true;});await assert.rejects(async()=>{for await(const _ of stream.events){}},/中断/);assert.equal(cancelled,true);await stream.close();
});
test('lookahead is synthesized during playback and cancellation cannot start the queued audio',async()=>{
 let prefetched!:()=>void;const prefetchReady=new Promise<void>(r=>prefetched=r);let begins=0,closed=0;
 const service:any=new PerformanceService(async command=>{
  if(command.method==='speech.stream.begin')begins++;
  return {result:command.method==='state.get'?{speech:{active:true},performance:{active:true,session_id:id,motion_actions:{active:false},body_action:{active:false}}}:command.method==='performance.utterance'?{media_ms:0}:{} };
 });
 const make=(index:number)=>({index,text:'测试。',clauses:[{clause:index,text:'测试。',start:0,end:3}],queuedAt:Date.now(),bufferWaitMs:0});
 service.prepare=async(_s:any,next:any)=>{
  if(next.index===1)prefetched();
  return {next,context:'',prefill:{performance_plans:[{...next.clauses[0],start_fraction:0,performance_plan:plan(next.index),affect:{}}]},duration:1000,ttsStarted:Date.now(),audio:{events:(async function*(){yield {type:'start',speech_id:speechId,estimated_duration_ms:1000};yield {type:'chunk',index:0,sample_rate:24000,offset_samples:0,mouth:{motion:[],motion_times_ms:[]}};yield {type:'end',speech_id:speechId,total_samples:24000};})(),close:async()=>{closed++;}}};
 };
 service.motion=async()=>{};
 const session:any={id,queue:[make(0),make(1)],finished:true,cancelled:false,abort:new AbortController(),recent:[],metrics:[]};const running=service.pump(session);
 await prefetchReady;assert.equal(begins,1);session.cancelled=true;session.abort.abort();await running;assert.equal(begins,1);assert.equal(closed,2);
});
