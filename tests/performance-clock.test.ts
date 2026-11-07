import assert from 'node:assert/strict';
import test from 'node:test';
import {actor,audio,base,id,speechId,plan,run,timeline} from './performance-fixture';
test('initial buffering and pause freeze every performance clock, face, eyes, cues and pose',()=>{
 const p=actor('love');p.direct({emotion:'anger',hold_ms:1000,action_id:'nod'});
 p.tick(1,audio(0,'buffering'),base());assert.equal(p.state().action_clock_ms,0);assert.equal(p.state().affect.clock_ms,0);assert.equal(p.state().body_action.active,false);
 run(p,20,600);const before=p.state(),pose=p.tick(.02,audio(600,'buffering'),base());
 for(let i=0;i<60;i++)assert.deepEqual(p.tick(.1,audio(600,i%2?'paused':'buffering'),base()),pose);
 const after=p.state();
 for(const field of ['action_clock_ms','actor_ms','motion_ms','affect','expression','body_action','directives'])assert.deepEqual(after[field],before[field],field);
 run(p,620,1400);assert.equal(p.state().directives.length,0);assert.ok(p.state().action_clock_ms>before.action_clock_ms);
});
test('live plan uses pure history and real affect; stale replies and duplicate clauses never replay',()=>{
 const p=actor();p.tick(.02,audio(20),base());const s=p.state();
 const input={affect:s.affect_vector,planner_state:s.planner_state,motion_style:s.motion_style};
 const offer={session_id:id,speech_id:speechId,clause:0,plan:plan(0,'nod',.082),input};
 assert.equal(p.offerPlan(offer).accepted,true);assert.equal(p.offerPlan(offer).accepted,false);
 p.tick(.02,audio(100),base());assert.equal(p.state().plan_history.length,0);p.tick(.02,audio(150),base());
 assert.equal(p.state().plan_history[0].committed,true);assert.deepEqual(p.state().plan_history[0].input,input);assert.equal(p.state().planner_state.last_action,'nod');
 assert.equal(p.offerPlan({...offer,speech_id:'c'.repeat(32)}).accepted,false);p.cancel();assert.throws(()=>p.offerPlan(offer));
});
test('audio units accumulate media time and sampler clock never rewinds on a new session',()=>{
 const p=actor();run(p,20,1000);const now=p.state().action_clock_ms;
 const text='继续聊天。',next='c'.repeat(32);p.utterance({session_id:id,speech_id:next,text,audio_duration_ms:2000,audio_duration_final:true,clauses:[{clause:2,text,start_fraction:0}],affect_timeline:timeline(text)});
 p.tick(.1,audio(100,'playing',next),base());assert.equal(p.state().media_ms,1100);assert.equal(p.state().clause,2);
 p.direct({action_id:'nod'});p.tick(.02,audio(120,'playing',next),base());p.cancel();p.start({session_id:id},base());assert.ok(p.state().action_clock_ms>=now);
 p.tick(.5,{phase:'idle'},base());assert.ok(p.state().action_clock_ms>=now+500);
});
test('body offset is composed once even when a gesture exit already includes the background',()=>{
 const p=actor() as any;
 p.body.tick=()=>({AngleX:2});p.gestures.tick=(_:number,automatic:any)=>({AngleX:automatic.AngleX});
 const a=p.tick(.1,audio(100),{...base(),AngleX:3});assert.equal(a.AngleX,5);
 const b=p.tick(.1,audio(200),{...base(),AngleX:3});assert.equal(b.AngleX,5);
});
