import assert from 'node:assert/strict';
import test from 'node:test';
import {ACTION_CATALOG,MODEL_ACTION_IDS,ActionRegistry,EmotionBindings,validateCatalog} from '../src/action-catalog';
import {EMOTION_LABELS,AFFECT_DIM,buildAffectVector} from '../src/emotion-config';
import {historyVector as motionHistoryVector} from '../src/motion-history';
import {validatePlan} from '../src/performance-plan';
import {plan} from './performance-fixture';
test('28 native lanes and 64 affect inputs retain independent evidence',()=>{
 assert.equal(EMOTION_LABELS.length,28);assert.equal(AFFECT_DIM,64);
 const response=Object.fromEntries(EMOTION_LABELS.map(l=>[l,.8]));
 const v=buildAffectVector({response,mood:response,tension:.4,vad:{valence:.1,arousal:.2,dominance:.3},intensity:.8,style:'lively'});assert.equal(v.length,64);assert.equal(v.slice(0,28).reduce((a,b)=>a+b,0)>1,true);
});
test('default17 catalog and 28 authored bindings; future registration validates',()=>{
 assert.equal(validateCatalog(ACTION_CATALOG).actions.length,17);assert.equal(MODEL_ACTION_IDS.length,17);assert.ok(ACTION_CATALOG.actions.every(a=>a.kind!=='segment'));
 const registry=new ActionRegistry(ACTION_CATALOG),bindings=new EmotionBindings(registry);
 for(const label of EMOTION_LABELS){const b=bindings.get(label)!;assert.equal(b.expression_profile,label);assert.ok(b.description);assert.ok(b.action_ids.every(id=>MODEL_ACTION_IDS.includes(id)));if(label==='neutral')assert.equal(b.action,null);else assert.ok(b.action);}
 assert.throws(()=>bindings.bind('happy',{expression_profile:'joy',action_ids:[]}));assert.throws(()=>bindings.bind('joy',{expression_profile:'joy',action_ids:['missing']}));
});
test('v4 is strict and motion history contains no face or emotion state',()=>{
 assert.deepEqual(validatePlan(plan(),0),plan());assert.throws(()=>validatePlan({...plan(),body_overlay:null},0));assert.throws(()=>validatePlan({...plan(),schema:'performance.plan.v2'},0));assert.throws(()=>validatePlan(plan(0,'missing'),0));
 const h={last_action:'wave',last_variant:1,age_ms:400,phase:'hold' as const};assert.equal(motionHistoryVector(h).length,26);
 assert.throws(()=>motionHistoryVector({...h,emotion:'joy'} as any));const unknown=motionHistoryVector({...h,last_action:'future'});assert.equal(unknown[17],1);
});
