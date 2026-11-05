import assert from 'node:assert/strict';
import test from 'node:test';
import {SemanticPerformance,validateSemanticPlan,type SemanticPlan} from '../src/semantic-performance';
import {PerformanceController} from '../src/performance';
import {streamChannels} from '../src/performance-profile';
import {clauseEnd} from '../server/semantic-clause';
const id='a'.repeat(32),sid='b'.repeat(32);
const parameters=streamChannels.map(id=>({id,label:id,group:'',min:-1,max:1,default:0,type:0,physicsInput:false,physicsOutput:false}));
const plan:SemanticPlan={meaning:'解释并在后半句轻轻歪头',affect_subject:'avatar',speech_act:'explain',delivery:'warm',vad:[.4,.2,0],beats:[{anchor:'想一想',occurrence:0,intent:'head_tilt',movement:'optional',strength:'small',delivery:'thoughtful'}]};
const text='我们先坐好，然后想一想。';
test('semantic input preserves negation, attribution and comma continuation in one sentence',()=>{
 assert.equal(clauseEnd('我没有生气，只是在解释。',false,true),12);
 assert.equal(clauseEnd('他说：“我太生气了。”，这是转述。',false,true),17);
});
test('semantic events use media onset, run once, and preserve pause without claiming lip or wardrobe',()=>{
 const layer=new SemanticPerformance(parameters);layer.load(plan,text,6000);
 assert.equal(layer.tick(1/60,6000,false,true).due.length,0);
 assert.equal(layer.tick(1/60,0,true,true).due.length,0);
 const due=layer.tick(1/60,5000,true,true);assert.equal(due.due.length,1);
 assert.equal(layer.tick(1/60,5000,true,true).due.length,0);
 for(const key of ['ParamMouthOpenY','ParamEyeLOpen','ParamEyeROpen','Clothes1','Movement1'])assert.ok(!Object.hasOwn(due.offsets,key));
});
test('semantic validation rejects unsupported effects and invented or reversed anchors',()=>{
 assert.throws(()=>validateSemanticPlan({...plan,Clothes1:1},text));
 assert.throws(()=>validateSemanticPlan({...plan,beats:[{...plan.beats[0],anchor:'挥手'}]},text));
 assert.throws(()=>validateSemanticPlan({...plan,beats:[plan.beats[0],{...plan.beats[0],anchor:'我们'}]},text));
 assert.throws(()=>validateSemanticPlan({...plan,vad:[true,0,0]},text));
});
test('invalid semantic segment is atomic, cancellation prevents pending motion and releases facial offset',()=>{
 const actor=new PerformanceController(parameters);actor.start({session_id:id,driver:'semantic'},{});
 assert.throws(()=>actor.segment({session_id:id,clause:0,text,speech_id:sid,semantic_plan:plan,audio_duration_ms:NaN}));
 assert.equal(actor.state().clause,-1);
 actor.segment({session_id:id,clause:0,text,speech_id:sid,semantic_plan:plan,audio_duration_ms:6000});
 let values:any;for(let i=0;i<60;i++)values=actor.tick(1/60,{speech_id:sid,audio_time_ms:i*16,phase:'playing'},{});
 assert.ok(values.EyeSmile>.1);actor.cancel(id);
 for(let i=0;i<180;i++)values=actor.tick(1/60,{speech_id:sid,audio_time_ms:6000,phase:'idle'},{});
 assert.equal(actor.state().semantic!.processed,0);assert.equal(actor.state().body_action.count,0);assert.ok(values.EyeSmile<.01);
});
test('final duration corrects future events without replaying an earlier gesture',()=>{
 const layer=new SemanticPerformance(parameters),p={...plan,beats:[{...plan.beats[0],anchor:'我们'},plan.beats[0]]};
 layer.load(p,text,12000,false);assert.equal(layer.tick(.01,100,true,true).due.length,1);
 layer.finishDuration(6000);assert.equal(layer.state().duration_final,true);assert.equal(layer.state().duration_ms,6000);
 assert.equal(layer.tick(.01,100,true,true).due.length,0);assert.equal(layer.tick(.01,5000,true,true).due.length,1);
 layer.finishDuration(12000);assert.equal(layer.state().duration_ms,6000);
});
test('a bound explicit director wins on the very first semantic audio frame',()=>{
 const actor=new PerformanceController(parameters);actor.start({session_id:id,driver:'semantic'},{});
 const semantic={...plan,beats:[{anchor:'我们',occurrence:0,intent:'head_tilt',movement:'required',strength:'medium'}]};
 actor.direct({clause:0,body_motion:'nod',body_strength:.5,emotion:'angry',expression:'爱心眼',intensity:.8,hold_ms:1200});
 actor.segment({session_id:id,clause:0,text,speech_id:sid,semantic_plan:semantic,audio_duration_ms:6000});
 let values:any=actor.tick(1/60,{speech_id:sid,audio_time_ms:1,phase:'playing'},{});
 assert.equal(actor.state().semantic!.applied[0].applied,false);assert.equal(actor.state().body_action.name,'nod');
 for(let i=1;i<25;i++)values=actor.tick(1/60,{speech_id:sid,audio_time_ms:i*16,phase:'playing'},{});
 assert.ok(values.key1>.7);assert.equal(values.key4,1);assert.equal(values.key3,0);assert.equal(values.key5,0);assert.equal(values.key6,0);
});
