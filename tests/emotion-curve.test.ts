import assert from 'node:assert/strict';
import test from 'node:test';
import {EmotionCurve,affectEmotions,validateEmotionTimeline,type EmotionWeights} from '../src/emotion-curve';
import {PerformanceController} from '../src/performance';
import {streamChannels} from '../src/performance-profile';

const id='a'.repeat(32),sid='b'.repeat(32),other='c'.repeat(32);
const weights=(values:Partial<EmotionWeights>={})=>Object.fromEntries(affectEmotions.map(name=>[name,values[name]??0])) as EmotionWeights;
function observations(parts:[string,Partial<EmotionWeights>][]) {
 const text=parts.map(p=>p[0]).join('');let offset=0;
 const points=parts.map(([text,w])=>{const start=offset;offset+=Array.from(text).length;return {text,start,end:offset,start_fraction:start/Array.from(parts.map(p=>p[0]).join('')).length,weights:weights(w),tension:0,probabilities:{}};});
 return {text,timeline:validateEmotionTimeline({schema:'emotion.timeline.v1',points},text)};
}
function run(curve:EmotionCurve,from:number,to:number,hz=60,speechId=sid){
 for(let t=from+1000/hz;t<=to+.001;t+=1000/hz)curve.tick(1/hz,{speech_id:speechId,phase:'playing',audio_time_ms:Math.min(to,t)},true);
}
const parameters=streamChannels.map(id=>({id,label:id,group:'',min:-30,max:30,default:0,type:0,physicsInput:false,physicsOutput:false}));
const plan={schema:'performance.plan.v1',clause:0,arm:'none',body:'none',emotion:'angry',eye:'normal',arm_variant:0,body_variant:0,body_strength:0,expressions:{黑脸:.9,流泪:0,脸红:0,加载:0,兔牙:0,流冷汗:0},eye_strength:0,arm_hold_ms:0,body_hold_ms:0,face_hold_ms:1000,onset_ms:0,confidence:{arm:1,body:1,emotion:1,eye:1},emotion_threshold:.32,affect_strength:.9};
function actor(parts:[string,Partial<EmotionWeights>][],duration=12000){
 const input=observations(parts),p=new PerformanceController(parameters);p.start({session_id:id},{});
 const request={session_id:id,speech_id:sid,text:input.text,audio_duration_ms:duration,audio_duration_final:true,affect_timeline:input.timeline,clauses:[{clause:0,text:input.text,start_fraction:0,performance_plan:plan}]};
 p.utterance(request);return {p,request};
}

test('brief contradictory evidence does not interrupt a sustained emotion',()=>{
 const input=observations([['开'.repeat(40),{happy:.75}],['嗯',{angry:.25}],['心'.repeat(40),{happy:.7}]]),curve=new EmotionCurve();curve.bind(input.timeline,sid,8100);
 run(curve,0,4000);const before=curve.state();assert.equal(before.emotion,'happy');
 run(curve,4000,4100);const during=curve.state();assert.equal(during.emotion,'happy');assert.ok(during.weights.happy>before.weights.happy*.9);assert.ok(during.weights.angry<.05);
 run(curve,4100,8100);assert.equal(curve.state().emotion,'happy');
});

test('a short neutral phrase carries the previous tone, while long silence decays it',()=>{
 const input=observations([['开'.repeat(40),{happy:.7}],['接着说吧。',{}],['心'.repeat(40),{happy:.7}]]),curve=new EmotionCurve();curve.bind(input.timeline,sid,8500);
 run(curve,0,4000);const before=curve.state().weights.happy;run(curve,4000,4500);assert.ok(curve.state().weights.happy>before*.7);
 run(curve,4500,8500);const end=curve.state().weights.happy;
 for(let i=0;i<1800;i++)curve.tick(1/60,{speech_id:sid,phase:'idle',audio_time_ms:8500},true);
 assert.ok(curve.state().weights.happy<end*.02);assert.equal(curve.state().emotion,'neutral');
});

test('a sustained reversal changes expression smoothly and responds within the spoken turn',()=>{
 const input=observations([['开心开心。',{happy:.75}],['真的生气。',{angry:.8}]]),curve=new EmotionCurve();curve.bind(input.timeline,sid,10000);
 run(curve,0,5000);const before=curve.state();let previous=before.weights,maxStep=0;
 for(let t=5000+1000/60;t<=7000+.01;t+=1000/60){curve.tick(1/60,{speech_id:sid,phase:'playing',audio_time_ms:t},true);const next=curve.state().weights;for(const name of affectEmotions)maxStep=Math.max(maxStep,Math.abs(next[name]-previous[name]));previous=next;}
 const after=curve.state();assert.equal(after.emotion,'angry');assert.ok(after.weights.angry>.5);assert.ok(after.mood.happy>.04);assert.ok(maxStep<.035);assert.ok(after.vad.valence<0);
});

test('multiple emotions coexist; category probabilities are never used as a forced one-hot state',()=>{
 const input=observations([['又开心又害羞。',{happy:.4,shy:.5}]]),curve=new EmotionCurve();curve.bind(input.timeline,sid,6000);run(curve,0,6000);
 const state=curve.state();assert.ok(state.weights.happy>.3&&state.weights.shy>.4);assert.ok(curve.expressions().脸红>.4);assert.ok(state.vad.dominance<0);
});

test('binding future observations, pause and buffering never advance emotion',()=>{
 const input=observations([['先开心。',{happy:.7}],['再生气。',{angry:.8}]]),curve=new EmotionCurve();curve.bind(input.timeline,sid,8000);
 assert.equal(curve.state().strength,0);curve.tick(2,{speech_id:sid,phase:'buffering',audio_time_ms:0},true);assert.equal(curve.state().point_index,-1);
 run(curve,0,3000);const before=curve.state();
 curve.tick(2,{speech_id:sid,phase:'paused',audio_time_ms:6000},true);assert.deepEqual(curve.state(),before);
 curve.tick(2,{speech_id:sid,phase:'buffering',audio_time_ms:6000},true);assert.deepEqual(curve.state(),before);
 curve.tick(.1,{speech_id:sid,phase:'playing',audio_time_ms:3100},true);assert.ok(Math.abs(curve.state().clock_ms-before.clock_ms-100)<.001);
});

test('new audio IDs preserve mood without replaying observations when duration is corrected',()=>{
 const input=observations([['第一句。',{happy:.7}],['第二句。',{angry:.7}]]),curve=new EmotionCurve();curve.bind(input.timeline,sid,4000);run(curve,0,3000);
 const before=curve.state();curve.retime(sid,12000);curve.tick(.1,{speech_id:sid,phase:'playing',audio_time_ms:3100},true);assert.equal(curve.state().point_index,1);assert.equal(curve.state().target.angry,.7);
 const carried=curve.state().weights;curve.bind(observations([['接着说。',{angry:.7}]]).timeline,other,4000);assert.deepEqual(curve.state().weights,carried);const clock=curve.state().clock_ms;
 curve.tick(.1,{speech_id:other,phase:'playing',audio_time_ms:100},true);assert.ok(Math.abs(curve.state().clock_ms-clock-100)<.001);assert.ok(curve.state().mood.happy>=before.mood.happy*.9);
});

test('curve playback is stable across frame rates',()=>{
 const input=observations([['开心呀。',{happy:.65}],['难过呀。',{sad:.8}],['谢谢你。',{happy:.6,shy:.2}]]);
 const states=[20,60,120].map(hz=>{const curve=new EmotionCurve();curve.bind(input.timeline,sid,12000);run(curve,0,12000,hz);return curve.state();});
 for(const state of states)for(const name of affectEmotions)assert.ok(Math.abs(state.weights[name]-states[1].weights[name])<.003);
});

test('future invalid evidence fails atomically, including NaN and code-point offsets',()=>{
 const {p,request}=actor([['你好😀。',{happy:.7}],['继续吧。',{happy:.65}]]),before=p.state();
 const bad=structuredClone(request);bad.affect_timeline.points[1].weights.angry=NaN;assert.throws(()=>p.utterance(bad));assert.deepEqual(p.state(),before);
 const shifted=structuredClone(request);shifted.affect_timeline.points[1].start++;assert.throws(()=>p.utterance(shifted));assert.deepEqual(p.state(),before);
});

test('renderer and action state share the curve; manual emotion yields back without resetting mood',()=>{
 const {p}=actor([['一直很开心。',{happy:.75}]]);let values:any;
 for(let t=0;t<4000;t+=1000/60)values=p.tick(1/60,{speech_id:sid,phase:'playing',audio_time_ms:t},{});
 assert.equal(p.state().automatic_emotion,'happy');assert.ok(values.key1<.001,'the discrete authored anger must not override a continuous happy curve');
 assert.ok(values.EyeSmile>.1&&values.EyeSmile<.35,'expression offsets must not accumulate into the fallback pose');
 const cue=p.direct({session_id:id,emotion:'angry',intensity:.8,hold_ms:2000});
 for(let t=4000;t<5000;t+=1000/60)values=p.tick(1/60,{speech_id:sid,phase:'playing',audio_time_ms:t},{});
 assert.ok(values.key1>.6);assert.ok(p.state().affect.weights.happy>.5);assert.equal(p.state().automatic_emotion,'happy');
 p.release(cue);for(let t=5000;t<6500;t+=1000/60)values=p.tick(1/60,{speech_id:sid,phase:'playing',audio_time_ms:t},{});
 assert.ok(values.key1<.05&&values.EyeSmile>.1);const snapshot=p.state();
 const paused=p.tick(1,{speech_id:sid,phase:'buffering',audio_time_ms:6490},{});assert.equal(paused.key1,values.key1);assert.deepEqual(p.state().affect,snapshot.affect);
 p.cancel(id);assert.equal(p.state().affect.enabled,false);assert.equal(p.state().affect.strength,0);assert.throws(()=>p.utterance({...actor([['迟到。',{angry:.8}]]).request,session_id:id}));
});

test('whole-utterance motor predictions cannot anticipate a future facial emotion',()=>{
 const {p}=actor([['先说难过的事。',{sad:.7}],['再说开心的事。',{happy:.8}]]);
 p.chunk({session_id:id,start_ms:0,channels:['EyeSmile','ParamMouthForm'],values:Array.from({length:24},()=>[1,1]),emotion:'happy',expressions:{黑脸:1}});
 let result:any;for(let t=0;t<4000;t+=1000/60)result=p.tick(1/60,{speech_id:sid,phase:'playing',audio_time_ms:t},{});
 assert.equal(p.state().automatic_emotion,'sad');assert.ok(result.EyeSmile<.01);assert.ok(result.ParamMouthForm<0);assert.ok(result.key1<.01);
});
