import assert from 'node:assert/strict';
import test from 'node:test';
import {blendExpression,EmotionExpressionLayer} from '../src/emotion-expression';
import {EMOTION_PROFILES,FACE_CHANNELS,OVERLAY_NAMES} from '../src/emotion-profiles';
import {EMOTION_LABELS} from '../src/emotion-config';
import {actingEmotion,styleBodyPlan} from '../src/emotion-acting';
import {actor,audio,base,id,speechId,plan,run as runActor} from './performance-fixture';
import {normalizeFaceOverlays} from '../src/face-overlays';
const near=(a:number,b:number,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function run(layer:EmotionExpressionLayer,clock:{ms:number},values:Record<string,number>,ms:number,director?:any,expression?:any){
 let result=layer.state();for(let t=0;t<ms;t+=20){clock.ms+=20;result=layer.update(values,.02,clock.ms,director,expression);}return result;
}

test('28 native dimensions blend without sum normalization, then clamp',()=>{
 const two=blendExpression({joy:1,excitement:1});near(two.face.EyeSmile,.44+.48);
 assert.equal(blendExpression({joy:1,excitement:1,amusement:1}).face.EyeSmile,1);
 assert.equal(blendExpression({sadness:1,grief:1,remorse:1}).face.ParamMouthForm,-1);
 assert.equal(blendExpression({anger:1,disgust:1,annoyance:1}).overlay['黑脸'],1);
 const values={joy:.7,nervousness:.4,love:.6,sadness:.2},blended=blendExpression(values);
 for(const channel of FACE_CHANNELS){const sum=Object.entries(values).reduce((s,[label,v])=>s+v*(EMOTION_PROFILES[label].face[channel]??0),0);near(blended.face[channel],Math.max(-1,Math.min(1,sum)));}
 const all=blendExpression(Object.fromEntries(EMOTION_LABELS.map(l=>[l,1])));
 for(const v of Object.values(all.face))assert.ok(v>=-1&&v<=1);
 for(const v of Object.values(all.overlay))assert.ok(v>=0&&v<=1);
});

test('deformation distinguishes narrowed, wide and asymmetric eyelids without replacing the eye drawing',()=>{
 const joy=blendExpression({joy:1}),surprise=blendExpression({surprise:1}),annoyance=blendExpression({annoyance:1});
 assert.ok(joy.face.ParamEyeLOpen<-.4);assert.ok(surprise.face.ParamEyeLOpen>.3);
 assert.notEqual(annoyance.face.ParamEyeLOpen,annoyance.face.ParamEyeROpen);assert.ok(annoyance.face.CheeckPuff>.3);
 const layer=new EmotionExpressionLayer();assert.equal(run(layer,{ms:0},{love:1},3000).eye,'normal');
 assert.equal(FACE_CHANNELS.includes('ParamMouthOpenY' as any),false);
});

test('director overrides deformation, neutral clears it, release transitions back to the current emotion',()=>{
 const l=new EmotionExpressionLayer(),c={ms:0};
 const joy=run(l,c,{joy:1},1000);near(joy.face.EyeSmile,.44);
 const angry=run(l,c,{joy:1},1000,{label:'anger',intensity:.5});near(angry.face.ParamMouthForm,-.21);near(angry.overlay['黑脸'],1);near(angry.face.EyeSmile,0);
 const neutral=run(l,c,{joy:1},1000,{label:'neutral',intensity:1});for(const v of Object.values(neutral.face))near(v,0);assert.equal(neutral.accent,null);
 const start=l.update({joy:1},.02,c.ms+=20);assert.ok(start.face.EyeSmile<.02);
 near(run(l,c,{joy:1},600).face.EyeSmile,.44);
 near(run(l,c,{joy:1},1000,{label:'missing',intensity:1}).face.EyeSmile,.44);
});

test('left and right wink close only the selected eyelid, recover in 620 ms and never loop for a held cue',()=>{
 for(const side of ['left','right']){
  const l=new EmotionExpressionLayer(),c={ms:0},cue={name:'wink_'+side,intensity:1,serial:1};
  const peak=run(l,c,{},220,null,cue),lid=side==='left'?'ParamEyeLOpen':'ParamEyeROpen',other=side==='left'?'ParamEyeROpen':'ParamEyeLOpen';
  near(peak.face[lid],-1);near(peak.face[other],0);near(peak.accent!.closure,1);
  const frozen=l.update({anger:1},0,c.ms,{label:'neutral',intensity:1});assert.deepEqual(frozen,peak);
  const done=run(l,c,{},12000,null,cue);near(done.face[lid],0);assert.equal(done.accent,null);
  assert.ok(run(l,c,{},220,null,{...cue,serial:2}).accent,'a newly submitted cue may wink again');
 }
});

test('pride wink requires stable unambiguous emotion, fires once and ignores short evidence dips',()=>{
 const l=new EmotionExpressionLayer(),c={ms:0};
 assert.equal(run(l,c,{pride:.8},600).accent,null);
 assert.equal(run(l,c,{pride:.8},260).accent?.side,'right');
 assert.equal(run(l,c,{pride:.8},10000).accent,null);
 run(l,c,{},100);assert.equal(run(l,c,{pride:.8},1200).accent,null,'short dip must not rearm a sustained emotion');
 run(l,c,{neutral:.8},1000);assert.equal(run(l,c,{pride:.8},860).accent?.side,'right');
 const mixed=new EmotionExpressionLayer();assert.equal(run(mixed,{ms:0},{pride:.6,anger:.59},3000).accent,null);
 assert.equal(actingEmotion({joy:.5,neutral:.7}),null);
});

test('automatic wink cooldown prevents rapid changes and manual neutral smoothly cancels a wink',()=>{
 const l=new EmotionExpressionLayer(),c={ms:0};run(l,c,{pride:.9},860);
 run(l,c,{anger:1},1000);assert.equal(run(l,c,{pride:.9},1000).accent,null);
 const manual=run(l,c,{},220,null,{name:'wink_right',intensity:1,serial:3});assert.ok(manual.accent);
 const neutral=run(l,c,{},300,{label:'neutral',intensity:1,serial:4});assert.equal(neutral.accent,null);near(neutral.face.ParamEyeROpen,0);
});

test('laughter, affection and embarrassment do not imply a wink',()=>{
 for(const label of ['amusement','love','embarrassment']){
  const l=new EmotionExpressionLayer();for(let ms=20;ms<=12000;ms+=20)assert.equal(l.update({[label]:.9},.02,ms).accent,null,label);
 }
});

test('downcast and averted eyes remain distinguishable at conversational strength; eye shifts pause with audio',()=>{
 const s=blendExpression({sadness:.6}),shy=blendExpression({embarrassment:.6}),curious=blendExpression({curiosity:.6});
 assert.ok(s.face.ParamEyeBallY<=-.4&&s.face.ParamEyeLOpen<-.3);
 assert.ok(shy.face.ParamEyeBallX<-.35&&shy.face.ParamEyeBallY<-.2);
 assert.ok(curious.face.ParamEyeLOpen>=.3&&curious.face.ParamEyeBallX===0&&curious.face.ParamEyeBallY===0);
 const l=new EmotionExpressionLayer(),c={ms:0};const first=run(l,c,{remorse:.7},500),shifted=run(l,c,{remorse:.7},1200);
 assert.ok(shifted.face.ParamEyeBallX>first.face.ParamEyeBallX&&shifted.face.ParamEyeBallX<-.15);
 assert.deepEqual(l.update({remorse:.7},0,c.ms+5000),shifted);
});

test('black face switches fully on/off with dwell and hysteresis, including explicit and raw routes',()=>{
 const l=new EmotionExpressionLayer(),c={ms:0};
 assert.equal(run(l,c,{anger:.5},100).overlay['黑脸'],0);
 assert.equal(run(l,c,{anger:.5},100).overlay['黑脸'],1);
 assert.equal(run(l,c,{anger:.18},500).overlay['黑脸'],1);
 assert.equal(run(l,c,{},200).overlay['黑脸'],1);
 assert.equal(run(l,c,{},200).overlay['黑脸'],0);
 assert.equal(run(l,c,{},20,null,{name:'黑脸',intensity:.1}).overlay['黑脸'],1);
 for(const key of [.1,.49,.5,.8]){const values=[key],post={key1:key};normalizeFaceOverlays(values,new Map([['key1',0]]),post);assert.equal(values[0],Number(key>=.5));assert.equal(post.key1,values[0]);}
 const sad=run(l,c,{sadness:.6},1000);assert.ok(sad.overlay['流泪']>.8);
});

test('squint is sustained; explicit eye drawings stay exclusive and release to normal',()=>{
 const l=new EmotionExpressionLayer(),c={ms:0};
 const s=run(l,c,{},1000,null,{name:'squint',intensity:1});near(s.face.ParamEyeLOpen,-.78);near(s.face.ParamEyeROpen,-.78);assert.equal(s.eye,'normal');
 for(const eye of ['爱心眼','＞＜'])assert.equal(run(l,c,{love:1},1000,null,{name:eye,intensity:1}).eye,eye);
 assert.equal(run(l,c,{joy:1},1000).eye,'normal');
 l.reset();const state=l.state();for(const id of FACE_CHANNELS)near(state.face[id],0);for(const id of OVERLAY_NAMES)near(state.overlay[id],0);assert.equal(state.accent,null);
});

test('emotional styling only interprets selected body beats, preserving none, semantic gestures and onset',()=>{
 for(const action of ['none','wave','thanks','refuse']){const p=plan(0,action,250);assert.equal(styleBodyPlan(p,{love:1}),p);}
 const p=plan(0,'lean',250),styled=styleBodyPlan(p,{love:.9});assert.equal(styled.action.id,'cajole');assert.equal(styled.action.onset_ms,250);assert.equal(styled.action.hold_ms,2400);assert.equal(p.action.id,'lean');
 assert.equal(styleBodyPlan(p,{love:.5,anger:.49}),p);
});

test('manual emotional body and model body use the same owner; explicit action wins',()=>{
 const p=actor('love');p.direct({emotion:'love',intensity:1,hold_ms:5000});runActor(p,20,1000);
 assert.equal(p.state().body_action.name,'cajole');assert.equal(p.state().motion_actions.active,false);
 p.direct({emotion:'joy',action_id:'wave',hold_ms:5000});runActor(p,1020,2400);
 assert.equal(p.state().motion_actions.name,'wave');assert.equal(p.state().body_action.active,false);
 p.release({});runActor(p,2420,5500);assert.equal(p.hasActions(),false);
});

test('live body execution records the performed recipe; face composition preserves background gaze and lip ownership',()=>{
 const p=actor('love');runActor(p,20,2200);const before=p.state();
 p.offerPlan({session_id:id,speech_id:speechId,clause:0,plan:plan(0,'lean'),input:{}});p.tick(.02,audio(2220),base());
 assert.equal(p.state().plan_history[0].plan.action.id,'lean');assert.equal(p.state().plan_history[0].performed_action.id,'cajole');assert.equal(p.state().planner_state.last_action,'cajole');
 const a=actor('neutral');runActor(a,20,1000);a.chunk({session_id:id,start_ms:a.state().motion_ms,channels:['ParamEyeBallX','ParamEyeBallY'],values:Array.from({length:24},()=>[.3,.4])});
 const frame=a.tick(.02,audio(1020),{...base(),ParamMouthOpenY:.7});near(frame.ParamEyeBallX,.3);near(frame.ParamEyeBallY,.4);assert.equal(Object.hasOwn(frame,'ParamMouthOpenY'),false);
});
