import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleBodyMotion,bodyMotionNames,bodyChannels} from '../src/body-motion';
import {actor,audio,base,id,speechId,plan,run} from './performance-fixture';
import {ACTION_BY_ID,EMOTION_BINDINGS} from '../src/action-catalog';

test('feedback body motions are finite and bounded; shake and tremor are distinct from a side turn',()=>{
 for(const name of bodyMotionNames)for(let variant=0;variant<3;variant++){
  const frames:Record<string,number>[]=[];for(let t=0;t<=4500;t+=10){const p=sampleBodyMotion(name,variant,{t,enter:700,holdEnd:3000,exit:700});assert.deepEqual(Object.keys(p),bodyChannels);assert.ok(Object.values(p).every(v=>Number.isFinite(v)&&Math.abs(v)<=15));frames.push(p);}
  for(const v of Object.values(frames[0]))assert.ok(v===0);
  for(const v of Object.values(frames.at(-1)!))assert.ok(Math.abs(v)<1e-8);
  if(name==='shake'){assert.ok(Math.max(...frames.map(p=>p.AngleX))>4);assert.ok(Math.min(...frames.map(p=>p.AngleX))< -4);}
  if(name==='tremble')assert.ok(Math.max(...frames.map(p=>p.PositionX))<1&&Math.max(...frames.map(p=>p.PositionX))>.3);
 }
});

test('relief and insight reuse native arm gestures; nervousness keeps hands down; pride supports two directions',()=>{
 assert.equal(EMOTION_BINDINGS.get('relief')!.action!.id,'chest');assert.equal(EMOTION_BINDINGS.get('realization')!.action!.id,'point');
 for(const label of ['fear','nervousness'])assert.equal(EMOTION_BINDINGS.get(label)!.action!.id,'tremble');
 assert.equal(EMOTION_BINDINGS.get('disapproval')!.action!.id,'shake');
 const forward=sampleBodyMotion('proud',0,{t:1000,enter:700,holdEnd:2800,exit:700}),back=sampleBodyMotion('proud',1,{t:1000,enter:700,holdEnd:2800,exit:700});
 assert.ok(forward.PositionZ>8&&forward.LeanInput< -8);assert.ok(back.PositionZ< -4&&back.AngleY>6);
});

test('phrase anchor waits for the corresponding audio position, accounts for preparation and does not replay',()=>{
 const p=actor('neutral');run(p,20,500);const a=plan(0,'shake',.7);
 p.offerPlan({session_id:id,speech_id:speechId,clause:0,plan:a,input:{}});
 run(p,520,6200);assert.equal(p.state().body_action.active,false);
 run(p,6220,6400);assert.equal(p.state().plan_history.length,1);const r=p.state().plan_history[0];
 assert.equal(r.timing.anchor_audio_ms,7000);assert.equal(r.timing.preparation_ms,700);assert.ok(r.timing.start_audio_ms>=6300&&r.timing.start_audio_ms<=6320);
 run(p,6420,10000);assert.equal(p.state().plan_history.length,1);
});

test('admitted pride/cajole accents close both eyelids or wink once, freeze on pause, and preserve lip ownership',()=>{
 for(const [name,variant,kind] of [['proud',0,'double_blink'],['proud',1,'wink_right'],['cajole',2,'double_blink']] as const){
  const p=actor('neutral');p.direct({action_id:name,variant,hold_ms:6000,action_hold_ms:2100});
  let caught=false;for(let t=20;t<=3600;t+=20){const values=p.tick(.02,audio(t),{...base(),ParamMouthOpenY:.7});assert.equal(Object.hasOwn(values,'ParamMouthOpenY'),false);
   const e=p.state().expression;if(e.accent?.closure>.95){caught=true;assert.equal(e.accent.kind,kind);if(kind==='double_blink')assert.equal(e.face.ParamEyeLOpen,e.face.ParamEyeROpen);
    const frozen=p.state().expression;p.tick(1,audio(t,'paused'),base());assert.deepEqual(p.state().expression,frozen);
   }
  }assert.ok(caught,name);assert.equal(p.state().expression.accent,null);
 }
 assert.equal(ACTION_BY_ID.get('thanks')!.repeat_window_ms,24000);
});
